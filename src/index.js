require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const crypto  = require('crypto')
const axios   = require('axios')
const app     = express()

// ── In-memory log buffer (viewable via /api/npci/logs) ────────────
const logBuffer = []
global.logBuffer = logBuffer
const MAX_LOGS = 200
const origLog   = console.log
const origError = console.error

console.log = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  logBuffer.push({ t: new Date().toISOString(), m: msg })
  if (logBuffer.length > MAX_LOGS) logBuffer.shift()
  origLog.apply(console, args)
}

console.error = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  logBuffer.push({ t: new Date().toISOString(), m: '[ERR] ' + msg })
  if (logBuffer.length > MAX_LOGS) logBuffer.shift()
  origError.apply(console, args)
}

app.use(cors())

// Log ALL incoming requests
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} content-type:${req.headers['content-type'] || 'NONE'} len:${req.headers['content-length'] || 'NONE'}`)
  next()
})

// Parse JSON for all routes EXCEPT /api/npci/extract (manual body parse there)
app.use((req, res, next) => {
  if (req.method === 'POST' && (req.url === '/api/npci/extract' || req.path === '/api/npci/extract')) {
    next()
  } else {
    express.json({ limit: '50mb' })(req, res, (err) => {
      if (err) {
        console.error(`[BODY] Parse error for ${req.url}: ${err.type} ${err.message}`)
      }
      next()
    })
  }
})

// Health check
app.get('/health', (_req, res) => res.json({
  status:    'ok',
  version:   'v11-force-upgrade',
  timestamp: new Date().toISOString()
}))

// NPCI routes
app.use('/api/npci', require('./routes/npci'))

// ── PAYMENTS — inline (avoids module-load issues on Railway) ────────────────────

// Auth guard
function paymentsAuthGuard(req, res, next) {
  const appKey = req.headers['x-app-key']
  const secret = process.env.APP_SECRET
  if (!appKey || !secret || appKey !== secret) {
    console.log(`[PAYMENTS] AUTH FAILED: key=${appKey ? 'present' : 'missing'} secret=${secret ? 'set' : 'MISSING'}`)
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
}

// POST /api/payments/create-order
app.post('/api/payments/create-order', paymentsAuthGuard, async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, userId, planType = 'monthly' } = req.body

    if (!amount || !receipt || !userId) {
      console.log(`[PAYMENTS] create-order: missing fields amount=${!!amount} receipt=${!!receipt} userId=${!!userId}`)
      return res.status(400).json({ success: false, error: 'Missing required fields: amount, receipt, userId' })
    }

    const razorpayKeyId     = process.env.RAZORPAY_KEY_ID
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET

    if (!razorpayKeyId || !razorpayKeySecret) {
      console.error('[PAYMENTS] create-order: Razorpay credentials NOT set in Railway env vars!')
      return res.status(500).json({ success: false, error: 'Payment service not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Railway env vars.' })
    }

    console.log(`[PAYMENTS] create-order: amount=${amount} currency=${currency} userId=${userId} planType=${planType}`)

    const response = await axios.post(
      'https://api.razorpay.com/v1/orders',
      {
        amount,
        currency,
        receipt,
        partial_payment: false,
        notes: { userId, planType, appName: 'AutoPayy', createdAt: new Date().toISOString() }
      },
      {
        auth:    { username: razorpayKeyId, password: razorpayKeySecret },
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }
    )

    const orderId = response.data.id
    console.log(`[PAYMENTS] create-order: Razorpay order created: ${orderId}`)

    res.json({ success: true, order_id: orderId, amount: response.data.amount, currency: response.data.currency })

  } catch (error) {
    console.error(`[PAYMENTS] create-order error: ${error.message}`)
    if (error.response?.data) {
      console.error('[PAYMENTS] Razorpay error:', JSON.stringify(error.response.data))
    }
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.description || error.message || 'Failed to create order'
    })
  }
})

// POST /api/payments/verify
app.post('/api/payments/verify', paymentsAuthGuard, async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, userId } = req.body

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !userId) {
      return res.status(400).json({ success: false, error: 'Missing required payment fields' })
    }

    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET
    if (!razorpayKeySecret) {
      return res.status(500).json({ success: false, error: 'Payment verification not configured' })
    }

    const body              = razorpay_order_id + '|' + razorpay_payment_id
    const expectedSignature = crypto.createHmac('sha256', razorpayKeySecret).update(body).digest('hex')

    if (expectedSignature !== razorpay_signature) {
      console.error(`[PAYMENTS] verify: SIGNATURE MISMATCH userId=${userId}`)
      return res.status(400).json({ success: false, error: 'Payment verification failed: invalid signature' })
    }

    console.log(`[PAYMENTS] verify: Signature OK for paymentId=${razorpay_payment_id}, userId=${userId}`)

    // Update is_pro in Supabase
    const supabaseService = require('./services/supabaseService')
    await supabaseService.upgradeUserToPro(userId, razorpay_payment_id, razorpay_order_id)
    console.log(`[PAYMENTS] verify: User ${userId} upgraded to Pro`)

    res.json({ success: true, message: 'Payment verified and user upgraded to Pro', paymentId: razorpay_payment_id })

  } catch (error) {
    console.error(`[PAYMENTS] verify error: ${error.message}`)
    res.status(500).json({ success: false, error: error.message || 'Payment verification failed' })
  }
})

// GET /api/payments/pro-status/:userId
app.get('/api/payments/pro-status/:userId', paymentsAuthGuard, async (req, res) => {
  try {
    const { userId } = req.params
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' })

    const supabaseService = require('./services/supabaseService')
    const status = await supabaseService.getUserProStatus(userId)
    console.log(`[PAYMENTS] pro-status: ${userId} isPro=${status.isPro} plan=${status.planType}`)
    res.json({
      success:        true,
      userId,
      isPro:          status.isPro,
      subscriptionId: status.subscriptionId,
      planType:       status.planType,
      proDate:        status.proDate,
      proCanceled:    status.proCanceled
    })
  } catch (error) {
    console.error(`[PAYMENTS] pro-status error: ${error.message}`)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ── Razorpay plan cache (populated on first use) ─────────────────────────────
// Override via Railway env vars: RAZORPAY_PLAN_MONTHLY, RAZORPAY_PLAN_YEARLY
const planCache = { monthly: null, yearly: null }

// Helper: build Razorpay axios client
function rzpClient() {
  const keyId     = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)')
  }
  return axios.create({
    baseURL: 'https://api.razorpay.com/v1',
    auth:    { username: keyId, password: keySecret },
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000
  })
}

// Helper: get or create a Razorpay plan for the given planType
async function getOrCreatePlan(client, planType) {
  // 1. Already cached this run
  if (planCache[planType]) return planCache[planType]

  // 2. Set via env var (operator override)
  const envVar = planType === 'monthly' ? process.env.RAZORPAY_PLAN_MONTHLY : process.env.RAZORPAY_PLAN_YEARLY
  if (envVar && envVar.startsWith('plan_')) {
    planCache[planType] = envVar
    console.log(`[PAYMENTS] Using env-var plan for ${planType}: ${envVar}`)
    return planCache[planType]
  }

  // 3. Create a fresh plan under the current credentials
  const amount   = planType === 'monthly' ? 9900 : 69900   // paise (₹99 / ₹699)
  const period   = planType === 'monthly' ? 'monthly' : 'yearly'
  const interval = 1

  console.log(`[PAYMENTS] Creating Razorpay plan for ${planType}: ₹${amount / 100}`)
  const resp = await client.post('/plans', {
    period,
    interval,
    item: {
      name:        'AutoPayy Pro',
      amount,
      currency:    'INR',
      description: `AutoPayy Pro ${planType} plan`
    },
    notes: { appName: 'AutoPayy', planType }
  })

  planCache[planType] = resp.data.id
  console.log(`[PAYMENTS] Plan created: ${planCache[planType]} (${planType})`)
  return planCache[planType]
}

// POST /api/payments/create-subscription
app.post('/api/payments/create-subscription', paymentsAuthGuard, async (req, res) => {
  try {
    const {
      planType = 'monthly',
      userId,
      userEmail = '',
      userPhone = '',
      userName  = ''
    } = req.body || {}

    if (!userId) {
      console.log('[PAYMENTS] create-subscription: missing userId')
      return res.status(400).json({ success: false, error: 'userId is required' })
    }

    if (!['monthly', 'yearly'].includes(planType)) {
      return res.status(400).json({ success: false, error: `Unknown planType: ${planType}. Use 'monthly' or 'yearly'` })
    }

    console.log(`[PAYMENTS] create-subscription: planType=${planType} userId=${userId}`)

    const client = rzpClient()
    const planId = await getOrCreatePlan(client, planType)

    console.log(`[PAYMENTS] Using planId=${planId} for ${planType}`)

    // Trial ends 7 days from now; billing starts after that
    const trialEndAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)

    const subscriptionPayload = {
      plan_id:         planId,
      total_count:     planType === 'yearly' ? 5 : 60,
      quantity:        1,
      customer_notify: 1,
      start_at:        trialEndAt,
      addons: [
        {
          item: {
            name:     'AutoPayy Pro Trial Auth',
            amount:   100,
            currency: 'INR'
          }
        }
      ],
      notes: {
        userId,
        userName,
        planType,
        appName:   'AutoPayy',
        createdAt: new Date().toISOString()
      }
    }

    // Add notify_info only if values provided
    const notifyInfo = {}
    if (userPhone) notifyInfo.notify_phone = userPhone
    if (userEmail) notifyInfo.notify_email = userEmail
    if (Object.keys(notifyInfo).length) subscriptionPayload.notify_info = notifyInfo

    const response = await client.post('/subscriptions', subscriptionPayload)
    const sub = response.data

    console.log(`[PAYMENTS] Subscription created: ${sub.id} status=${sub.status} planType=${planType}`)

    res.json({
      success:         true,
      subscription_id: sub.id,
      plan_type:       planType,
      plan_id:         planId,
      status:          sub.status,
      razorpay_key:    process.env.RAZORPAY_KEY_ID
    })

  } catch (error) {
    console.error(`[PAYMENTS] create-subscription error: ${error.message}`)
    if (error.response?.data) console.error('[PAYMENTS] Razorpay:', JSON.stringify(error.response.data))
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.description || error.message || 'Failed to create subscription'
    })
  }
})

// POST /api/payments/verify-subscription
app.post('/api/payments/verify-subscription', paymentsAuthGuard, async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
      userId,
      planType = 'monthly'
    } = req.body || {}

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing fields: razorpay_payment_id, razorpay_subscription_id, razorpay_signature, userId'
      })
    }

    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET
    if (!razorpayKeySecret) {
      return res.status(500).json({ success: false, error: 'RAZORPAY_KEY_SECRET not configured' })
    }

    // Razorpay subscription signature: HMAC-SHA256 of "payment_id|subscription_id"
    const expectedSig = crypto
      .createHmac('sha256', razorpayKeySecret)
      .update(razorpay_payment_id + '|' + razorpay_subscription_id)
      .digest('hex')

    if (expectedSig !== razorpay_signature) {
      console.error(`[PAYMENTS] verify-subscription: SIGNATURE MISMATCH userId=${userId}`)
      return res.status(400).json({ success: false, error: 'Subscription payment verification failed: invalid signature' })
    }

    console.log(`[PAYMENTS] verify-subscription: Signature OK paymentId=${razorpay_payment_id} subId=${razorpay_subscription_id}`)

    const supabaseService = require('./services/supabaseService')
    await supabaseService.upgradeUserToPro(userId, razorpay_payment_id, razorpay_subscription_id, planType)

    console.log(`[PAYMENTS] verify-subscription: User ${userId} upgraded to Pro (${planType})`)

    res.json({
      success:        true,
      message:        'Subscription verified — AutoPayy Pro activated',
      paymentId:      razorpay_payment_id,
      subscriptionId: razorpay_subscription_id,
      planType
    })

  } catch (error) {
    console.error(`[PAYMENTS] verify-subscription error: ${error.message}`)
    res.status(500).json({ success: false, error: error.message || 'Subscription verification failed' })
  }
})

// POST /api/payments/cancel-subscription
app.post('/api/payments/cancel-subscription', paymentsAuthGuard, async (req, res) => {
  try {
    const { subscriptionId, userId, immediately = false } = req.body || {}

    if (!subscriptionId || !userId) {
      return res.status(400).json({ success: false, error: 'subscriptionId and userId are required' })
    }

    console.log(`[PAYMENTS] cancel-subscription: subId=${subscriptionId} userId=${userId} immediately=${immediately}`)

    const client = rzpClient()
    const rzpResponse = await client.post(
      `/subscriptions/${subscriptionId}/cancel`,
      { cancel_at_cycle_end: immediately ? 0 : 1 }
    )

    const sub = rzpResponse.data
    console.log(`[PAYMENTS] Razorpay subscription cancelled: ${sub.id} status=${sub.status}`)

    const supabaseService = require('./services/supabaseService')
    await supabaseService.cancelUserPro(userId)

    res.json({
      success:        true,
      message:        immediately
        ? 'Subscription cancelled immediately'
        : 'Subscription will be cancelled at end of billing period',
      subscriptionId: sub.id,
      status:         sub.status
    })

  } catch (error) {
    console.error(`[PAYMENTS] cancel-subscription error: ${error.message}`)
    if (error.response?.data) console.error('[PAYMENTS] Razorpay:', JSON.stringify(error.response.data))

    if (error.response?.status === 404) {
      try {
        const supabaseService = require('./services/supabaseService')
        await supabaseService.cancelUserPro(req.body.userId)
        return res.json({ success: true, message: 'Subscription not found on Razorpay — marked cancelled locally' })
      } catch (supaErr) {
        console.error('[PAYMENTS] Supabase fallback cancel failed:', supaErr.message)
      }
    }

    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.description || error.message || 'Failed to cancel subscription'
    })
  }
})

// Subscription routes (create-subscription, verify-subscription, cancel-subscription)
// These are not defined inline above — delegate to the payments router
app.use('/api/payments', require('./routes/payments'))

// ══════════════════════════════════════════════════════════════════
// POST /api/payments/force-upgrade
// Directly upgrades a user to Pro in Supabase after confirmed payment.
// Called as a guaranteed sync step — no signature verification needed
// because the app has already received a successful payment result
// from Razorpay and the endpoint is gated by APP_SECRET.
// Body: { userId, paymentId, subscriptionId?, planType }
// ══════════════════════════════════════════════════════════════════
app.post('/api/payments/force-upgrade', paymentsAuthGuard, async (req, res) => {
  try {
    const { userId, paymentId, subscriptionId = null, planType = 'monthly' } = req.body || {}

    if (!userId || !paymentId) {
      return res.status(400).json({ success: false, error: 'userId and paymentId are required' })
    }

    console.log(`[PAYMENTS] force-upgrade: userId=${userId} paymentId=${paymentId} subId=${subscriptionId} plan=${planType}`)

    const supabaseService = require('./services/supabaseService')
    await supabaseService.upgradeUserToPro(userId, paymentId, subscriptionId, planType)

    console.log(`[PAYMENTS] force-upgrade: User ${userId} upgraded to Pro (${planType})`)

    res.json({
      success:        true,
      message:        'User upgraded to Pro',
      userId,
      paymentId,
      subscriptionId,
      planType
    })

  } catch (error) {
    console.error(`[PAYMENTS] force-upgrade error: ${error.message}`)
    res.status(500).json({ success: false, error: error.message || 'Force upgrade failed' })
  }
})

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[GLOBAL-ERROR] ${req.method} ${req.url}: ${err.message}`)
  res.status(500).json({ success: false, error: err.message })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`AutoPayy backend v11-force-upgrade running on port ${PORT}`)
  console.log(`[STARTUP] APP_SECRET: ${process.env.APP_SECRET ? 'SET' : 'MISSING!'}`)
  console.log(`[STARTUP] RAZORPAY_KEY_ID: ${process.env.RAZORPAY_KEY_ID ? 'SET' : 'MISSING!'}`)
  console.log(`[STARTUP] RAZORPAY_KEY_SECRET: ${process.env.RAZORPAY_KEY_SECRET ? 'SET' : 'MISSING!'}`)
  console.log(`[STARTUP] SUPABASE_URL: ${process.env.SUPABASE_URL ? 'SET' : 'MISSING!'}`)
})
