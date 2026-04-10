'use strict'
const express = require('express')
const router = express.Router()
const axios = require('axios')
const crypto = require('crypto')
const supabaseService = require('../services/supabaseService')

// ── Razorpay Plan IDs ─────────────────────────────────────────────
const PLAN_IDS = {
  monthly: 'plan_SbncP7DZheLOy5',   // ₹99/month
  yearly:  'plan_Sbneh0AhyMafzx'    // ₹699/year
}

// ── Auth guard ────────────────────────────────────────────────────
function authGuard(req, res, next) {
  const appKey = req.headers['x-app-key']
  const secret = process.env.APP_SECRET
  if (!appKey || appKey !== secret) {
    console.log(`[PAYMENTS] AUTH FAILED`)
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
}

// ── Helper: build Razorpay axios client ───────────────────────────
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

// ══════════════════════════════════════════════════════════════════
// POST /api/payments/create-subscription
// Creates a Razorpay subscription with 7-day trial and ₹1 auth charge.
// Body: { planType, userId, userEmail, userPhone, userName }
// Response: { success, subscription_id, plan_type, razorpay_key }
// ══════════════════════════════════════════════════════════════════
router.post('/create-subscription', authGuard, async (req, res) => {
  try {
    const {
      planType = 'monthly',
      userId,
      userEmail = '',
      userPhone = '',
      userName  = ''
    } = req.body

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' })
    }

    const planId = PLAN_IDS[planType]
    if (!planId) {
      return res.status(400).json({ success: false, error: `Unknown planType: ${planType}. Use 'monthly' or 'yearly'` })
    }

    console.log(`[PAYMENTS] create-subscription: planType=${planType} planId=${planId} userId=${userId}`)

    const client = rzpClient()

    // Trial ends 7 days from now; billing starts after that
    const trialEndAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)

    const subscriptionPayload = {
      plan_id:         planId,
      total_count:     planType === 'yearly' ? 5 : 60,  // 5 years / 60 months
      quantity:        1,
      customer_notify: 1,
      start_at:        trialEndAt,        // billing starts after trial
      addons: [                           // ₹1 auth charge collected immediately
        {
          item: {
            name:     'AutoPayy Pro Trial Auth',
            amount:   100,                // ₹1 in paise
            currency: 'INR'
          }
        }
      ],
      notify_info: {
        notify_phone: userPhone || undefined,
        notify_email: userEmail || undefined
      },
      notes: {
        userId:    userId,
        userName:  userName,
        planType:  planType,
        appName:   'AutoPayy',
        createdAt: new Date().toISOString()
      }
    }

    // Remove notify_info fields that are empty to avoid Razorpay validation error
    if (!subscriptionPayload.notify_info.notify_phone) delete subscriptionPayload.notify_info.notify_phone
    if (!subscriptionPayload.notify_info.notify_email) delete subscriptionPayload.notify_info.notify_email
    if (!Object.keys(subscriptionPayload.notify_info).length) delete subscriptionPayload.notify_info

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

// ══════════════════════════════════════════════════════════════════
// POST /api/payments/verify-subscription
// Verifies the auth payment made during subscription sign-up.
// Body: { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, userId, planType }
// ══════════════════════════════════════════════════════════════════
router.post('/verify-subscription', authGuard, async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
      userId,
      planType = 'monthly'
    } = req.body

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
    const body = razorpay_payment_id + '|' + razorpay_subscription_id
    const expectedSig = crypto
      .createHmac('sha256', razorpayKeySecret)
      .update(body)
      .digest('hex')

    if (expectedSig !== razorpay_signature) {
      console.error(`[PAYMENTS] verify-subscription: SIGNATURE MISMATCH userId=${userId}`)
      return res.status(400).json({ success: false, error: 'Subscription payment verification failed: invalid signature' })
    }

    console.log(`[PAYMENTS] verify-subscription: Signature OK paymentId=${razorpay_payment_id} subId=${razorpay_subscription_id}`)

    // Upgrade user — sets is_pro=true, pro_date, subscription_id, plan_type in Supabase
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
    res.status(500).json({
      success: false,
      error: error.message || 'Subscription verification failed'
    })
  }
})

