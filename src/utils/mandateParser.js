const { v4: uuidv4 } = require('uuid')

// ── Exact NPCI field names (from real intercepted HTML/JSON) ──────
// Key insight from source: 'payee name' (with space), 'recurrance' (typo in NPCI),
// 'Latest Status', 'Total Execution Count', 'Total Execution Amount'
const MERCHANT_KEYS = [
  'payee name', 'payeeName', 'merchantName', 'merchant', 'beneficiaryName',
  'merchantVpa', 'payee', 'name', 'creditorName', 'billerName',
  'org', 'orgName', 'Payee Name', 'Merchant Name', 'description'
]
const AMOUNT_KEYS = [
  'amount', 'Amount', 'mandateAmount', 'maxAmount', 'limitAmount',
  'debitAmount', 'amountLimit', 'txnAmount', 'value', 'amt',
  'mandateAmt', 'Mandate Amount'
]
// NPCI uses 'recurrance' (their typo) — keep both spellings
const FREQUENCY_KEYS = [
  'recurrance', 'recurrence', 'Frequency', 'frequency', 'recurrencePattern',
  'mandateType', 'billingCycle', 'recurrenceRule', 'tenure', 'cycle',
  'Recurrence', 'Recurrance', 'type'
]
const STATUS_KEYS = [
  'Latest Status', 'latestStatus', 'latest_status', 'status', 'Status',
  'mandateStatus', 'state', 'mandateState', 'txnStatus'
]
const UMN_KEYS  = ['umn', 'UMN', 'umrn', 'uniqueMandateNumber', 'mandateUrn', 'Umn']
const REF_KEYS  = ['mandateRef', 'mandateId', 'referenceId', 'txnRef', 'id', 'mandateNo', 'Mandate Ref', 'Mandate Id']
const START_KEYS = ['startDate', 'fromDate', 'validFrom', 'createdDate', 'createDate', 'initiationDate', 'Start Date', 'start_date', 'From Date']
const END_KEYS   = ['endDate', 'toDate', 'validTill', 'expiryDate', 'validUpto', 'End Date', 'end_date', 'Expiry Date']
const NEXT_DATE_KEYS = ['nextDebitDate', 'nextExecutionDate', 'dueDate', 'nextDate', 'Next Debit Date', 'Due Date']
const BANK_KEYS  = ['Remitter Bank', 'remitterBank', 'remitter_bank', 'bankName', 'payerBank', 'debitBank', 'bank', 'Bank Name', 'Payer Bank']
const UPI_KEYS   = ['vpa', 'upiId', 'payeeVpa', 'merchantVpa', 'payerVpa', 'creditorVpa', 'Payee VPA', 'Payer VPA', 'VPA']

// NPCI-specific enrichment fields
const CATEGORY_KEYS    = ['category', 'Category', 'mandateCategory', 'categoryName', 'mandate_category', 'Mandate Category']
const UPI_APP_KEYS     = ['App', 'app', 'upiAppName', 'upiApp', 'appName', 'pspName', 'psp', 'PSP', 'UPI App Name', 'App Name']
const EXEC_COUNT_KEYS  = ['Total Execution Count', 'totalExecutionCount', 'executionCount', 'total_execution_count', 'Execution Count', 'execCount']
const EXEC_AMOUNT_KEYS = ['Total Execution Amount', 'totalExecutionAmount', 'executionAmount', 'total_execution_amount', 'Execution Amount', 'execAmount']
const LAST_EXEC_KEYS   = ['Last Execution Date', 'lastExecutionDate', 'last_execution_date', 'lastDebitDate', 'lastExecDate']
const CREATION_KEYS    = ['Creation Date', 'creationDate', 'creation_date', 'createdDate', 'createDate', 'Created Date', 'created_at']
const CAN_PAUSE_KEYS   = ['is_pause', 'isPause', 'canPause', 'pauseAllowed']
const CAN_REVOKE_KEYS  = ['is_revoke', 'isRevoke', 'canRevoke', 'revokeAllowed']
const CAN_UNPAUSE_KEYS = ['is_unpause', 'isUnpause', 'canUnpause', 'unpauseAllowed']

