const express = require('express')
const router  = express.Router()

const npciService     = require('../services/npciService')
const supabaseService = require('../services/supabaseService')

// Stores details from the last /extract call for debugging
let lastExtractDebug = { timestamp: null, responses: [], authFailed: false, error: null }

// Log EVERY request to NPCI routes
router.use((req, res, next) => {
  console.log(`[NPCI] ${req.method} ${req.path} | content-length: ${req.headers['content-length'] || 'N/A'} | x-app-key: ${req.headers['x-app-key'] ? 'present' : 'MISSING'}`)
  next()
})

// ── Auth middleware ────────────────────────────────────────────────
function authGuard(req, res, next) {
  const appKey = req.headers['x-app-key']
  const secret = process.env.APP_SECRET
  if (!appKey || appKey !== secret) {
    console.log(`[NPCI] AUTH FAILED — appKey=${appKey ? appKey.substring(0,10) + '...' : 'MISSING'}, APP_SECRET=${secret ? secret.substring(0,10) + '...' : 'NOT SET'}`)
    lastExtractDebug = { timestamp: new Date().toISOString(), responses: [], authFailed: true, error: `Auth failed. Key present: ${!!appKey}, Secret set: ${!!secret}, Match: ${appKey === secret}` }
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
}

// ── POST /api/npci/fetch ──────────────────────────────────────────
router.post('/fetch', authGuard, async (req, res) => {
  try {
    const { cookies, userId } = req.body

    if (!cookies || !userId) {
      return res.status(400).json({ success: false, error: 'Missing cookies or userId' })
    }

    console.log(`[NPCI] Fetching mandates for user: ${userId}`)
    const mandates = await npciService.fetchAllMandates(cookies)
    console.log(`[NPCI] Found ${mandates.length} mandates total`)

    // Save to Supabase (non-blocking — don't let it break the response)
    try {
      if (mandates.length > 0) await supabaseService.saveMandates(userId, mandates)
      await supabaseService.logSession(userId, mandates.length)
    } catch (dbErr) {
      console.error('[NPCI] Supabase save error (non-fatal):', dbErr.message)
    }

    return res.json({ success: true, mandates, totalFound: mandates.length })
  } catch (err) {
    console.error('[NPCI] Fetch error:', err.message)
    return res.status(500).json({ success: false, error: 'Internal server error', message: err.message })
  }
})

// ── POST /api/npci/extract ────────────────────────────────────────
// Body is parsed MANUALLY here because express.json() is skipped for this route
router.post('/extract', authGuard, async (req, res) => {
  try {
    const mandateParser = require('../utils/mandateParser')

    // Manually read the raw body (express.json is skipped for this route)
    const bodyText = await new Promise((resolve, reject) => {
      let data = ''
      req.setEncoding('utf8')
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => resolve(data))
      req.on('error', (e) => reject(e))
    })

    console.log(`[NPCI] Raw body length: ${bodyText.length} chars`)

    let body
    try {
      body = JSON.parse(bodyText)
    } catch (e) {
      console.log(`[NPCI] Body JSON parse error: ${e.message}`)
      console.log(`[NPCI] Body preview: ${bodyText.substring(0, 500)}`)
      lastExtractDebug = { timestamp: new Date().toISOString(), responses: [], error: `Body JSON parse failed: ${e.message}`, bodyPreview: bodyText.substring(0, 1000) }
      return res.status(400).json({ success: false, error: 'Invalid JSON body' })
    }

    const rawResponses = body.rawResponses
    const userId = body.userId

    if (!rawResponses || !userId) {
      lastExtractDebug = { timestamp: new Date().toISOString(), responses: [], error: `Missing fields. rawResponses: ${!!rawResponses}, userId: ${!!userId}`, bodyKeys: Object.keys(body) }
      return res.status(400).json({ success: false, error: 'Missing rawResponses or userId' })
    }

    console.log(`[NPCI] Extracting from ${rawResponses.length} responses for user: ${userId}`)

    const allMandates = []
    lastExtractDebug = { timestamp: new Date().toISOString(), responses: [], totalRaw: rawResponses.length }

    for (let i = 0; i < rawResponses.length; i++) {
      const raw = rawResponses[i]
      const debugEntry = { index: i, length: raw.length, preview: String(raw).substring(0, 500) }
      try {
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch (e) {
          debugEntry.error = 'Invalid JSON: ' + e.message
          lastExtractDebug.responses.push(debugEntry)
          continue
        }

        debugEntry.type = Array.isArray(parsed) ? 'array' : typeof parsed
        debugEntry.isArray = Array.isArray(parsed)
        if (Array.isArray(parsed)) {
          debugEntry.arrayLength = parsed.length
          if (parsed[0]) debugEntry.firstItemKeys = Object.keys(parsed[0]).slice(0, 15)
        } else if (typeof parsed === 'object' && parsed) {
          debugEntry.keys = Object.keys(parsed).slice(0, 15)
        }

        const mandates = mandateParser.parse(parsed, 'intercepted')
        debugEntry.mandatesParsed = mandates.length
        console.log(`[NPCI] Response #${i+1}: ${raw.length} chars → ${mandates.length} mandates`)
        if (mandates.length > 0) {
          allMandates.push(...mandates)
        }
      } catch (e) {
        debugEntry.error = e.message
        console.log(`[NPCI] Failed response #${i+1}: ${e.message}`)
      }
      lastExtractDebug.responses.push(debugEntry)
    }

    // Deduplicate by umn first, then mandateRef, then id
    const seen = new Map()
    for (const m of allMandates) {
      const key = m.umn || m.mandateRef || m.id
      if (!seen.has(key)) seen.set(key, m)
    }
    const uniqueMandates = Array.from(seen.values())

    console.log(`[NPCI] Total: ${allMandates.length}, Unique: ${uniqueMandates.length}`)

    // IMPORTANT: Send response FIRST, then save to Supabase.
    // This way if Supabase fails, the app still gets mandates.
    res.json({ success: true, mandates: uniqueMandates, totalFound: uniqueMandates.length })

    // Save to Supabase in background (errors won't affect response)
    try {
      if (uniqueMandates.length > 0) await supabaseService.saveMandates(userId, uniqueMandates)
      await supabaseService.logSession(userId, uniqueMandates.length)
    } catch (dbErr) {
      console.error('[NPCI] Supabase save error (non-fatal):', dbErr.message)
    }
  } catch (err) {
    console.error('[NPCI] Extract error:', err.message, err.stack)
    return res.status(500).json({ success: false, error: 'Internal server error', message: err.message })
  }
})

