const express = require('express')
const router  = express.Router()

const npciService     = require('../services/npciService')
const supabaseService = require('../services/supabaseService')

// ── Auth middleware ────────────────────────────────────────────────
function authGuard(req, res, next) {
  const appKey = req.headers['x-app-key']
  if (!appKey || appKey !== process.env.APP_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
}

// ── POST /api/npci/fetch ──────────────────────────────────────────
// Receives cookies from Android, fetches mandates from NPCI, stores
// in Supabase, returns results to the app.
router.post('/fetch', authGuard, async (req, res) => {
  try {
    const { cookies, userId } = req.body

    if (!cookies || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing cookies or userId'
      })
    }

    console.log(`[NPCI] Fetching mandates for user: ${userId}`)

    // 1. Fetch from NPCI using forwarded cookies
    const mandates = await npciService.fetchAllMandates(cookies)

    console.log(`[NPCI] Found ${mandates.length} mandates total`)

    // 2. Store in Supabase (only parsed data — never raw cookies)
    if (mandates.length > 0) {
      await supabaseService.saveMandates(userId, mandates)
    }

    // 3. Log session
    await supabaseService.logSession(userId, mandates.length)

    // 4. Return to Android app
    return res.json({
      success:    true,
      mandates:   mandates,
      totalFound: mandates.length
    })
  } catch (err) {
    console.error('[NPCI] Fetch error:', err.message)
    return res.status(500).json({
      success: false,
      error:   'Internal server error',
      message: err.message
    })
  }
})

// ── GET /api/npci/mandates/:userId ────────────────────────────────
// Retrieve stored mandates from Supabase for a user.
router.get('/mandates/:userId', authGuard, async (req, res) => {
  try {
    const { userId } = req.params
    const mandates = await supabaseService.getMandates(userId)

    return res.json({
      success:    true,
      mandates:   mandates,
      totalFound: mandates.length
    })
  } catch (err) {
    console.error('[NPCI] Get mandates error:', err.message)
    return res.status(500).json({
      success: false,
      error:   'Internal server error'
    })
  }
})

module.exports = router
