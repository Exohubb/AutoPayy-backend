'use strict'
const express = require('express')
const router = express.Router()
const axios = require('axios')

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
// Request body: { amount, currency, receipt, notes }
// Response: { success, order_id, error }
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
        error: 'Payment service not configured' 
      })
    }

    console.log(`[PAYMENTS] Creating Razorpay order: amount=${amount}, currency=${currency}, receipt=${receipt}, userId=${userId}`)

    // Call Razorpay Orders API
    const response = await axios.post(
      'https://api.razorpay.com/v1/orders',
      {
        amount: amount,  // in paise (₹99.99 = 9999 paise)
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
        }
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
      console.error(`[PAYMENTS] Razorpay error:`, error.response.data)
    }
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.description || error.message || 'Failed to create order'
    })
  }
})

module.exports = router
