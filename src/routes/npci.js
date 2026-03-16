const express = require('express')
const router  = express.Router()

const npciService     = require('../services/npciService')
const supabaseService = require('../services/supabaseService')
const mandateParser   = require('../utils/mandateParser')

let lastExtractDebug = { timestamp: null, responses: [], authFailed: false, error: null }

// Log every NPCI request
router.use((req, res, next) => {
  console.log(`[NPCI] ${req.method} ${req.path} | len:${req.headers['content-length'] || 'N/A'} | auth:${req.headers['x-app-key'] ? 'present' : 'MISSING'}`)
  next()
})

// ── Auth guard ─────────────────────────────────────────────────────
function authGuard(req, res, next) {
  const appKey = req.headers['x-app-key']
  const secret = process.env.APP_SECRET
  if (!appKey || appKey !== secret) {
    const msg = `Auth failed. Key:${!!appKey}, SecretSet:${!!secret}, Match:${appKey === secret}`
    console.log(`[NPCI] AUTH FAILED — ${msg}`)
    lastExtractDebug = { timestamp: new Date().toISOString(), responses: [], authFailed: true, error: msg }
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  next()
}

// ── POST /api/npci/extract ─────────────────────────────────────────
// Primary flow: Android WebView intercepts NPCI responses → sends here.
// express.json() is SKIPPED for this route; body is parsed manually.
router.post('/extract', authGuard, async (req, res) => {
  try {
    const bodyText = await new Promise((resolve, reject) => {
      let data = ''
      req.setEncoding('utf8')
      req.on('data',  chunk => { data += chunk })
      req.on('end',   ()    => resolve(data))
      req.on('error', e     => reject(e))
    })

    console.log(`[NPCI] /extract raw body: ${bodyText.length} chars`)

    let body
    try {
      body = JSON.parse(bodyText)
    } catch (e) {
      lastExtractDebug = {
        timestamp:   new Date().toISOString(),
        responses:   [],
        error:       `JSON parse: ${e.message}`,
        bodyPreview: bodyText.substring(0, 1000)
      }
      return res.status(400).json({ success: false, error: 'Invalid JSON body' })
    }

    const { rawResponses, userId } = body
    if (!rawResponses || !userId) {
      lastExtractDebug = {
        timestamp: new Date().toISOString(),
        error:     'Missing rawResponses or userId',
        bodyKeys:  Object.keys(body)
      }
      return res.status(400).json({ success: false, error: 'Missing rawResponses or userId' })
    }

    console.log(`[NPCI] Parsing ${rawResponses.length} intercepted responses for user: ${userId}`)

    const allMandates = []
    lastExtractDebug = { timestamp: new Date().toISOString(), responses: [], totalRaw: rawResponses.length }

    for (let i = 0; i < rawResponses.length; i++) {
      const raw = rawResponses[i]
      const dbg = { index: i, length: String(raw).length, preview: String(raw).substring(0, 500) }

      try {
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch (e) {
          dbg.error = `JSON: ${e.message}`
          lastExtractDebug.responses.push(dbg)
          continue
        }

        dbg.type    = Array.isArray(parsed) ? 'array' : typeof parsed
        dbg.isArray = Array.isArray(parsed)
        if (Array.isArray(parsed)) {
          dbg.arrayLength   = parsed.length
          if (parsed[0]) dbg.firstItemKeys = Object.keys(parsed[0]).slice(0, 15)
        } else if (parsed && typeof parsed === 'object') {
          dbg.keys = Object.keys(parsed).slice(0, 15)
        }

        const mandates = mandateParser.parse(parsed, 'intercepted')
        dbg.mandatesParsed = mandates.length
        console.log(`[NPCI] Response #${i + 1}: ${String(raw).length} chars → ${mandates.length} mandates`)
        allMandates.push(...mandates)

      } catch (e) {
        dbg.error = e.message
        console.log(`[NPCI] Response #${i + 1} failed: ${e.message}`)
      }

      lastExtractDebug.responses.push(dbg)
    }

    // Deduplicate: UMN > mandateRef > id
    const seen = new Map()
    for (const m of allMandates) {
      const key = m.umn || m.mandateRef || m.id
      if (!seen.has(key)) seen.set(key, m)
    }
    const uniqueMandates = Array.from(seen.values())
    lastExtractDebug.totalUnique = uniqueMandates.length

    console.log(`[NPCI] Total:${allMandates.length} Unique:${uniqueMandates.length}`)

    // ── Respond FIRST, save to Supabase after (failure won't block app) ──
    res.json({ success: true, mandates: uniqueMandates, totalFound: uniqueMandates.length })

    try {
      if (uniqueMandates.length > 0) await supabaseService.saveMandates(userId, uniqueMandates)
      await supabaseService.logSession(userId, uniqueMandates.length)
    } catch (dbErr) {
      console.error('[NPCI] Supabase save (non-fatal):', dbErr.message)
    }

  } catch (err) {
    console.error('[NPCI] /extract error:', err.message, err.stack)
    return res.status(500).json({ success: false, error: 'Internal server error', message: err.message })
  }
})

// ── POST /api/npci/fetch ───────────────────────────────────────────
// Secondary flow: backend directly calls NPCI using cookies from Android
router.post('/fetch', authGuard, async (req, res) => {
  try {
    const { cookies, userId } = req.body
    if (!cookies || !userId) {
      return res.status(400).json({ success: false, error: 'Missing cookies or userId' })
    }

    console.log(`[NPCI] /fetch for user: ${userId}`)
    const mandates = await npciService.fetchAllMandates(cookies)
    console.log(`[NPCI] /fetch found ${mandates.length} mandates`)

    try {
      if (mandates.length > 0) await supabaseService.saveMandates(userId, mandates)
      await supabaseService.logSession(userId, mandates.length)
    } catch (dbErr) {
      console.error('[NPCI] Supabase save (non-fatal):', dbErr.message)
    }

    return res.json({ success: true, mandates, totalFound: mandates.length })
  } catch (err) {
    console.error('[NPCI] /fetch error:', err.message)
    return res.status(500).json({ success: false, error: 'Internal server error', message: err.message })
  }
})

// ── GET /api/npci/mandates/:userId ────────────────────────────────
// Android calls this to load saved mandates without re-fetching NPCI
router.get('/mandates/:userId', authGuard, async (req, res) => {
  try {
    const mandates = await supabaseService.getMandates(req.params.userId)
    return res.json({ success: true, mandates, totalFound: mandates.length })
  } catch (err) {
    console.error('[NPCI] /mandates get error:', err.message)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
})

// ── PATCH /api/npci/mandate/:userId/:mandateRef/status ─────────────
// Android calls this after user pauses or cancels a mandate in the UPI app
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
        error: `status must be one of: ${validStatuses.join(', ')}`
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

// ── GET /api/npci/test ────────────────────────────────────────────
// All 4 real mandates from the actual NPCI HTML source + 2 garbage entries
router.get('/test', (req, res) => {
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
      'Total Execution Amount': 2480.83,
      'Remitter Bank': 'JIO PAYMENTS BANK',
      App: 'PAYTM'
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
      'Total Execution Amount': 1,
      'Remitter Bank': 'JIO PAYMENTS BANK',
      App: 'PAYTM'
    },
    {
      umn: '4aa30b9e48074ba9e063871cbc0aa91b@ptsbi',
      amount: 15000,
      is_pause: true,
      is_revoke: true,
      is_unpause: false,
      'payee name': 'HOSTINGERPTELTD',
      recurrance: 'CUSTOM',
      'Latest Status': 'ACTIVE',
      'Total Execution Count': 1,
      'Total Execution Amount': 9,
      'Remitter Bank': 'JIO PAYMENTS BANK',
      App: 'PAYTM'
    },
    {
      umn: 'aabb1122cc3344dd5566ee7788ff99aa@okaxis',
      amount: 469,
      is_pause: true,
      is_revoke: true,
      is_unpause: false,
      'payee name': 'CRUNCHYROLLINDIA',
      recurrance: 'CUSTOM',
      'Latest Status': 'ACTIVE',
      'Total Execution Count': 1,
      'Total Execution Amount': 1,
      'Remitter Bank': 'JIO PAYMENTS BANK',
      App: 'PAYTM'
    },
    // ── Garbage entries — must be filtered out ─────────────────────
    {
      id: '9292c378-1b86-11f1-bdda-061f99d60486',
      title: 'Revoke the mandate for RAZORPAY',
      message_count: 5,
      last_session_id: '81fd9358',
      created_at: '2026-03-09T07:07:02.385000Z'
    },
    {
      id: 'abcd-efgh-0000',
      title: 'New Chat',
      message_count: 0,
      last_session_id: 'xyz789'
    }
  ]

  try {
    const result = mandateParser.parse(testData, 'test')
    return res.json({
      success:     true,
      inputCount:  testData.length,
      parsedCount: result.length,
      note:        `${testData.length - result.length} garbage entries correctly filtered`,
      mandates:    result.map(m => ({
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
  res.type('text/plain').send(logs.map(l => `${l.t} ${l.m}`).join('\n'))
})

module.exports = router