// ══════════════════════════════════════════════════════════════════
// POST /api/payments/cancel-subscription
// Cancels a Razorpay subscription and updates Supabase.
// Body: { subscriptionId, userId, immediately? }
// ══════════════════════════════════════════════════════════════════
router.post('/cancel-subscription', authGuard, async (req, res) => {
  try {
    const { subscriptionId, userId, immediately = false } = req.body

    if (!subscriptionId || !userId) {
      return res.status(400).json({ success: false, error: 'subscriptionId and userId are required' })
    }

    console.log(`[PAYMENTS] cancel-subscription: subId=${subscriptionId} userId=${userId} immediately=${immediately}`)

    const client = rzpClient()

    // cancel_at_cycle_end=1 → cancel at billing period end (graceful, default)
    // cancel_at_cycle_end=0 → cancel immediately
    const cancelAt = immediately ? 0 : 1
    const rzpResponse = await client.post(
      `/subscriptions/${subscriptionId}/cancel`,
      { cancel_at_cycle_end: cancelAt }
    )

    const sub = rzpResponse.data
    console.log(`[PAYMENTS] Razorpay subscription cancelled: ${sub.id} status=${sub.status}`)

    // Update Supabase — mark user as cancelled, set pro_canceled timestamp
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

    // If Razorpay returns 404 (sub not found / already cancelled), still update Supabase
    if (error.response?.status === 404) {
      try {
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

// ══════════════════════════════════════════════════════════════════
// GET /api/payments/pro-status/:userId
// Returns Pro status from Supabase (authoritative)
// ══════════════════════════════════════════════════════════════════
router.get('/pro-status/:userId', authGuard, async (req, res) => {
  try {
    const { userId } = req.params
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' })
    }

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
    console.error(`[PAYMENTS] /pro-status error: ${error.message}`)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ══════════════════════════════════════════════════════════════════
// LEGACY: POST /api/payments/create-order (kept for compatibility)
// ══════════════════════════════════════════════════════════════════
router.post('/create-order', authGuard, async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, userId, planType = 'monthly' } = req.body
    if (!amount || !receipt || !userId) {
      return res.status(400).json({ success: false, error: 'Missing required fields: amount, receipt, userId' })
    }
    const client = rzpClient()
    const response = await client.post('/orders', {
      amount, currency, receipt,
      partial_payment: false,
      notes: { userId, planType, appName: 'AutoPayy', createdAt: new Date().toISOString() }
    })
    res.json({ success: true, order_id: response.data.id, amount: response.data.amount, currency: response.data.currency })
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.description || error.message })
  }
})

// ══════════════════════════════════════════════════════════════════
// LEGACY: POST /api/payments/verify (kept for compatibility)
// ══════════════════════════════════════════════════════════════════
router.post('/verify', authGuard, async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, userId } = req.body
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !userId) {
      return res.status(400).json({ success: false, error: 'Missing required payment fields' })
    }
    const secret = process.env.RAZORPAY_KEY_SECRET
    if (!secret) return res.status(500).json({ success: false, error: 'Payment verification not configured' })

    const sig = crypto.createHmac('sha256', secret)
      .update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex')
    if (sig !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Invalid signature' })
    }
    await supabaseService.upgradeUserToPro(userId, razorpay_payment_id, null, 'monthly')
    res.json({ success: true, message: 'Payment verified and user upgraded to Pro', paymentId: razorpay_payment_id })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

module.exports = router
// POST /api/payments/create-order
// Creates a Razorpay order via their Orders API
// Request body: { amount, currency, receipt, userId, planType }
// Response: { success, order_id, amount, currency, error }
router.post('/create-order', authGuard, async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, userId, planType = 'yearly' } = req.body

    // Validate required fields
    if (!amount || !receipt || !userId) {
      console.log(`[PAYMENTS] Missing required fields: amount=${!!amount}, receipt=${!!receipt}, userId=${!!userId}`)
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: amount, receipt, userId' 
      })
    }

    // Get Razorpay credentials from environment
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET

    if (!razorpayKeyId || !razorpayKeySecret) {
      console.error('[PAYMENTS] Razorpay credentials not configured in environment variables')
      return res.status(500).json({ 
        success: false, 
        error: 'Payment service not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Railway env vars.' 
      })
    }

    console.log(`[PAYMENTS] Creating Razorpay order: amount=${amount}, currency=${currency}, receipt=${receipt}, userId=${userId}, planType=${planType}`)

    // Call Razorpay Orders API
    const response = await axios.post(
      'https://api.razorpay.com/v1/orders',
      {
        amount: amount,  // in paise (₹99 = 9900 paise)
        currency: currency,
        receipt: receipt,
        partial_payment: false,
        notes: {
          userId: userId,
          planType: planType,
          appName: 'AutoPayy',
          createdAt: new Date().toISOString()
        }
      },
      {
        auth: {
          username: razorpayKeyId,
          password: razorpayKeySecret
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    )

    const orderId = response.data.id
    console.log(`[PAYMENTS] Razorpay order created successfully: ${orderId}`)

    res.json({
      success: true,
      order_id: orderId,
      amount: response.data.amount,
      currency: response.data.currency
    })

  } catch (error) {
    console.error(`[PAYMENTS] Order creation failed: ${error.message}`)
    if (error.response?.data) {
      console.error(`[PAYMENTS] Razorpay error:`, JSON.stringify(error.response.data))
    }
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.description || error.message || 'Failed to create order'
    })
  }
})

