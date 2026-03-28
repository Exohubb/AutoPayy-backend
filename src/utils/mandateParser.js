'use strict'
const { v4: uuidv4 } = require('uuid')

// ─────────────────────────────────────────────────────────────────
// NPCI field key maps — covers all observed API response variations
// Includes: exact NPCI keys, camelCase, snake_case, UPPERCASE
// ─────────────────────────────────────────────────────────────────

const MERCHANT_KEYS = [
  'payee name', 'payeeName', 'merchantName', 'merchant', 'beneficiaryName',
  'merchantVpa', 'payee', 'creditorName', 'billerName', 'org', 'orgName',
  'Payee Name', 'Merchant Name', 'description',
  'payee_name', 'merchant_name', 'biller_name', 'creditor_name',
  'PAYEE NAME', 'MERCHANT NAME', 'PAYEENAME'
]

const AMOUNT_KEYS = [
  'amount', 'Amount', 'mandateAmount', 'maxAmount', 'limitAmount',
  'debitAmount', 'amountLimit', 'txnAmount', 'value', 'amt',
  'mandateAmt', 'Mandate Amount',
  'mandate_amount', 'max_amount', 'debit_amount', 'txn_amount',
  'AMOUNT', 'MANDATE AMOUNT'
]

const FREQUENCY_KEYS = [
  'recurrance', 'recurrence', 'Frequency', 'frequency', 'recurrencePattern',
  'mandateType', 'billingCycle', 'recurrenceRule', 'tenure', 'cycle',
  'Recurrence', 'Recurrance', 'type',
  'mandate_type', 'billing_cycle', 'recurrence_pattern',
  'RECURRANCE', 'FREQUENCY', 'RECURRENCE'
]

const STATUS_KEYS = [
  'Latest Status', 'latestStatus', 'latest_status', 'status', 'Status',
  'mandateStatus', 'state', 'mandateState', 'txnStatus',
  'mandate_status', 'txn_status',
  'LATEST STATUS', 'STATUS', 'MANDATE STATUS'
]

const UMN_KEYS = [
  'umn', 'UMN', 'umrn', 'uniqueMandateNumber', 'mandateUrn', 'Umn',
  'unique_mandate_number', 'mandate_urn', 'UMRN', 'Umrn'
]

const REF_KEYS = [
  'mandateRef', 'mandateId', 'referenceId', 'txnRef', 'id', 'mandateNo',
  'Mandate Ref', 'Mandate Id',
  'mandate_ref', 'mandate_id', 'reference_id', 'txn_ref', 'mandate_no',
  'MANDATE REF', 'MANDATE ID'
]

const START_KEYS = [
  'startDate', 'fromDate', 'validFrom', 'createdDate', 'createDate',
  'initiationDate', 'Start Date', 'start_date', 'From Date',
  'from_date', 'valid_from', 'created_date', 'initiation_date',
  'START DATE', 'FROM DATE'
]

const END_KEYS = [
  'endDate', 'toDate', 'validTill', 'expiryDate', 'validUpto', 'End Date',
  'end_date', 'Expiry Date', 'to_date', 'valid_till', 'expiry_date', 'valid_upto',
  'END DATE', 'EXPIRY DATE'
]

const NEXT_DATE_KEYS = [
  'nextDebitDate', 'nextExecutionDate', 'dueDate', 'nextDate',
  'Next Debit Date', 'Due Date',
  'next_debit_date', 'next_execution_date', 'due_date',
  'NEXT DEBIT DATE', 'DUE DATE'
]

const BANK_KEYS = [
  'Remitter Bank', 'remitterBank', 'remitter_bank', 'bankName', 'payerBank',
  'debitBank', 'bank', 'Bank Name', 'Payer Bank',
  'bank_name', 'payer_bank', 'debit_bank',
  'REMITTER BANK', 'BANK NAME', 'PAYER BANK'
]

const UPI_KEYS = [
  'vpa', 'upiId', 'payeeVpa', 'merchantVpa', 'payerVpa', 'creditorVpa',
  'Payee VPA', 'Payer VPA', 'VPA',
  'upi_id', 'payee_vpa', 'payer_vpa', 'merchant_vpa',
  'UPI ID', 'PAYEE VPA', 'PAYER VPA'
]