// ── UMN suffix → bank name map (covers all major Indian UPI handles) ─
const UMN_BANK_MAP = {
  'okicici': 'ICICI Bank',    'icici': 'ICICI Bank',
  'ptsbi': 'SBI',             'oksbi': 'SBI',          'sbi': 'SBI',
  'okhdfcbank': 'HDFC Bank',  'hdfcbank': 'HDFC Bank', 'hdfc': 'HDFC Bank',
  'okaxis': 'Axis Bank',      'axisbank': 'Axis Bank', 'axis': 'Axis Bank',
  'paytm': 'Paytm Payments Bank',
  'ybl': 'PhonePe (YES Bank)', 'ibl': 'IndusInd Bank',
  'upi': 'UPI',               'apl': 'Amazon Pay',
  'kotak': 'Kotak Bank',      'okkotak': 'Kotak Bank',
  'boi': 'Bank of India',     'pnb': 'PNB',
  'bob': 'Bank of Baroda',    'canara': 'Canara Bank',
  'union': 'Union Bank',      'idbi': 'IDBI Bank',
  'federal': 'Federal Bank',  'indus': 'IndusInd Bank',
  'rbl': 'RBL Bank',          'yesbank': 'YES Bank',
  'jupiteraxis': 'Jupiter (Axis)',
  'freecharge': 'Freecharge',  'slice': 'Slice',
  'fi': 'Fi Money',           'airtel': 'Airtel Payments Bank',
  'jio': 'Jio Payments Bank', 'jiomoney': 'Jio Payments Bank'
}

// ── Garbage filter — these are NPCI chat thread titles, not mandates ─
const GARBAGE_PATTERNS = [
  'new chat', 'revoke the mandate', 'pause the mandate',
  'cancel the mandate', 'unpause the mandate', 'resume the mandate',
  'raise complaint', 'check status', 'report issue'
]

// ── Build UPI revocation deep-link ────────────────────────────────
// Format compatible with PhonePe, Paytm, GPay for mandate revocation
function buildRevocationDeepLink(umn, merchantName, amount) {
  if (!umn) return ''
  const enc = encodeURIComponent
  return `upi://mandate?pa=${enc(umn)}&pn=${enc(merchantName || '')}&am=${amount || 0}&tn=Revoke&mc=0000&mode=04&purpose=14`
}

// ── Calculate next debit date from last/creation date + frequency ──
function calculateNextDebitDate(refDate, frequency) {
  if (!refDate || !frequency) return ''
  const parts = refDate.split(/[-/]/)
  if (parts.length !== 3) return ''
  const [d, mo, y] = parts.map(Number)
  if (isNaN(d) || isNaN(mo) || isNaN(y)) return ''
  const date = new Date(y, mo - 1, d)
  if (isNaN(date.getTime())) return ''
  const now = new Date()
  const freq = frequency.toLowerCase()
  let max = 120
  while (date <= now && max-- > 0) {
    if      (freq.includes('week'))                     date.setDate(date.getDate() + 7)
    else if (freq.includes('year') || freq.includes('annual')) date.setFullYear(date.getFullYear() + 1)
    else if (freq.includes('quarter'))                  date.setMonth(date.getMonth() + 3)
    else if (freq.includes('half'))                     date.setMonth(date.getMonth() + 6)
    else if (freq.includes('daily') || freq === 'as and when presented') date.setDate(date.getDate() + 1)
    else                                                date.setMonth(date.getMonth() + 1) // monthly / custom
  }
  return `${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`
}

// ── Main entry point ──────────────────────────────────────────────
function parse(responseData, endpoint) {
  const results = []

  // Pass 1: direct array or known wrapper key
  const items = extractArray(responseData)
  for (const item of items) {
    if (item && typeof item === 'object') {
      const m = buildMandate(item)
      if (m) results.push(m)
    }
  }

  // Pass 2: deep recursive search (only if pass 1 found nothing)
  if (results.length === 0 && responseData && typeof responseData === 'object') {
    const deepItems = deepSearch(responseData)
    for (const item of deepItems) {
      const m = buildMandate(item)
      if (m) results.push(m)
    }
  }

  // Pass 3: DOM scrape fallback
  if (results.length === 0 && responseData && responseData.source === 'dom_scrape') {
    results.push(...parseTextContent(responseData))
  }

  // Fill missing nextDebitDate
  for (const m of results) {
    if (!m.nextDebitDate) {
      const ref = m.lastExecDate || m.creationDate || m.startDate
      if (ref) m.nextDebitDate = calculateNextDebitDate(ref, m.frequency)
    }
  }

  // Filter out NPCI chat garbage
  const cleaned = results.filter(m => {
    const nl = (m.merchantName || '').toLowerCase().trim()
    const isGarbage = GARBAGE_PATTERNS.some(p => nl.startsWith(p))
    if (isGarbage && m.amount <= 0) {
      console.log(`[Parser] Dropped garbage: "${m.merchantName}"`)
      return false
    }
    return true
  })

  console.log(`[Parser] endpoint=${endpoint} raw=${results.length} clean=${cleaned.length}`)
  return cleaned
}

