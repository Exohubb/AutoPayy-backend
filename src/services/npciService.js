const axios          = require('axios')
const mandateParser  = require('../utils/mandateParser')

const NPCI_BASE = 'https://www.upihelp.npci.org.in'
const TIMEOUT   = 8000   // 8 seconds per rule #8

/**
 * Fetch all autopay mandates from NPCI using the user's session cookies.
 * Tries multiple known endpoint patterns (both GET and POST).
 * Returns deduplicated mandate list or empty array on auth failure.
 */
async function fetchAllMandates(cookieObj) {
  const headers = {
    'Cookie':            cookieObj.raw || '',
    'User-Agent':        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept':            'application/json, text/plain, */*',
    'Accept-Language':   'en-IN,en;q=0.9',
    'Referer':           `${NPCI_BASE}/`,
    'Origin':            NPCI_BASE,
    'X-Requested-With':  'XMLHttpRequest'
  }

  const results = []

  // ── GET endpoints ───────────────────────────────────────────────
  const getEndpoints = [
    '/api/mandate/list',
    '/api/mandate/active',
    '/api/autopay/mandates',
    '/api/upi/mandate/list',
    '/upi-help/api/mandate',
    '/api/user/mandates',
    '/api/mandate/fetch',
    '/api/autopay/list',
    '/api/recurring/mandates',
    '/api/v1/mandate/list',
    '/api/v2/mandate/list'
  ]

  for (const endpoint of getEndpoints) {
    try {
      const res = await axios.get(NPCI_BASE + endpoint, {
        headers,
        timeout: TIMEOUT,
        validateStatus: s => s < 500
      })

      if (res.status === 200 && res.data) {
        const parsed = mandateParser.parse(res.data, endpoint)
        if (parsed.length > 0) {
          results.push(...parsed)
          console.log(`[NPCI] Found ${parsed.length} mandates at GET ${endpoint}`)
        }
      }
    } catch (e) {
      console.log(`[NPCI] GET ${endpoint} failed: ${e.message}`)
    }
  }

  // ── POST endpoints ──────────────────────────────────────────────
  const postEndpoints = [
    { url: '/api/mandate/list',   body: { status: 'ALL'    } },
    { url: '/api/mandate/active', body: { status: 'ACTIVE' } },
    { url: '/api/autopay/fetch',  body: { type:   'ALL'    } }
  ]

  for (const { url, body } of postEndpoints) {
    try {
      const res = await axios.post(NPCI_BASE + url, body, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        timeout: TIMEOUT,
        validateStatus: s => s < 500
      })

      if (res.status === 200 && res.data) {
        const parsed = mandateParser.parse(res.data, url)
        if (parsed.length > 0) {
          results.push(...parsed)
          console.log(`[NPCI] Found ${parsed.length} mandates at POST ${url}`)
        }
      }
    } catch (e) {
      console.log(`[NPCI] POST ${url} failed: ${e.message}`)
    }
  }

  // ── Deduplicate ─────────────────────────────────────────────────
  return deduplicateMandates(results)
}

/**
 * Remove duplicate mandates by mandateRef or id.
 */
function deduplicateMandates(mandates) {
  const seen = new Map()

  for (const m of mandates) {
    const key = m.mandateRef || m.umn || m.id
    if (!seen.has(key)) {
      seen.set(key, m)
    }
  }

  return Array.from(seen.values())
}

module.exports = { fetchAllMandates }