const CATEGORY_KEYS = [
  'category', 'Category', 'mandateCategory', 'categoryName',
  'mandate_category', 'Mandate Category', 'category_name',
  'CATEGORY', 'MANDATE CATEGORY'
]

const UPI_APP_KEYS = [
  'App', 'app', 'upiAppName', 'upiApp', 'appName', 'pspName', 'psp', 'PSP',
  'UPI App Name', 'App Name',
  'upi_app', 'app_name', 'psp_name', 'upi_app_name',
  'APP', 'PSP NAME', 'UPI APP'
]

const EXEC_COUNT_KEYS = [
  'Total Execution Count', 'totalExecutionCount', 'executionCount',
  'total_execution_count', 'Execution Count', 'execCount',
  'total_exec_count', 'exec_count',
  'TOTAL EXECUTION COUNT', 'EXECUTION COUNT'
]

const EXEC_AMOUNT_KEYS = [
  'Total Execution Amount', 'totalExecutionAmount', 'executionAmount',
  'total_execution_amount', 'Execution Amount', 'execAmount',
  'total_exec_amount', 'exec_amount',
  'TOTAL EXECUTION AMOUNT', 'EXECUTION AMOUNT'
]

const LAST_EXEC_KEYS = [
  'Last Execution Date', 'lastExecutionDate', 'last_execution_date',
  'lastDebitDate', 'lastExecDate', 'last_debit_date', 'last_exec_date',
  'LAST EXECUTION DATE', 'LAST DEBIT DATE'
]

const CREATION_KEYS = [
  'Creation Date', 'creationDate', 'creation_date', 'createdDate',
  'createDate', 'Created Date', 'created_at', 'create_date',
  'CREATION DATE', 'CREATED DATE'
]

const CAN_PAUSE_KEYS   = ['is_pause',   'isPause',   'canPause',   'pauseAllowed',   'is_pause_allowed']
const CAN_REVOKE_KEYS  = ['is_revoke',  'isRevoke',  'canRevoke',  'revokeAllowed',  'is_revoke_allowed']
const CAN_UNPAUSE_KEYS = ['is_unpause', 'isUnpause', 'canUnpause', 'unpauseAllowed', 'is_unpause_allowed']

// ── All mandate-identity keys (used by hasAnyMandateField) ──────────
const IDENTITY_KEYS = [...UMN_KEYS, ...MERCHANT_KEYS, ...AMOUNT_KEYS, ...REF_KEYS, ...UPI_KEYS]

// ── Array wrapper keys that NPCI APIs use ───────────────────────────
const ARRAY_WRAPPER_KEYS = [
  'mandates', 'mandateList', 'mandateDetails', 'autopayList', 'autoPayList',
  'data', 'content', 'result', 'results', 'items', 'list',
  'response', 'payload', 'body', 'records',
  'mandate_list', 'mandate_details', 'autopay_list', 'auto_pay_list'
]

// ── UMN @handle → bank name ─────────────────────────────────────────
const UMN_BANK_MAP = {
  'okicici': 'ICICI Bank',   'icici': 'ICICI Bank',
  'ptsbi':   'SBI',          'oksbi': 'SBI',           'sbi': 'SBI',
  'okhdfcbank': 'HDFC Bank', 'hdfcbank': 'HDFC Bank',  'hdfc': 'HDFC Bank',
  'okaxis':  'Axis Bank',    'axisbank': 'Axis Bank',   'axis': 'Axis Bank',
  'paytm':   'Paytm Payments Bank',
  'ybl':     'PhonePe (YES Bank)',
  'ibl':     'IndusInd Bank',
  'upi':     'UPI',
  'apl':     'Amazon Pay',
  'kotak':   'Kotak Bank',   'okkotak':  'Kotak Bank',
  'boi':     'Bank of India', 'pnb': 'PNB',
  'bob':     'Bank of Baroda', 'canara': 'Canara Bank',
  'union':   'Union Bank',   'idbi': 'IDBI Bank',
  'federal': 'Federal Bank', 'indus': 'IndusInd Bank',
  'rbl':     'RBL Bank',     'yesbank': 'YES Bank',
  'jupiteraxis': 'Jupiter (Axis)',
  'freecharge': 'Freecharge', 'slice': 'Slice',
  'fi':      'Fi Money',
  'airtel':  'Airtel Payments Bank',
  'jio':     'Jio Payments Bank', 'jiomoney': 'Jio Payments Bank'
}