// ── Build one mandate from a raw data object ───────────────────────
function buildMandate(item) {
  if (!item || typeof item !== 'object') return null

  // ── Merchant name ──────────────────────────────────────────────
  let merchantName = findField(item, MERCHANT_KEYS) || ''
  if (!merchantName) {
    const upi = findField(item, UPI_KEYS) || ''
    if (upi.includes('@')) merchantName = upi.split('@')[0]
  }
  if (!merchantName) {
    for (const key of Object.keys(item)) {
      const v = item[key]
      if (typeof v === 'string' && v.length > 2 && v.length < 100) {
        const kl = key.toLowerCase()
        if (kl.includes('name') || kl.includes('merchant') || kl.includes('creditor') ||
            kl.includes('biller') || kl.includes('org') || kl.includes('company')) {
          merchantName = v
          break
        }
      }
    }
  }
  if (!merchantName) merchantName = 'Unknown Merchant'

  // ── UMN + bank derivation ──────────────────────────────────────
  const umn        = findField(item, UMN_KEYS)  || ''
  let   bankName   = findField(item, BANK_KEYS) || ''
  let   upiHandle  = findField(item, UPI_KEYS)  || ''

  if (umn.includes('@')) {
    if (!upiHandle) upiHandle = umn
    const suffix = umn.split('@')[1] || ''
    if (!bankName) bankName = UMN_BANK_MAP[suffix.toLowerCase()] || suffix.toUpperCase()
  }

  // ── Amount ────────────────────────────────────────────────────
  const amount = parseAmount(findField(item, AMOUNT_KEYS))

  // ── Accept gate: must have something meaningful ───────────────
  if (merchantName === 'Unknown Merchant' && amount <= 0 && !umn && !upiHandle) return null

  // ── NPCI enrichment fields ────────────────────────────────────
  const totalExecCount  = parseAmount(findField(item, EXEC_COUNT_KEYS))  || 0
  const totalExecAmount = parseAmount(findField(item, EXEC_AMOUNT_KEYS)) || 0
  const lastExecDate    = findField(item, LAST_EXEC_KEYS)  || ''
  const creationDate    = findField(item, CREATION_KEYS)   || findField(item, START_KEYS) || ''
  const canPause        = !!findField(item, CAN_PAUSE_KEYS)
  const canRevoke       = !!findField(item, CAN_REVOKE_KEYS)
  const canUnpause      = !!findField(item, CAN_UNPAUSE_KEYS)
  const upiAppName      = findField(item, UPI_APP_KEYS) || ''
  const category        = findField(item, CATEGORY_KEYS) || inferCategory(merchantName)
  const frequency       = normalizeFrequency(findField(item, FREQUENCY_KEYS))

  return {
    id:                 findField(item, REF_KEYS) || uuidv4(),
    merchantName,
    amount,
    frequency,
    status:             normalizeStatus(findField(item, STATUS_KEYS)),
    bankName,
    upiHandle,
    umn,
    mandateRef:         findField(item, REF_KEYS) || uuidv4(),
    startDate:          findField(item, START_KEYS) || creationDate,
    endDate:            findField(item, END_KEYS)   || '',
    nextDebitDate:      findField(item, NEXT_DATE_KEYS) || '',
    paymentType:        detectPaymentType(findField(item, FREQUENCY_KEYS)),
    source:             'NPCI',
    // ── enriched fields ──────────────────────────────────────────
    category,
    upiAppName,
    totalExecCount,
    totalExecAmount,
    lastExecDate,
    creationDate,
    canPause,
    canRevoke,
    canUnpause,
    remitterBank:       bankName,
    revocationDeepLink: buildRevocationDeepLink(umn, merchantName, amount),
    rawData: { merchant: merchantName, amount, umn, status: findField(item, STATUS_KEYS) || '' }
  }
}

