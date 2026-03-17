'use strict'
const express        = require('express')
const router         = express.Router()
const supabaseService = require('../services/supabaseService')
const mandateParser  = require('../utils/mandateParser')

// ── In-memory debug store for /debug endpoint ─────────────────────
let lastExtractDebug = {
  timestamp:  null,
  responses:  [],
  authFailed: false,
  error:      null
}

// ── Log every NPCI request ────────────────────────────────────────
router.use((req, res, next) => {
  console.log(`[NPCI] ${req.method} ${req.path} | len:${req.headers['content-length'] || 'N/A'} | auth:${req.headers['x-app-key'] ? 'present' : 'MISSING'}`)
  next()
})

// ── Auth guard ────────────────────────────────────────────────────
function authGuard(req, res, next) {
  const appKey = req.headers['x-app-key']
  const secret = process.env.APP_SECRET
  if (!appKey || appKey !== secret) {
    const msg = `Auth failed. KeyPresent:${!!appKey} SecretSet:${!!secret}`
    console.log(`[NPCI] AUTH FAILED — ${msg}`)
    lastExtractDebug = {
      timestamp: new Date().toISOString(),
      responses: [], authFailed: true, error: msg
    }
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
}

// ─────────────────────────────────────────────────────────────────
// POST /api/npci/extract
// Primary flow: Android WebView intercepts NPCI responses → sends here.
// express.json() is INTENTIONALLY skipped — body is read manually
// to handle large payloads and avoid buffering issues.
// ─────────────────────────────────────────────────────────────────
router.post('/extract', authGuard, async (req, res) => {
  try {
    // Manual body read (express.json skipped for this route in index.js)
    const bodyText = await new Promise((resolve, reject) => {
      let data = ''
      req.setEncoding('utf8')
      req.on('data',  chunk => { data += chunk })
      req.on('end',   ()    => resolve(data))
      req.on('error', e     => reject(e))
    })

    console.log(`[NPCI] /extract raw body: ${bodyText.length} chars`)

    // ── Parse outer JSON envelope ─────────────────────────────
    let body
    try {
      body = JSON.parse(bodyText)
    } catch (e) {
      lastExtractDebug = {
        timestamp:   new Date().toISOString(),
        responses:   [],
        error:       `JSON parse: ${e.message}`,
        bodyPreview: bodyText.substring(0, 500)
      }
      return res.status(400).json({ success: false, error: 'Invalid JSON body' })
    }

    const { rawResponses, userId } = body
    if (!Array.isArray(rawResponses) || !userId) {
      lastExtractDebug = {
        timestamp: new Date().toISOString(),
        error:     'Missing rawResponses (array) or userId',
        bodyKeys:  Object.keys(body)
      }
      return res.status(400).json({
        success: false,
        error:   'rawResponses must be an array and userId is required'
      })
    }

    console.log(`[NPCI] Parsing ${rawResponses.length} intercepted responses for user: ${userId}`)

    const allMandates = []
    lastExtractDebug  = {
      timestamp: new Date().toISOString(),
      responses: [],
      totalRaw:  rawResponses.length
    }

    // ── Parse each intercepted response ───────────────────────
    for (let i = 0; i < rawResponses.length; i++) {
      const raw = rawResponses[i]
      const dbg = {
        index:   i,
        length:  String(raw).length,
        preview: String(raw).substring(0, 300)
      }

      try {
        // Each element in rawResponses is a JSON string from the WebView
        let parsed
        const rawStr = String(raw).trim()
        try {
          parsed = JSON.parse(rawStr)
        } catch (e) {
          // If it's already an object (shouldn't happen, but be safe)
          if (typeof raw === 'object' && raw !== null) {
            parsed = raw
          } else {
            dbg.error = `JSON parse: ${e.message}`
            lastExtractDebug.responses.push(dbg)
            continue
          }
        }

        dbg.type    = Array.isArray(parsed) ? 'array' : typeof parsed
        dbg.isArray = Array.isArray(parsed)
        if (Array.isArray(parsed)) {
          dbg.arrayLength  = parsed.length
          if (parsed[0]) dbg.firstItemKeys = Object.keys(parsed[0]).slice(0, 15)
        } else if (parsed && typeof parsed === 'object') {
          dbg.topKeys = Object.keys(parsed).slice(0, 15)
        }

        const mandates    = mandateParser.parse(parsed, `intercepted[${i}]`)
        dbg.mandatesParsed = mandates.length
        console.log(`[NPCI] Response #${i + 1}: ${String(raw).length} chars → type=${dbg.type} → ${mandates.length} mandates`)
        allMandates.push(...mandates)

      } catch (e) {
        dbg.error = e.message
        console.error(`[NPCI] Response #${i + 1} failed: ${e.message}`)
      }

      lastExtractDebug.responses.push(dbg)
    }

    // ── Deduplicate: UMN > mandateRef > id ────────────────────
    const seen          = new Map()
    for (const m of allMandates) {
      const key = m.umn || m.mandateRef || m.id
      if (!seen.has(key)) seen.set(key, m)
    }
    const uniqueMandates = Array.from(seen.values())

    lastExtractDebug.totalParsed = allMandates.length
    lastExtractDebug.totalUnique = uniqueMandates.length

    console.log(`[NPCI] Total:${allMandates.length} Unique:${uniqueMandates.length}`)

    // ── Respond FIRST, save to Supabase after ─────────────────
    res.json({
      success:    true,
      mandates:   uniqueMandates,
      totalFound: uniqueMandates.length
    })

    // Save in background — failure won't affect the app response
    try {
      if (uniqueMandates.length > 0) {
        await supabaseService.saveMandates(userId, uniqueMandates)
      }
      await supabaseService.logSession(userId, uniqueMandates.length)
    } catch (dbErr) {
      console.error('[NPCI] Supabase save (non-fatal):', dbErr.message)
    }

  } catch (err) {
    console.error('[NPCI] /extract error:', err.message, err.stack)
    return res.status(500).json({
      success: false,
      error:   'Internal server error',
      message: err.message
    })
  }
})

// ─────────────────────────────────────────────────────────────────
// GET /api/npci/mandates/:userId
// Android loads saved mandates without re-fetching NPCI
// ─────────────────────────────────────────────────────────────────
router.get('/mandates/:userId', authGuard, async (req, res) => {
  try {
    const mandates = await supabaseService.getMandates(req.params.userId)
    return res.json({ success: true, mandates, totalFound: mandates.length })
  } catch (err) {
    console.error('[NPCI] /mandates get error:', err.message)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────
// PATCH /api/npci/mandate/:userId/:mandateRef/status
// ─────────────────────────────────────────────────────────────────
router.patch('/mandate/:userId/:mandateRef/status', authGuard, async (req, res) => {
  try {
    const { userId, mandateRef } = req.params
    const { status } = req.body
    if (!status) {
      return res.status(400).json({ success: false, error: 'Missing status in body' })
    }
    const validStatuses = ['ACTIVE', 'PAUSED', 'REVOKED']
    if (!validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error:   `status must be one of: ${validStatuses.join(', ')}`
      })
    }

    await supabaseService.updateMandateStatus(userId, mandateRef, status.toUpperCase())
    console.log(`[NPCI] Mandate ${mandateRef} → ${status.toUpperCase()} for user ${userId}`)
    return res.json({ success: true, mandateRef, status: status.toUpperCase() })

  } catch (err) {
    console.error('[NPCI] /status update error:', err.message)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
})

// ─────────────────────────────────────────────────────────────────
// GET /api/npci/test
// ── Bug fix: each object now has its opening { brace ────────────
// ─────────────────────────────────────────────────────────────────
router.get('/test', (req, res) => {
  const testData = [
    {
      umn:                      '9e96380e336c42568454a2ba71c6afae@okicici',
      amount:                   8300,
      is_pause:                 true,
      is_revoke:                true,
      is_unpause:               false,
      'payee name':             'RAZORPAY SOFTWARE PRIVATE LIMITED',
      recurrance:               'CUSTOM',
      'Latest Status':          'ACTIVE',
      'Total Execution Count':  1,
      'Total Execution Amount': 2480.83,
      'Remitter Bank':          'JIO PAYMENTS BANK',
      App:                      'PAYTM'
    },
    {
      umn:                      '49d81e2a19c18eb8e0638b1cbc0a60ed@ptsbi',
      amount:                   499,
      is_pause:                 true,
      is_revoke:                true,
      is_unpause:               false,
      'payee name':             'DISCOVERY COMMUNICATIONS INDIA',
      recurrance:               'CUSTOM',
      'Latest Status':          'ACTIVE',
      'Total Execution Count':  1,
      'Total Execution Amount': 1,
      'Remitter Bank':          'JIO PAYMENTS BANK',
      App:                      'PAYTM'
    },
    {
      umn:                      '4aa30b9e48074ba9e063871cbc0aa91b@ptsbi',
      amount:                   15000,
      is_pause:                 true,
      is_revoke:                true,
      is_unpause:               false,
      'payee name':             'HOSTINGERPTELTD',
      recurrance:               'CUSTOM',
      'Latest Status':          'ACTIVE',
      'Total Execution Count':  1,
      'Total Execution Amount': 9,
      'Remitter Bank':          'JIO PAYMENTS BANK',
      App:                      'PAYTM'
    },
    {
      umn:                      'aabb1122cc3344dd5566ee7788ff99aa@okaxis',
      amount:                   469,
      is_pause:                 true,
      is_revoke:                true,
      is_unpause:               false,
      'payee name':             'CRUNCHYROLLINDIA',
      recurrance:               'CUSTOM',
      'Latest Status':          'ACTIVE',
      'Total Execution Count':  1,
      'Total Execution Amount': 1,
      'Remitter Bank':          'JIO PAYMENTS BANK',
      App:                      'PAYTM'
    },
    // ── Garbage — must be filtered out ─────────────────────────
    {
      id:               '9292c378-1b86-11f1-bdda-061f99d60486',
      title:            'Revoke the mandate for RAZORPAY',
      message_count:    5,
      last_session_id:  '81fd9358',
      created_at:       '2026-03-09T07:07:02.385000Z'
    },
    {
      id:              'abcd-efgh-0000',
      title:           'New Chat',
      message_count:   0,
      last_session_id: 'xyz789'
    }
  ]

  try {
    const result = mandateParser.parse(testData, 'test')
    return res.json({
      success:      true,
      inputCount:   testData.length,
      parsedCount:  result.length,
      note:         `${testData.length - result.length} garbage entries correctly filtered`,
      mandates:     result.map(m => ({
        merchantName:       m.merchantName,
        amount:             m.amount,
        umn:                m.umn,
        status:             m.status,
        frequency:          m.frequency,
        category:           m.category,
        upiAppName:         m.upiAppName,
        remitterBank:       m.remitterBank,
        totalExecCount:     m.totalExecCount,
        totalExecAmount:    m.totalExecAmount,
        canPause:           m.canPause,
        canRevoke:          m.canRevoke,
        canUnpause:         m.canUnpause,
        revocationDeepLink: m.revocationDeepLink
      }))
    })
  } catch (e) {
    return res.json({ success: false, error: e.message, stack: e.stack })
  }
})

// ── GET /api/npci/debug ───────────────────────────────────────────
router.get('/debug', (_req, res) => res.json(lastExtractDebug))

// ── GET /api/npci/logs ────────────────────────────────────────────
router.get('/logs', (_req, res) => {
  const logs = global.logBuffer || []
  res.type('text/plain').send(
    logs.length > 0
      ? logs.map(l => `${l.t}  ${l.m}`).join('\n')
      : 'No logs captured yet.'
  )
})

// ─────────────────────────────────────────────────────────────────
// POST /api/npci/chat
// Phase 2: Android sends AI-chat-scraped mandate details.
// Body: { userId, source: 'chat_ai', mandates: [{merchantName, rows:[{field,value}]}] }
// Backend resolves each mandate by merchant name and enriches the row.
// DD-MM-YYYY dates are converted to ISO YYYY-MM-DD before saving.
// ─────────────────────────────────────────────────────────────────
router.post('/chat', authGuard, async (req, res) => {
  try {
    const { userId, mandates } = req.body
    if (!userId || !Array.isArray(mandates)) {
      return res.status(400).json({
        success: false,
        error: 'userId and mandates (array) are required'
      })
    }

    // Convert DD-MM-YYYY → YYYY-MM-DD; pass through ISO or unknown formats unchanged
    function parseDate(d) {
      if (!d || typeof d !== 'string') return d
      const p = d.trim().split('-')
      if (p.length === 3 && p[0].length === 2) return `${p[2]}-${p[1]}-${p[0]}`
      return d
    }

    console.log(`[NPCI] /chat enriching ${mandates.length} mandate tables for user: ${userId}`)
    const results = await supabaseService.enrichMandates(userId, mandates, parseDate)
    console.log(`[NPCI] /chat updated ${results.length} mandates`)

    return res.json({ success: true, updated: results.length, details: results })
  } catch (err) {
    console.error('[NPCI] /chat error:', err.message)
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
