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

// ── POST /api/npci/extract ────────────────────────────────────────
// PRIMARY endpoint — receives raw API responses intercepted from
// the NPCI WebView, parses them, stores in Supabase, returns mandates.
router.post('/extract', authGuard, async (req, res) => {
  try {
    const { rawResponses, userId } = req.body
    const mandateParser = require('../utils/mandateParser')

    if (!rawResponses || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing rawResponses or userId'
      })
    }

    console.log(`[NPCI] Extracting mandates from ${rawResponses.length} intercepted responses for user: ${userId}`)

    const allMandates = []

    for (let i = 0; i < rawResponses.length; i++) {
      const raw = rawResponses[i]
      try {
        console.log(`[NPCI] Response #${i+1}: ${raw.length} chars, preview: ${String(raw).substring(0, 200)}`)

        // Each raw entry is a JSON string — parse it first
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch {
          console.log(`[NPCI] Response #${i+1} is not valid JSON, skipping`)
          continue
        }

        console.log(`[NPCI] Response #${i+1} parsed as: ${typeof parsed}, keys: ${typeof parsed === 'object' && parsed ? Object.keys(parsed).slice(0, 10).join(', ') : 'N/A'}`)

        const mandates = mandateParser.parse(parsed, 'intercepted')
        if (mandates.length > 0) {
          allMandates.push(...mandates)
          console.log(`[NPCI] ✓ Parsed ${mandates.length} mandates from response #${i+1}`)
        } else {
          console.log(`[NPCI] ✗ No mandates found in response #${i+1}`)
        }
      } catch (e) {
        console.log(`[NPCI] Failed to parse response #${i+1}: ${e.message}`)
      }
    }

    // Deduplicate
    const seen = new Map()
    for (const m of allMandates) {
      const key = m.mandateRef || m.umn || m.id
      if (!seen.has(key)) seen.set(key, m)
    }
    const uniqueMandates = Array.from(seen.values())

    console.log(`[NPCI] Total unique mandates: ${uniqueMandates.length}`)

    // Store in Supabase
    if (uniqueMandates.length > 0) {
      await supabaseService.saveMandates(userId, uniqueMandates)
    }

    // Log session
    await supabaseService.logSession(userId, uniqueMandates.length)

    return res.json({
      success:    true,
      mandates:   uniqueMandates,
      totalFound: uniqueMandates.length
    })
  } catch (err) {
    console.error('[NPCI] Extract error:', err.message)
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
