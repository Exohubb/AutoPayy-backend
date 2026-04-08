'use strict'
const express = require('express')
const router = express.Router()
const axios = require('axios')
const crypto = require('crypto')
const supabaseService = require('../services/supabaseService')

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

// ── Create Razorpay Order ─────────────────────────────────────────
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
