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
  version:   'v8-payments-inline',
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
    const isPro = await supabaseService.getUserProStatus(userId)
    console.log(`[PAYMENTS] pro-status: ${userId} isPro=${isPro}`)
    res.json({ success: true, userId, isPro })
  } catch (error) {
    console.error(`[PAYMENTS] pro-status error: ${error.message}`)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[GLOBAL-ERROR] ${req.method} ${req.url}: ${err.message}`)
  res.status(500).json({ success: false, error: err.message })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`AutoPayy backend v8-payments-inline running on port ${PORT}`)
  console.log(`[STARTUP] APP_SECRET: ${process.env.APP_SECRET ? 'SET' : 'MISSING!'}`)
  console.log(`[STARTUP] RAZORPAY_KEY_ID: ${process.env.RAZORPAY_KEY_ID ? 'SET' : 'MISSING!'}`)
  console.log(`[STARTUP] RAZORPAY_KEY_SECRET: ${process.env.RAZORPAY_KEY_SECRET ? 'SET' : 'MISSING!'}`)
  console.log(`[STARTUP] SUPABASE_URL: ${process.env.SUPABASE_URL ? 'SET' : 'MISSING!'}`)
})
