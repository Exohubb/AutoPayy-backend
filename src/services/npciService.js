const axios = require('axios')
const mandateParser = require('../utils/mandateParser')

const NPCI_BASE = 'https://www.upihelp.npci.org.in'
const TIMEOUT   = 10000

/**
 * Build request headers mimicking a real mobile browser session on NPCI.
 * Based on observed requests from the real NPCI UPI Help portal.
 */
function buildHeaders(cookieObj) {
  return {
    'Cookie':            cookieObj.raw || '',
    'User-Agent':        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Accept':            'application/json, text/plain, */*',
    'Accept-Language':   'en-IN,en;q=0.9,hi;q=0.8',
    'Accept-Encoding':   'gzip, deflate, br',
    'Referer':           `${NPCI_BASE}/`,
    'Origin':            NPCI_BASE,
    'X-Requested-With':  'XMLHttpRequest',
    'Sec-Fetch-Dest':    'empty',
    'Sec-Fetch-Mode':    'cors',
    'Sec-Fetch-Site':    'same-origin',
    'Connection':        'keep-alive'
  }
}

/**
 * Try all known NPCI mandate endpoints.
 * The /extract route (intercepted WebView responses) is the primary flow.
 * This is the fallback for the /fetch route.
 */
async function fetchAllMandates(cookieObj) {
  const headers = buildHeaders(cookieObj)
  const results = []

  const getEndpoints = [
    '/api/mandate/list',
    '/api/mandate/active',
    '/api/autopay/mandates',
    '/api/upi/mandate/list',
    '/api/user/mandates',
    '/api/mandate/fetch',
    '/api/autopay/list',
    '/api/recurring/mandates',
    '/api/v1/mandate/list',
    '/api/v2/mandate/list',
    '/upi-help/api/mandate'
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
          console.log(`[NPCIService] GET ${endpoint} → ${parsed.length} mandates`)
        }
      } else {
        console.log(`[NPCIService] GET ${endpoint} → HTTP ${res.status}`)
      }
    } catch (e) {
      console.log(`[NPCIService] GET ${endpoint} failed: ${e.message}`)
    }
  }

  const postEndpoints = [
    { url: '/api/mandate/list',   body: { status: 'ALL',    pageNo: 1, pageSize: 100 } },
    { url: '/api/mandate/active', body: { status: 'ACTIVE', pageNo: 1, pageSize: 100 } },
    { url: '/api/autopay/fetch',  body: { type: 'ALL' } }
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
          console.log(`[NPCIService] POST ${url} → ${parsed.length} mandates`)
        }
      }
    } catch (e) {
      console.log(`[NPCIService] POST ${url} failed: ${e.message}`)
    }
  }

  return deduplicateMandates(results)
}

/** Deduplicate: UMN first, then mandateRef, then id. */
function deduplicateMandates(mandates) {
  const seen = new Map()
  for (const m of mandates) {
    const key = m.umn || m.mandateRef || m.id
    if (!seen.has(key)) seen.set(key, m)
  }
  return Array.from(seen.values())
}

module.exports = { fetchAllMandates }