// ── Garbage: NPCI chat thread titles that look like mandate objects ──
const GARBAGE_PATTERNS = [
  'new chat', 'revoke the mandate', 'pause the mandate',
  'cancel the mandate', 'unpause the mandate', 'resume the mandate',
  'raise complaint', 'check status', 'report issue'
]

// ─────────────────────────────────────────────────────────────────
// Core helper functions
// ─────────────────────────────────────────────────────────────────

/**
 * Find a field value in obj using three passes:
 * 1. Exact key match
 * 2. Case-insensitive match
 * 3. Normalized match (spaces, underscores, hyphens all treated equal)
 */
function findField(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null

  // Pass 1 — exact
  for (const key of keys) {
    const val = obj[key]
    if (val !== undefined && val !== null && val !== '') return val
  }

  // Pass 2 — case-insensitive
  const objKeys    = Object.keys(obj)
  const objLower   = objKeys.map(k => k.toLowerCase())
  for (const key of keys) {
    const idx = objLower.indexOf(key.toLowerCase())
    if (idx !== -1) {
      const val = obj[objKeys[idx]]
      if (val !== undefined && val !== null && val !== '') return val
    }
  }

  // Pass 3 — normalize (remove spaces / underscores / hyphens)
  const normalize = s => s.toLowerCase().replace(/[\s_\-]+/g, '')
  const objNorm   = objKeys.map(k => normalize(k))
  for (const key of keys) {
    const keyNorm = normalize(key)
    const idx = objNorm.indexOf(keyNorm)
    if (idx !== -1) {
      const val = obj[objKeys[idx]]
      if (val !== undefined && val !== null && val !== '') return val
    }
  }

  return null
}

/**
 * Extract a mandate array from various NPCI API response formats.
 * Handles: direct array, single-level wrapper, two-level nested wrapper.
 */
function extractArray(data) {
  if (!data) return []

  // Direct array
  if (Array.isArray(data)) return data

  if (typeof data !== 'object') return []

  const objKeys = Object.keys(data)

  // Pass 1 — known wrapper keys (exact)
  for (const key of ARRAY_WRAPPER_KEYS) {
    if (Array.isArray(data[key]) && data[key].length > 0) return data[key]
  }

  // Pass 2 — known wrapper keys (case-insensitive)
  const objLower = objKeys.map(k => k.toLowerCase())
  for (const key of ARRAY_WRAPPER_KEYS) {
    const idx = objLower.indexOf(key.toLowerCase())
    if (idx !== -1 && Array.isArray(data[objKeys[idx]]) && data[objKeys[idx]].length > 0) {
      return data[objKeys[idx]]
    }
  }

  // Pass 3 — any array value that contains objects (likely mandate list)
  for (const val of Object.values(data)) {
    if (Array.isArray(val) && val.length > 0 &&
        val.some(i => i && typeof i === 'object' && !Array.isArray(i))) {
      return val
    }
  }

  // Pass 4 — ONE level deeper (standard single-wrapper)
  // NOTE: deliberately NOT used for category-grouped — handled by
  // extractAllFromCategoryGrouped() called from parse() directly
  for (const val of Object.values(data)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const nested = extractArray(val)
      if (nested.length > 0) return nested
    }
  }

  return []
}

/**
 * NPCI returns mandates grouped by category:
 * {
 *   "ENTERTAINMENT & MEDIA": { "count": 1, "mandates": [{...}] },
 *   "OTHERS":                { "count": 2, "mandates": [{...},{...}] },
 *   "UTILITIES & BILL PAYMENTS": { "count": 1, "mandates": [{...}] }
 * }
 *
 * extractArray() only finds the FIRST category and stops.
 * This function collects from ALL categories in one pass.
 */
