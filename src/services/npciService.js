'use strict'
const axios          = require('axios')
const mandateParser  = require('../utils/mandateParser')

const NPCI_BASE = 'https://www.upihelp.npci.org.in'
const TIMEOUT   = 12000

/**
 * Build request headers mimicking a real Android Chrome session on NPCI.
 * Based on observed requests from the real NPCI UPI Help portal.
 */
function buildHeaders(cookieObj) {
  return {
    'Cookie':            cookieObj.raw || '',
    'User-Agent':        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
                         '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Accept':            'application/json, text/plain, */*',
    'Accept-Language':   'en-IN,en;q=0.9,hi;q=0.8',
    'Accept-Encoding':   'gzip, deflate, br',
    'Referer':           `${NPCI_BASE}/`,
    'Origin':            NPCI_BASE,
    'X-Requested-With':  'XMLHttpRequest',
    'Sec-Fetch-Dest':    'empty',
    'Sec-Fetch-Mode':    'cors',
    'Sec-Fetch-Site':    'same-origin',
    'Connection':        'keep-alive',
    'Cache-Control':     'no-cache',
    'Pragma':            'no-cache'
  }
}

/**
 * Try all known NPCI mandate GET endpoints.
 * Returns array of parsed mandates (may be empty).
 */
async function tryGetEndpoints(headers) {
  const results = []

  const endpoints = [
    '/api/mandate/list',
    '/api/mandate/active',
    '/api/mandate/all',
    '/api/autopay/mandates',
    '/api/autopay/list',
    '/api/upi/mandate/list',
    '/api/user/mandates',
    '/api/mandate/fetch',
    '/api/recurring/mandates',
    '/api/v1/mandate/list',
    '/api/v2/mandate/list',
    '/upi-help/api/mandate',
    '/api/mandate/history'
  ]

  for (const endpoint of endpoints) {
    try {
      const res = await axios.get(NPCI_BASE + endpoint, {
        headers,
        timeout:        TIMEOUT,
        validateStatus: s => s < 500   // don't throw on 4xx — log and continue
      })

      if (res.status === 200 && res.data) {
        const parsed = mandateParser.parse(res.data, endpoint)
        if (parsed.length > 0) {
          results.push(...parsed)
          console.log(`[NPCIService] GET ${endpoint} → ${parsed.length} mandates`)
          // Don't break — collect from all endpoints, deduplicate at the end
        } else {
          console.log(`[NPCIService] GET ${endpoint} → HTTP 200 but 0 mandates parsed`)
        }
      } else {
        console.log(`[NPCIService] GET ${endpoint} → HTTP ${res.status}`)
      }
    } catch (e) {
      // Network error / timeout — log and move on
      console.log(`[NPCIService] GET ${endpoint} failed: ${e.code || e.message}`)
    }
  }

  return results
}

/**
 * Try all known NPCI mandate POST endpoints.
 * Returns array of parsed mandates (may be empty).
 */
async function tryPostEndpoints(headers) {
  const results = []

  const endpoints = [
    {
      url:  '/api/mandate/list',
      body: { status: 'ALL', pageNo: 1, pageSize: 100 }
    },
    {
      url:  '/api/mandate/active',
      body: { status: 'ACTIVE', pageNo: 1, pageSize: 100 }
    },
    {
      url:  '/api/autopay/fetch',
      body: { type: 'ALL' }
    },
    {
      url:  '/api/mandate/history',
      body: { pageNo: 1, pageSize: 100, filter: 'ALL' }
    },
    {
      url:  '/api/v2/mandate/list',
      body: { status: 'ALL', pageNo: 1, pageSize: 100 }
    }
  ]

  for (const { url, body } of endpoints) {
    try {
      const res = await axios.post(NPCI_BASE + url, body, {
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        timeout:        TIMEOUT,
        validateStatus: s => s < 500
      })

      if (res.status === 200 && res.data) {
        const parsed = mandateParser.parse(res.data, url)
        if (parsed.length > 0) {
          results.push(...parsed)
          console.log(`[NPCIService] POST ${url} → ${parsed.length} mandates`)
        } else {
          console.log(`[NPCIService] POST ${url} → HTTP 200 but 0 mandates parsed`)
        }
      } else {
        console.log(`[NPCIService] POST ${url} → HTTP ${res.status}`)
      }
    } catch (e) {
      console.log(`[NPCIService] POST ${url} failed: ${e.code || e.message}`)
    }
  }

  return results
}

/**
 * Deduplicate mandates: UMN first, then mandateRef, then id.
 * Keeps the first occurrence of each unique key.
 */
function deduplicateMandates(mandates) {
  const seen = new Map()
  for (const m of mandates) {
    const key = m.umn || m.mandateRef || m.id
    if (key && !seen.has(key)) seen.set(key, m)
  }
  return Array.from(seen.values())
}

/**
 * Main entry point — try all GET and POST endpoints.
 * Called by /api/npci/fetch route (cookie-based fallback flow).
 *
 * Note: This fallback is secondary. The primary flow is the WebView
 * intercept → /api/npci/extract which is far more reliable since it
 * uses the browser session directly.
 */
async function fetchAllMandates(cookieObj) {
  if (!cookieObj || !cookieObj.raw) {
    console.log('[NPCIService] No cookies provided — skipping direct fetch')
    return []
  }

  const headers = buildHeaders(cookieObj)

  console.log('[NPCIService] Starting direct NPCI fetch...')

  // Run GET and POST endpoint probes in parallel for speed
  const [getResults, postResults] = await Promise.all([
    tryGetEndpoints(headers),
    tryPostEndpoints(headers)
  ])

  const combined   = [...getResults, ...postResults]
  const deduped    = deduplicateMandates(combined)

  console.log(
    `[NPCIService] Done — GET:${getResults.length} ` +
    `POST:${postResults.length} ` +
    `combined:${combined.length} ` +
    `deduped:${deduped.length}`
  )

  return deduped
}

module.exports = { fetchAllMandates }