// ── GET /api/npci/mandates/:userId ────────────────────────────────
router.get('/mandates/:userId', authGuard, async (req, res) => {
  try {
    const { userId } = req.params
    const mandates = await supabaseService.getMandates(userId)
    return res.json({ success: true, mandates, totalFound: mandates.length })
  } catch (err) {
    console.error('[NPCI] Get mandates error:', err.message)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
})

// ── GET /api/npci/test — Parser test with sample data ─────────────
router.get('/test', (req, res) => {
  const mandateParser = require('../utils/mandateParser')

  // Sample NPCI data (same format as real intercepted responses)
  const testData = [
    {
      umn: '9e96380e336c42568454a2ba71c6afae@okicici',
      amount: 8300,
      is_pause: true,
      is_revoke: true,
      is_unpause: false,
      'payee name': 'RAZORPAY SOFTWARE PRIVATE LIMITED',
      recurrance: 'CUSTOM',
      'Latest Status': 'ACTIVE',
      'Total Execution Count': 1,
      'Total Execution Amount': 2480.83
    },
    {
      umn: '49d81e2a19c18eb8e0638b1cbc0a60ed@ptsbi',
      amount: 499,
      is_pause: true,
      is_revoke: true,
      is_unpause: false,
      'payee name': 'DISCOVERY COMMUNICATIONS INDIA',
      recurrance: 'CUSTOM',
      'Latest Status': 'ACTIVE',
      'Total Execution Count': 1,
      'Total Execution Amount': 1
    },
    {
      id: '9292c378-1b86-11f1-bdda-061f99d60486',
      title: 'Revoke the mandate for RAZORPAY',
      message_count: 5,
      last_session_id: '81fd9358',
      created_session_id: '81fd9358',
      last_message_content: 'Some chat text',
      created_at: '2026-03-09T07:07:02.385000Z'
    },
    {
      title: 'New Chat',
      message_count: 0,
      last_session_id: 'abc123',
      created_session_id: 'def456'
    }
  ]

  try {
    const result = mandateParser.parse(testData, 'test')
    return res.json({
      success: true,
      testInput: testData.length + ' items',
      parsedCount: result.length,
      mandates: result.map(m => ({
        merchantName: m.merchantName,
        amount: m.amount,
        umn: m.umn,
        status: m.status
      }))
    })
  } catch (e) {
    return res.json({
      success: false,
      error: e.message,
      stack: e.stack
    })
  }
})

// ── GET /api/npci/debug — Shows raw data from last extraction ─────
router.get('/debug', (req, res) => {
  res.json(lastExtractDebug)
})

module.exports = router