function extractAllFromCategoryGrouped(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []

  const all = []
  let isCategoryGrouped = false

  for (const [, val] of Object.entries(data)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue

    // Each category value has shape: { count: N, mandates: [...] }
    // Try all known array keys inside this nested object
    const nested = extractArray(val)
    if (nested.length > 0 && nested.some(i => hasAnyMandateField(i))) {
      isCategoryGrouped = true
      all.push(...nested)
    }
  }

  if (isCategoryGrouped) {
    console.log(`[Parser] category-grouped: collected ${all.length} total across all categories`)
  }

  return all
}

/**
 * Returns true if obj contains at least one field that looks like mandate data.
 */
function hasAnyMandateField(obj) {
  if (!obj || typeof obj !== 'object') return false
  return IDENTITY_KEYS.some(key => findField(obj, [key]) !== null)
}

/**
 * Unescape literal \uXXXX sequences in a string.
 * The Android DOM scraper may forward text that contains literal backslash-u
 * sequences (e.g., \u20B9 for ₹) that were never decoded by the browser.
 * JSON.parse handles \uXXXX in JSON strings, but DOM-scraped text passed
 * through the JavascriptInterface as a raw string bypasses that step.
 */
function unescapeUnicode(str) {
  return String(str).replace(/\\u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)))
}

/**
 * Parse amount from: number, "8300", "8,300", "₹ 8,300.00", "\u20B9 8,300", etc.
 */
function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0
  if (typeof val === 'number') return isNaN(val) ? 0 : val
  const n = parseFloat(unescapeUnicode(val).replace(/[₹,\s]/g, ''))
  return isNaN(n) ? 0 : n
}

/**
 * Normalize NPCI frequency strings to display labels.
 * NPCI uses 'CUSTOM' for most mandates — keep it but map known values.
 */
function normalizeFrequency(raw) {
  if (!raw) return 'MONTHLY'
  const r = String(raw).toUpperCase().trim()
  if (r.includes('DAILY') || r.includes('AS AND WHEN'))  return 'AS_PRESENTED'
  if (r.includes('WEEK'))   return 'WEEKLY'
  if (r.includes('FORT') || r.includes('BI_WEEK'))        return 'FORTNIGHTLY'
  if (r.includes('MONTH'))  return 'MONTHLY'
  if (r.includes('QUART'))  return 'QUARTERLY'
  if (r.includes('HALF') || r.includes('BIANN'))          return 'HALF_YEARLY'
  if (r.includes('YEAR') || r.includes('ANNUAL'))         return 'YEARLY'
  if (r === 'CUSTOM' || r === 'ONETIME' || r === 'ONE_TIME') return r
  return r || 'MONTHLY'
}

/**
 * Normalize NPCI status strings to canonical values.
 */
function normalizeStatus(raw) {
  if (!raw) return 'ACTIVE'
  const r = String(raw).toUpperCase().trim()
  if (r.includes('ACTIVE') || r.includes('LIVE'))    return 'ACTIVE'
  if (r.includes('PAUSE'))                            return 'PAUSED'
  if (r.includes('REVOK') || r.includes('CANCEL') ||
      r.includes('EXPIR') || r.includes('INACTIVE')) return 'REVOKED'
  if (r.includes('PEND') || r.includes('INIT'))      return 'PENDING'
  return 'ACTIVE'
}

/**
 * Detect payment type from frequency string.
 */
function detectPaymentType(raw) {
  if (!raw) return 'RECURRING'
  const r = String(raw).toUpperCase()
  return (r === 'ONETIME' || r === 'ONE_TIME') ? 'ONE_TIME' : 'RECURRING'
}

/**
 * Build a UPI revocation deep-link URI.
 */
function buildRevocationDeepLink(umn, merchantName, amount) {
  if (!umn) return ''
  const enc = encodeURIComponent
  return `upi://mandate?pa=${enc(umn)}&pn=${enc(merchantName || '')}&am=${amount || 0}&tn=Revoke&mc=0000&mode=04&purpose=14`
}

/**
 * Calculate next debit date by advancing refDate by frequency until > today.
 * Accepts dates in dd-MM-yyyy or dd/MM/yyyy format.
 */