// ── Verify Payment & Upgrade User to Pro ─────────────────────────
// POST /api/payments/verify
// Body: { razorpay_payment_id, razorpay_order_id, razorpay_signature, userId }
// Verifies HMAC signature, then sets is_pro=true in Supabase.
router.post('/verify', authGuard, async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, userId } = req.body

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !userId) {
      console.log(`[PAYMENTS] /verify: missing fields`)
      return res.status(400).json({ success: false, error: 'Missing required payment fields' })
    }

    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET

    if (!razorpayKeySecret) {
      console.error('[PAYMENTS] /verify: RAZORPAY_KEY_SECRET not configured')
      return res.status(500).json({ success: false, error: 'Payment verification not configured' })
    }

    // Step 1: Verify HMAC signature
    const body = razorpay_order_id + '|' + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac('sha256', razorpayKeySecret)
      .update(body)
      .digest('hex')

    if (expectedSignature !== razorpay_signature) {
      console.error(`[PAYMENTS] /verify: SIGNATURE MISMATCH for userId=${userId}, paymentId=${razorpay_payment_id}`)
      return res.status(400).json({ success: false, error: 'Payment verification failed: invalid signature' })
    }

    console.log(`[PAYMENTS] /verify: Signature verified for paymentId=${razorpay_payment_id}, userId=${userId}`)

    // Step 2: Update user is_pro=true in Supabase
    await supabaseService.upgradeUserToPro(userId, razorpay_payment_id, razorpay_order_id)
    console.log(`[PAYMENTS] /verify: User ${userId} upgraded to Pro`)

    res.json({
      success: true,
      message: 'Payment verified and user upgraded to Pro',
      paymentId: razorpay_payment_id
    })

  } catch (error) {
    console.error(`[PAYMENTS] /verify error: ${error.message}`)
    res.status(500).json({
      success: false,
      error: error.message || 'Payment verification failed'
    })
  }
})

// ── Get Pro Status ────────────────────────────────────────────────
// GET /api/payments/pro-status/:userId
// Returns whether user is Pro from Supabase (authoritative check)
router.get('/pro-status/:userId', authGuard, async (req, res) => {
  try {
    const { userId } = req.params
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' })
    }

    const isPro = await supabaseService.getUserProStatus(userId)
    console.log(`[PAYMENTS] Pro status for ${userId}: isPro=${isPro}`)

    res.json({ success: true, userId, isPro })
  } catch (error) {
    console.error(`[PAYMENTS] /pro-status error: ${error.message}`)
    res.status(500).json({ success: false, error: error.message })
  }
})

module.exports = router