// ── Infer category from merchant name when NPCI doesn't provide it ─
function inferCategory(name) {
  const n = (name || '').toUpperCase()
  if (/NETFLIX|SPOTIFY|HOTSTAR|CRUNCHYROLL|YOUTUBE|PRIME|ZEE5|SONYLIV|DISCOVERY|JIOCINEMA|MXPLAYER/.test(n)) return 'ENTERTAINMENT & MEDIA'
  if (/AIRTEL|JIO|VODAFONE|BSNL|VI |RELIANCE/.test(n))   return 'TELECOM'
  if (/LIC|TATA AIA|HDFC LIFE|ICICI PRU|BAJAJ|STAR HEALTH|MAX LIFE/.test(n)) return 'INSURANCE'
  if (/SIP|MUTUAL FUND|ZERODHA|GROWW|NIPPON|SBI MF|AXIS MF|KUVERA|PAYTM MONEY|MIRAE/.test(n)) return 'INVESTMENTS'
  if (/EMI|LOAN|BAJAJ FINANCE|HDFC CREDILA|INCRED|KOTAK LOAN|HOME LOAN|CAR LOAN/.test(n)) return 'LOAN EMI'
  if (/ELECTRICITY|WATER|GAS|BROADBAND|INTERNET|DTH|TATA SKY|DISH TV|FASTTAG|FASTAG/.test(n)) return 'UTILITIES & BILL PAYMENTS'
  if (/SWIGGY|ZOMATO|BLINKIT|DUNZO|ZEPTO/.test(n))       return 'FOOD & DELIVERY'
  if (/RAZORPAY|CASHFREE|STRIPE|PAYU|PAYGATE|BILLDESK|HOSTINGER|GODADDY|AWS|GOOGLE|MICROSOFT/.test(n)) return 'BUSINESS & TECH'
  return 'OTHERS'
}

// ── Deep recursive search ─────────────────────────────────────────
function deepSearch(obj, depth = 0) {
  if (depth > 8) return []
  const results = []
  const allKeys = [...MERCHANT_KEYS, ...AMOUNT_KEYS, ...UMN_KEYS, ...UPI_KEYS, ...REF_KEYS]

  if (Array.isArray(obj)) {
    const direct = obj.filter(i => i && typeof i === 'object' && !Array.isArray(i) && hasAnyField(i, allKeys))
    if (direct.length > 0) return direct
    for (const item of obj) results.push(...deepSearch(item, depth + 1))
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      if (Array.isArray(val) && val.length > 0)          results.push(...deepSearch(val, depth + 1))
      else if (val && typeof val === 'object')            results.push(...deepSearch(val, depth + 1))
    }
  }
  return results
}

function hasAnyField(obj, keys) {
  const objKeysLower = Object.keys(obj).map(k => k.toLowerCase())
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return true
    if (objKeysLower.includes(key.toLowerCase())) return true
  }
  return false
}