function calculateNextDebitDate(refDate, frequency) {
  if (!refDate || !frequency) return ''
  const parts = String(refDate).split(/[-/]/)
  if (parts.length !== 3) return ''
  const [d, mo, y] = parts.map(Number)
  if (isNaN(d) || isNaN(mo) || isNaN(y)) return ''
  const date = new Date(y, mo - 1, d)
  if (isNaN(date.getTime())) return ''
  const now  = new Date()
  const freq = String(frequency).toLowerCase()
  let max    = 200
  while (date <= now && max-- > 0) {
    if      (freq.includes('week'))                    date.setDate(date.getDate() + 7)
    else if (freq.includes('year') || freq.includes('annual'))  date.setFullYear(date.getFullYear() + 1)
    else if (freq.includes('quart'))                   date.setMonth(date.getMonth() + 3)
    else if (freq.includes('half'))                    date.setMonth(date.getMonth() + 6)
    else if (freq === 'as_presented' || freq.includes('daily')) date.setDate(date.getDate() + 1)
    else                                               date.setMonth(date.getMonth() + 1)
  }
  return `${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`
}

/**
 * Infer category when NPCI doesn't provide one.
 */
function inferCategory(name) {
  const n = (name || '').toUpperCase()
  if (/NETFLIX|SPOTIFY|HOTSTAR|CRUNCHYROLL|YOUTUBE|PRIME|ZEE5|SONYLIV|DISCOVERY|JIOCINEMA|MXPLAYER/.test(n))
    return 'ENTERTAINMENT & MEDIA'
  if (/AIRTEL|JIO|VODAFONE|BSNL|VI |RELIANCE/.test(n))   return 'TELECOM'
  if (/LIC|TATA AIA|HDFC LIFE|ICICI PRU|BAJAJ|STAR HEALTH|MAX LIFE/.test(n)) return 'INSURANCE'
  if (/SIP|MUTUAL FUND|ZERODHA|GROWW|NIPPON|SBI MF|AXIS MF|KUVERA|PAYTM MONEY|MIRAE/.test(n)) return 'INVESTMENTS'
  if (/EMI|LOAN|BAJAJ FINANCE|HDFC CREDILA|INCRED|HOME LOAN|CAR LOAN/.test(n)) return 'LOAN EMI'
  if (/ELECTRICITY|WATER|GAS|BROADBAND|INTERNET|DTH|TATA SKY|DISH TV|FASTTAG/.test(n)) return 'UTILITIES & BILL PAYMENTS'
  if (/SWIGGY|ZOMATO|BLINKIT|DUNZO|ZEPTO/.test(n))      return 'FOOD & DELIVERY'
  if (/RAZORPAY|CASHFREE|STRIPE|PAYU|BILLDESK|HOSTINGER|GODADDY|AWS|GOOGLE|MICROSOFT/.test(n)) return 'BUSINESS & TECH'
  return 'OTHERS'
}

// ─────────────────────────────────────────────────────────────────
// Deep recursive search — fallback when extractArray finds nothing
// ─────────────────────────────────────────────────────────────────

function deepSearch(obj, depth = 0) {
  if (depth > 8 || !obj) return []
  const results = []

  if (Array.isArray(obj)) {
    // Check if this array itself contains mandate-like objects
    const direct = obj.filter(i => i && typeof i === 'object' && !Array.isArray(i) && hasAnyMandateField(i))
    if (direct.length > 0) return direct
    // Otherwise recurse into each element
    for (const item of obj) results.push(...deepSearch(item, depth + 1))
  } else if (typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      if (Array.isArray(val) && val.length > 0)              results.push(...deepSearch(val, depth + 1))
      else if (val && typeof val === 'object')               results.push(...deepSearch(val, depth + 1))
    }
  }
  return results
}

// ─────────────────────────────────────────────────────────────────
// DOM scrape fallback parser (Pass 3)
// ─────────────────────────────────────────────────────────────────

