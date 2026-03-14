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
        const preview = String(raw).substring(0, 300)
        console.log(`[NPCI] ── Response #${i+1} ──`)
        console.log(`[NPCI]   Length: ${raw.length} chars`)
        console.log(`[NPCI]   Preview: ${preview}`)

        // Each raw entry is a JSON string — parse it first
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch {
          console.log(`[NPCI]   ✗ Not valid JSON, skipping`)
          continue
        }

        // Detailed structure logging
        const isArr = Array.isArray(parsed)
        const pType = isArr ? 'array' : typeof parsed
        const topKeys = (typeof parsed === 'object' && parsed && !isArr)
          ? Object.keys(parsed).join(', ')
          : 'N/A'
        const arrLen = isArr ? parsed.length : 'N/A'

        console.log(`[NPCI]   Parsed type: ${pType}, array=${isArr}, arrLen=${arrLen}`)
        console.log(`[NPCI]   Top keys: ${topKeys}`)

        // If it's an array, log first item's keys
        if (isArr && parsed.length > 0 && typeof parsed[0] === 'object') {
          const firstKeys = Object.keys(parsed[0]).join(', ')
          console.log(`[NPCI]   First item keys: ${firstKeys}`)
          const hasChat = parsed[0].message_count !== undefined || parsed[0].last_session_id !== undefined
          const hasMandate = parsed[0].umn !== undefined || parsed[0].amount !== undefined || parsed[0]['payee name'] !== undefined
          console.log(`[NPCI]   First item looks like: chat=${hasChat} mandate=${hasMandate}`)
        }

        // If it's a single object, log its keys
        if (!isArr && typeof parsed === 'object' && parsed) {
          const hasChat = parsed.message_count !== undefined || parsed.last_session_id !== undefined
          const hasMandate = parsed.umn !== undefined || parsed.amount !== undefined || parsed['payee name'] !== undefined
          console.log(`[NPCI]   Object looks like: chat=${hasChat} mandate=${hasMandate}`)
        }

        const mandates = mandateParser.parse(parsed, 'intercepted')
        if (mandates.length > 0) {
          allMandates.push(...mandates)
          console.log(`[NPCI]   ✓ Parsed ${mandates.length} mandates from response #${i+1}`)
        } else {
          console.log(`[NPCI]   ✗ No mandates found in response #${i+1}`)
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