// ── DOM scrape / text fallback ────────────────────────────────────
function parseTextContent(scrapeData) {
  const results = []
  const tables  = scrapeData.tables  || []
  const amounts = scrapeData.amounts || []

  for (const table of tables) {
    if (table.length < 2) continue
    const headers = table[0].map(h => (h || '').toLowerCase())
    for (let i = 1; i < table.length; i++) {
      const row = table[i]
      const m = { id: uuidv4(), merchantName: 'Unknown Merchant', amount: 0, frequency: 'MONTHLY', status: 'ACTIVE', bankName: '', upiHandle: '', umn: '', mandateRef: uuidv4(), startDate: '', endDate: '', nextDebitDate: '', paymentType: 'RECURRING', source: 'NPCI', category: 'OTHERS', rawData: { tableRow: row, headers: table[0] } }
      for (let j = 0; j < headers.length && j < row.length; j++) {
        const h = headers[j]; const v = row[j]
        if      (h.includes('merchant') || h.includes('payee') || h.includes('name'))  m.merchantName = v
        else if (h.includes('amount')   || h.includes('amt'))                          m.amount       = parseAmount(v)
        else if (h.includes('frequenc') || h.includes('recur'))                        m.frequency    = normalizeFrequency(v)
        else if (h.includes('status')   || h.includes('state'))                        m.status       = normalizeStatus(v)
        else if (h.includes('bank')     || h.includes('remit'))                        m.bankName     = v
        else if (h.includes('vpa')      || h.includes('upi'))                          m.upiHandle    = v
        else if (h.includes('umn')      || h.includes('urn'))                          m.umn = m.mandateRef = v
        else if (h.includes('start')    || h.includes('creat'))                        m.startDate    = v
        else if (h.includes('end')      || h.includes('expir'))                        m.endDate      = v
        else if (h.includes('next')     || h.includes('due'))                          m.nextDebitDate = v
      }
      if (m.merchantName !== 'Unknown Merchant' || m.amount > 0) results.push(m)
    }
  }

  if (results.length === 0) {
    for (const amtStr of amounts) {
      const amt = parseAmount(amtStr)
      if (amt > 0) results.push({ id: uuidv4(), merchantName: 'NPCI Mandate', amount: amt, frequency: 'MONTHLY', status: 'ACTIVE', bankName: '', upiHandle: '', umn: '', mandateRef: uuidv4(), startDate: '', endDate: '', nextDebitDate: '', paymentType: 'RECURRING', source: 'NPCI', category: 'OTHERS', rawData: { textAmount: amtStr } })
    }
  }
  return results
}

// ── extractArray: unwrap common response envelope keys ────────────
function extractArray(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const wrappers = ['mandates','data','result','results','items','records','list','mandateList','response','content','complaints','transactions','txns','rows','entries','payload','body','mandateDetails','details','info','autopay']
    for (const key of wrappers) {
      if (Array.isArray(data[key])) return data[key]
    }
  }
  return []
}

// ── Normalizers ───────────────────────────────────────────────────
function normalizeFrequency(raw) {
  if (!raw) return 'MONTHLY'
  const r = String(raw).toUpperCase().trim()
  if (r === 'CUSTOM')     return 'CUSTOM'
  if (r.includes('WEEK')) return 'WEEKLY'
  if (r.includes('YEAR') || r.includes('ANNUAL')) return 'YEARLY'
  if (r.includes('QUART')) return 'QUARTERLY'
  if (r.includes('HALF'))  return 'HALF_YEARLY'
  if (r.includes('DAILY') || r === 'AS AND WHEN PRESENTED') return 'DAILY'
  if (r.includes('MONTH')) return 'MONTHLY'
  return r || 'MONTHLY'
}

function normalizeStatus(raw) {
  if (!raw) return 'ACTIVE'
  const r = String(raw).toUpperCase().trim()
  if (r.includes('ACTIVE'))   return 'ACTIVE'
  if (r.includes('REVOK') || r.includes('CANCEL') || r.includes('CANCEL')) return 'REVOKED'
  if (r.includes('PAUS') || r.includes('SUSPEND')) return 'PAUSED'
  if (r.includes('EXPIR'))    return 'EXPIRED'
  if (r.includes('PENDING'))  return 'PENDING'
  if (r.includes('MODIF'))    return 'MODIFIED'
  return 'ACTIVE'
}

function detectPaymentType(raw) {
  if (!raw) return 'RECURRING'
  const r = String(raw).toUpperCase()
  if (r.includes('ONE') || r.includes('SINGLE') || r.includes('ONETIME')) return 'ONE_TIME'
  return 'RECURRING'
}

function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return 0
  if (typeof raw === 'number') return raw
  const cleaned = String(raw).replace(/[₹,\s]/g, '').replace(/[^0-9.]/g, '')
  return parseFloat(cleaned) || 0
}

function findField(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key]
  }
  // Case-insensitive fallback
  const objKeys = Object.keys(obj)
  for (const key of keys) {
    const found = objKeys.find(k => k.toLowerCase() === key.toLowerCase())
    if (found && obj[found] !== undefined && obj[found] !== null && obj[found] !== '') return obj[found]
  }
  return null
}

module.exports = { parse }