function parseTextContent(scrapeData) {
  const results = []
  const tables  = scrapeData.tables || []

  for (const table of tables) {
    if (!Array.isArray(table) || table.length < 2) continue
    const headers = table[0].map(h => (h || '').toLowerCase())

    for (let i = 1; i < table.length; i++) {
      const row = table[i]
      const m   = {
        id: uuidv4(), merchantName: 'Unknown', amount: 0,
        frequency: 'MONTHLY', status: 'ACTIVE',
        bankName: '', upiHandle: '', umn: '',
        mandateRef: uuidv4(), startDate: '', endDate: '',
        nextDebitDate: '', paymentType: 'RECURRING',
        source: 'NPCI', category: 'OTHERS',
        rawData: { tableRow: row, headers: table[0] }
      }

      for (let j = 0; j < headers.length && j < row.length; j++) {
        const h = headers[j]; const v = row[j]
        if (!v) continue
        if (h.includes('merchant') || h.includes('payee') || h.includes('name'))
          m.merchantName = v
        else if (h.includes('amount') || h.includes('amt'))
          m.amount = parseAmount(v)
        else if (h.includes('frequenc') || h.includes('recur'))
          m.frequency = normalizeFrequency(v)
        else if (h.includes('status') || h.includes('state'))
          m.status = normalizeStatus(v)
        else if (h.includes('bank') || h.includes('remit'))
          m.bankName = v
        else if (h.includes('vpa') || h.includes('upi'))
          m.upiHandle = v
        else if (h.includes('umn') || h.includes('urn'))
          m.umn = m.mandateRef = v
        else if (h.includes('start') || h.includes('creat') || h.includes('from'))
          m.startDate = v
        else if (h.includes('end') || h.includes('expir') || h.includes('to'))
          m.endDate = v
        else if (h.includes('next') || h.includes('due'))
          m.nextDebitDate = v
      }
      if (m.merchantName !== 'Unknown' || m.amount > 0) results.push(m)
    }
  }
  return results
}

// ─────────────────────────────────────────────────────────────────
// Build a single mandate object from a raw data item
// ─────────────────────────────────────────────────────────────────

function buildMandate(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null

  // Normalize: collapse spaces / underscores / hyphens, lowercase
  const norm     = s => s.toLowerCase().replace(/[\s_\-]+/g, '')
  const itemKeys = Object.keys(item)
  const itemNorm = itemKeys.map(k => norm(k))

  function get(keys) {
    for (const k of keys) {
      const idx = itemNorm.indexOf(norm(k))
      if (idx !== -1) {
        const val = item[itemKeys[idx]]
        if (val !== null && val !== undefined && val !== '') return val
      }
    }
    return null
  }

  // UMN is mandatory for NPCI mandates — rejects garbage chat/thread objects
  const umn = get(['umn'])
  if (!umn) return null

  const merchantName = get([
    'payee name', 'payeename', 'merchant_name', 'merchantname', 'merchant',
    'payee', 'creditorname', 'billername', 'description', 'org'
  ]) || 'Unknown Merchant'

  const rawFreq   = get(['recurrance', 'recurrence', 'frequency', 'mandatetype']) || 'CUSTOM'
  const rawStatus = get(['latest status', 'lateststatus', 'status', 'mandatestatus']) || 'ACTIVE'
  const rawCat    = get(['category', 'mandatecategory'])
  const amount    = parseAmount(get(['amount', 'mandateamount', 'maxamount', 'limitamount']))

  return {
    id:          String(umn),
    umn,
    mandateRef:  String(umn),   // UMN = canonical NPCI key; drives upsert dedup on user_id,mandate_ref

    merchantName,
    amount,
    frequency:   normalizeFrequency(rawFreq),
    status:      normalizeStatus(rawStatus),
    category:    rawCat ? String(rawCat).toUpperCase() : inferCategory(merchantName),

    upiAppName:  get(['app', 'upiapp', 'upiappname', 'upi_app_name', 'psp']) || null,
    upiHandle:   get(['vpa', 'upiid', 'payeevpa', 'payer vpa', 'merchantvpa']) || null,

    totalExecCount:  parseAmount(get(['total execution count', 'totalexecutioncount', 'executioncount', 'execcount'])),
    totalExecAmount: parseAmount(get(['total execution amount', 'totalexecutionamount', 'executionamount', 'execamount'])),

    canPause:   !!(get(['is_pause',   'ispause',   'canpause',   'pauseallowed'])),
    canRevoke:  !!(get(['is_revoke',  'isrevoke',  'canrevoke',  'revokeallowed'])),
    canUnpause: !!(get(['is_unpause', 'isunpause', 'canunpause', 'unpauseallowed'])),

    revocationDeepLink: buildRevocationDeepLink(umn, merchantName, amount),

    paymentType: detectPaymentType(rawFreq),
    source:      'NPCI',

    // ── Date fields — may be present in some NPCI response variants ──
    startDate:     get(['startdate', 'fromdate', 'validfrom']) || null,
    endDate:       get(['enddate',   'todate',   'validtill',  'expirydate']) || null,
    nextDebitDate: get(['nextdebitdate', 'nextexecutiondate',  'duedate']) || null,

    // ── Thread-only fields — always null at Phase 1, filled by /thread ──
    remitterBank:  null,
    lastExecDate:  null,
    creationDate:  null,
    threadId:      null,
    bankName:      null,

    rawData: { umn, merchant: merchantName, amount, status: rawStatus, frequency: rawFreq }
  }
}

// ─────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────

function parse(responseData, endpoint) {
  const results = []
  endpoint = endpoint || 'unknown'

  // ── Pass 1: direct array or known wrapper key ────────────────
  const items = extractArray(responseData)
  console.log(`[Parser] ${endpoint} → extractArray found ${items.length} items`)

  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const m = buildMandate(item)
      if (m) results.push(m)
    }
  }

  // ── Pass 1b: NPCI category-grouped response ───────────────────
  // Handles: {"ENTERTAINMENT & MEDIA":{"mandates":[...]}, "OTHERS":{"mandates":[...]}}
  // extractArray only finds the FIRST category. If the category-grouped collector
  // finds MORE items than Pass 1 did, replace results with the full set.
  if (responseData && typeof responseData === 'object' && !Array.isArray(responseData)) {
    const categoryItems = extractAllFromCategoryGrouped(responseData)
    if (categoryItems.length > results.length) {
      console.log(`[Parser] ${endpoint} → category-grouped found ${categoryItems.length} items (replacing Pass 1 result of ${results.length})`)
      results.length = 0
      for (const item of categoryItems) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const m = buildMandate(item)
          if (m) results.push(m)
        }
      }
    }
  }

  // ── Pass 2: deep recursive search ───────────────────────────
  if (results.length === 0 && responseData && typeof responseData === 'object') {
    console.log(`[Parser] ${endpoint} → pass 1 empty, trying deepSearch`)
    const deepItems = deepSearch(responseData)
    console.log(`[Parser] ${endpoint} → deepSearch found ${deepItems.length} items`)
    for (const item of deepItems) {
      const m = buildMandate(item)
      if (m) results.push(m)
    }
  }

  // ── Pass 3: DOM scrape fallback ──────────────────────────────
  if (results.length === 0 && responseData && responseData.source === 'dom_scrape') {
    console.log(`[Parser] ${endpoint} → trying DOM scrape fallback`)
    results.push(...parseTextContent(responseData))
  }

  // ── Fill missing nextDebitDate ───────────────────────────────
  for (const m of results) {
    if (!m.nextDebitDate) {
      const ref = m.lastExecDate || m.creationDate || m.startDate
      if (ref) m.nextDebitDate = calculateNextDebitDate(ref, m.frequency)
    }
  }

  // ── Filter NPCI chat garbage ─────────────────────────────────
  const cleaned = results.filter(m => {
    const nl = (m.merchantName || '').toLowerCase().trim()
    const isGarbage = GARBAGE_PATTERNS.some(p => nl.startsWith(p))
    if (isGarbage && m.amount <= 0) {
      console.log(`[Parser] Dropped garbage: "${m.merchantName}"`)
      return false
    }
    return true
  })

  // ── Deduplicate by UMN > mandateRef > id ─────────────────────
  const seen    = new Map()
  const deduped = []
  for (const m of cleaned) {
    const key = m.umn || m.mandateRef || m.id
    if (!seen.has(key)) { seen.set(key, true); deduped.push(m) }
  }

  console.log(`[Parser] endpoint=${endpoint} raw=${results.length} deduped=${deduped.length}`)
  return deduped
}

module.exports = { parse, unescapeUnicode }
