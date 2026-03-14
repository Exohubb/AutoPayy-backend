const { v4: uuidv4 } = require('uuid')

// ── Field name mappings ───────────────────────────────────────────
const MERCHANT_KEYS  = ['merchantName', 'merchant', 'payeeName', 'payee name', 'beneficiaryName', 'merchantVpa', 'payee', 'name', 'description', 'creditorName', 'billerName', 'org', 'orgName', 'orgId', 'Payee Name', 'Merchant Name']
const AMOUNT_KEYS    = ['amount', 'Amount', 'mandateAmount', 'maxAmount', 'limitAmount', 'debitAmount', 'amountLimit', 'txnAmount', 'value', 'amt', 'mandateAmt', 'Mandate Amount']
const FREQUENCY_KEYS = ['frequency', 'Frequency', 'recurrencePattern', 'type', 'mandateType', 'billingCycle', 'recurrence', 'recurrance', 'recurrenceRule', 'tenure', 'cycle', 'Recurrence', 'Recurrance']
const STATUS_KEYS    = ['status', 'Status', 'mandateStatus', 'state', 'active', 'mandateState', 'txnStatus', 'Latest Status', 'latestStatus', 'latest_status']
const BANK_KEYS      = ['bankName', 'customerBank', 'debitBank', 'bankIfsc', 'bankCode', 'remitterBank', 'payerBank', 'bank', 'bankAccountName', 'ifsc', 'Bank Name', 'Bank', 'Payer Bank', 'Remitter Bank', 'remitter_bank']
const UPI_KEYS       = ['vpa', 'upiId', 'payeeVpa', 'merchantVpa', 'payerVpa', 'creditorVpa', 'debtorVpa', 'Payee VPA', 'Payer VPA', 'VPA']
const UMN_KEYS       = ['umn', 'UMN', 'umrn', 'uniqueMandateNumber', 'mandateUrn', 'txnId', 'refId', 'Umn']
const REF_KEYS       = ['mandateRef', 'mandateId', 'referenceId', 'txnRef', 'id', 'mandateNo', 'seqNo', 'srno', 'complaintId', 'transactionId', 'Mandate Ref', 'Mandate Id']
const START_KEYS     = ['startDate', 'fromDate', 'validFrom', 'createdDate', 'createDate', 'initiationDate', 'mandateDate', 'Start Date', 'start_date', 'From Date', 'Creation Date', 'creation_date']
const END_KEYS       = ['endDate', 'toDate', 'validTill', 'expiryDate', 'expiry', 'validUpto', 'End Date', 'end_date', 'Valid Till', 'Expiry Date']
const NEXT_DATE_KEYS = ['nextDebitDate', 'nextExecutionDate', 'dueDate', 'nextDate', 'Next Debit Date', 'Next Execution Date', 'Due Date']

// NPCI-specific fields
const CATEGORY_KEYS      = ['category', 'Category', 'mandateCategory', 'categoryName', 'mandate_category', 'type', 'mandateType', 'Mandate Category']
const UPI_APP_KEYS       = ['upiAppName', 'UPI App Name', 'upiApp', 'appName', 'app', 'App', 'App Name', 'pspName', 'psp', 'PSP']
const EXEC_COUNT_KEYS    = ['Total Execution Count', 'totalExecutionCount', 'executionCount', 'total_execution_count', 'Execution Count', 'execCount']
const EXEC_AMOUNT_KEYS   = ['Total Execution Amount', 'totalExecutionAmount', 'executionAmount', 'total_execution_amount', 'Execution Amount', 'execAmount']
const LAST_EXEC_DATE_KEYS= ['Last Execution Date', 'lastExecutionDate', 'last_execution_date', 'lastDebitDate', 'lastExecDate']
const CREATION_DATE_KEYS = ['Creation Date', 'creationDate', 'creation_date', 'createdDate', 'createDate', 'Created Date', 'created_at']
const IS_PAUSE_KEYS      = ['is_pause', 'isPause', 'canPause', 'pauseAllowed']
const IS_REVOKE_KEYS     = ['is_revoke', 'isRevoke', 'canRevoke', 'revokeAllowed']
const REMITTER_BANK_KEYS = ['Remitter Bank', 'remitterBank', 'remitter_bank', 'payerBankName', 'debitBankName']

// ── Garbage merchant names to drop (chat messages, not real mandates) ──
const GARBAGE_NAME_PATTERNS = [
  'new chat',
  'revoke the mandate',
  'pause the mandate',
  'cancel the mandate',
  'unpause the mandate',
  'resume the mandate'
]

/**
 * Calculate next debit date from frequency + a reference date.
 */
function calculateNextDebitDate(refDate, frequency) {
  if (!refDate || !frequency) return ''
  const parts = refDate.split(/[-/]/)
  if (parts.length !== 3) return ''
  const day = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10) - 1
  const year = parseInt(parts[2], 10)
  if (isNaN(day) || isNaN(month) || isNaN(year)) return ''
  const date = new Date(year, month, day)
  if (isNaN(date.getTime())) return ''
  const now = new Date()
  const freq = frequency.toLowerCase()
  let max = 120
  while (date <= now && max-- > 0) {
    if (freq.includes('month') || freq === 'custom') date.setMonth(date.getMonth() + 1)
    else if (freq.includes('week'))  date.setDate(date.getDate() + 7)
    else if (freq.includes('year') || freq.includes('annual')) date.setFullYear(date.getFullYear() + 1)
    else if (freq.includes('quarter')) date.setMonth(date.getMonth() + 3)
    else if (freq.includes('half'))   date.setMonth(date.getMonth() + 6)
    else if (freq.includes('daily') || freq.includes('day')) date.setDate(date.getDate() + 1)
    else date.setMonth(date.getMonth() + 1)
  }
  return `${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`
}

/**
 * Parse any response shape into a standard mandate array.
 * Handles: arrays, nested objects, paginated data, deep nesting.
 */
function parse(responseData, endpoint) {
  // First try: structured JSON parsing
  const items = extractArray(responseData)
  const results = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue

    const mandate = buildMandate(item)
    if (mandate) results.push(mandate)
  }

  // Second try: if nothing found, do deep recursive search
  if (results.length === 0 && responseData && typeof responseData === 'object') {
    const deepItems = deepSearch(responseData)
    for (const item of deepItems) {
      const mandate = buildMandate(item)
      if (mandate) results.push(mandate)
    }
  }

  // Third try: parse DOM scrape data
  if (results.length === 0 && responseData && responseData.source === 'dom_scrape') {
    const textMandates = parseTextContent(responseData)
    results.push(...textMandates)
  }

  // Calculate next debit date if missing
  for (const mandate of results) {
    if (!mandate.nextDebitDate) {
      const ref = mandate.lastExecDate || mandate.creationDate || mandate.startDate
      if (ref) mandate.nextDebitDate = calculateNextDebitDate(ref, mandate.frequency)
    }
  }

  // ── OUTPUT FILTER: remove garbage entries (chat messages) ──────
  // Instead of filtering input, just drop results that look like chat junk.
  // Chat junk = merchant name matches a chat pattern AND has no real amount.
  const cleaned = results.filter(m => {
    const nameLower = (m.merchantName || '').toLowerCase().trim()
    const isGarbageName = GARBAGE_NAME_PATTERNS.some(p => nameLower.startsWith(p))
    if (isGarbageName && m.amount <= 0) {
      console.log(`[Parser] Dropped garbage: "${m.merchantName}" (amount=${m.amount})`)
      return false
    }
    return true
  })

  console.log(`[Parser] Raw: ${results.length}, After filter: ${cleaned.length}`)
  return cleaned
}

/**
 * Build a standard mandate object from a data item.
 * Returns null if the item doesn't look like mandate data.
 */
function buildMandate(item) {
  if (!item || typeof item !== 'object') return null

  let merchantName = findField(item, MERCHANT_KEYS) || ''

  // If no merchant name found, try extracting from UPI/VPA handle
  if (!merchantName) {
    const upi = findField(item, UPI_KEYS) || ''
    if (upi.includes('@')) {
      merchantName = upi.split('@')[0]
    }
  }

  // Still no name? Scan all string values for potential merchant info
  if (!merchantName) {
    for (const key of Object.keys(item)) {
      const fieldVal = item[key]
      if (typeof fieldVal === 'string' && fieldVal.length > 2 && fieldVal.length < 100) {
        const lower = key.toLowerCase()
        if (lower.includes('name') || lower.includes('title') || lower.includes('label') ||
            lower.includes('desc') || lower.includes('merchant') || lower.includes('creditor') ||
            lower.includes('org') || lower.includes('company') || lower.includes('biller')) {
          merchantName = fieldVal
          break
        }
      }
    }
  }

  if (!merchantName) merchantName = 'Unknown Merchant'

  const umn = findField(item, UMN_KEYS) || ''
  let bankName = findField(item, BANK_KEYS) || ''
  let upiHandle = findField(item, UPI_KEYS) || ''

  // Extract bank & UPI handle from UMN (e.g. "abc123@okicici")
  if (umn.includes('@')) {
    const handle = umn.split('@')[1] || ''
    if (!upiHandle) upiHandle = umn

    // Map known UPI handles to bank names
    if (!bankName && handle) {
      const bankMap = {
        'okicici': 'ICICI Bank', 'icici': 'ICICI Bank',
        'ptsbi': 'SBI', 'oksbi': 'SBI', 'sbi': 'SBI',
        'okhdfcbank': 'HDFC Bank', 'hdfcbank': 'HDFC Bank',
        'okaxis': 'Axis Bank', 'axisbank': 'Axis Bank', 'axis': 'Axis Bank',
        'paytm': 'Paytm Payments Bank',
        'ybl': 'PhonePe (YES Bank)', 'ibl': 'IndusInd Bank',
        'upi': 'UPI', 'apl': 'Amazon Pay',
        'kotak': 'Kotak Bank', 'okkotak': 'Kotak Bank',
        'boi': 'Bank of India', 'pnb': 'PNB',
        'bob': 'Bank of Baroda', 'canara': 'Canara Bank',
        'union': 'Union Bank', 'idbi': 'IDBI Bank',
        'federal': 'Federal Bank', 'indus': 'IndusInd Bank',
        'rbl': 'RBL Bank', 'yesbank': 'YES Bank',
        'jupiteraxis': 'Jupiter (Axis)', 'freecharge': 'Freecharge',
        'slice': 'Slice', 'fi': 'Fi Money'
      }
      bankName = bankMap[handle.toLowerCase()] || handle.toUpperCase()
    }
  }

  // Also extract bank from Remitter Bank keys (may be more specific than generic BANK_KEYS)
  const remitterBank = findField(item, REMITTER_BANK_KEYS) || ''
  if (!bankName && remitterBank) bankName = remitterBank

  const mandate = {
    id:            findField(item, REF_KEYS) || uuidv4(),
    merchantName:  merchantName,
    amount:        parseAmount(findField(item, AMOUNT_KEYS)),
    frequency:     normalizeFrequency(findField(item, FREQUENCY_KEYS)),
    status:        normalizeStatus(findField(item, STATUS_KEYS)),
    bankName:      bankName,
    upiHandle:     upiHandle,
    umn:           umn,
    mandateRef:    findField(item, REF_KEYS) || uuidv4(),
    startDate:     findField(item, START_KEYS) || findField(item, CREATION_DATE_KEYS) || '',
    endDate:       findField(item, END_KEYS) || '',
    nextDebitDate: findField(item, NEXT_DATE_KEYS) || '',
    paymentType:   detectPaymentType(findField(item, FREQUENCY_KEYS)),
    source:        'NPCI',
    // NPCI-specific fields
    category:           findField(item, CATEGORY_KEYS) || '',
    upiAppName:         findField(item, UPI_APP_KEYS) || '',
    totalExecCount:     parseAmount(findField(item, EXEC_COUNT_KEYS)) || 0,
    totalExecAmount:    parseAmount(findField(item, EXEC_AMOUNT_KEYS)) || 0,
    lastExecDate:       findField(item, LAST_EXEC_DATE_KEYS) || '',
    creationDate:       findField(item, CREATION_DATE_KEYS) || findField(item, START_KEYS) || '',
    canPause:           !!findField(item, IS_PAUSE_KEYS),
    canRevoke:          !!findField(item, IS_REVOKE_KEYS),
    remitterBank:       remitterBank || bankName,
    rawData:            item
  }

  // Accept if it has a merchant name, or amount > 0, or has a UPI/UMN reference
  if (mandate.merchantName !== 'Unknown Merchant' ||
      mandate.amount > 0 ||
      mandate.upiHandle ||
      mandate.umn) {
    return mandate
  }

  return null
}

// ── Deep recursive search ─────────────────────────────────────────

function deepSearch(obj, depth = 0) {
  if (depth > 8) return []
  const results = []

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        if (hasAnyField(item, [...MERCHANT_KEYS, ...AMOUNT_KEYS, ...UMN_KEYS, ...UPI_KEYS, ...REF_KEYS])) {
          results.push(item)
        }
      }
    }
    if (results.length > 0) return results

    for (const item of obj) {
      results.push(...deepSearch(item, depth + 1))
    }
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      if (Array.isArray(val) && val.length > 0) {
        const sub = deepSearch(val, depth + 1)
        if (sub.length > 0) results.push(...sub)
      } else if (val && typeof val === 'object') {
        const sub = deepSearch(val, depth + 1)
        if (sub.length > 0) results.push(...sub)
      }
    }
  }

  return results
}

function hasAnyField(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return true
  }
  const objKeys = Object.keys(obj).map(k => k.toLowerCase())
  for (const key of keys) {
    if (objKeys.includes(key.toLowerCase())) return true
  }
  return false
}

// ── Text content parsing (DOM scrape fallback) ────────────────────

function parseTextContent(scrapeData) {
  const results = []
  const fullText = scrapeData.fullText || ''
  const tables = scrapeData.tables || []
  const amounts = scrapeData.amounts || []

  for (const table of tables) {
    if (table.length < 2) continue

    const headers = table[0].map(h => h.toLowerCase())
    for (let i = 1; i < table.length; i++) {
      const row = table[i]
      const mandate = {
        id: uuidv4(), merchantName: 'Unknown Merchant', amount: 0,
        frequency: 'Monthly', status: 'ACTIVE', bankName: '', upiHandle: '',
        umn: '', mandateRef: uuidv4(), startDate: '', endDate: '',
        nextDebitDate: '', paymentType: 'RECURRING', source: 'NPCI',
        rawData: { tableRow: row, headers: table[0] }
      }

      for (let j = 0; j < headers.length && j < row.length; j++) {
        const h = headers[j]
        const v = row[j]

        if (h.includes('merchant') || h.includes('payee') || h.includes('name') || h.includes('creditor') || h.includes('biller')) {
          mandate.merchantName = v
        } else if (h.includes('amount') || h.includes('amt') || h.includes('limit')) {
          mandate.amount = parseAmount(v)
        } else if (h.includes('frequency') || h.includes('recur') || h.includes('cycle')) {
          mandate.frequency = normalizeFrequency(v)
        } else if (h.includes('status') || h.includes('state')) {
          mandate.status = normalizeStatus(v)
        } else if (h.includes('bank') || h.includes('ifsc') || h.includes('remit')) {
          mandate.bankName = v
        } else if (h.includes('vpa') || h.includes('upi')) {
          mandate.upiHandle = v
        } else if (h.includes('umn') || h.includes('urn') || h.includes('ref')) {
          mandate.umn = v
          mandate.mandateRef = v
        } else if (h.includes('start') || h.includes('from') || h.includes('create')) {
          mandate.startDate = v
        } else if (h.includes('end') || h.includes('expir') || h.includes('valid')) {
          mandate.endDate = v
        } else if (h.includes('next') || h.includes('due')) {
          mandate.nextDebitDate = v
        }
      }

      if (mandate.merchantName !== 'Unknown Merchant' || mandate.amount > 0) {
        results.push(mandate)
      }
    }
  }

  if (results.length === 0 && amounts.length > 0) {
    console.log(`[Parser] Found ${amounts.length} amounts in page text, attempting text extraction`)
    for (const amtStr of amounts) {
      const amt = parseAmount(amtStr)
      if (amt > 0) {
        results.push({
          id: uuidv4(), merchantName: 'NPCI Mandate', amount: amt,
          frequency: 'Monthly', status: 'ACTIVE', bankName: '', upiHandle: '',
          umn: '', mandateRef: uuidv4(), startDate: '', endDate: '',
          nextDebitDate: '', paymentType: 'RECURRING', source: 'NPCI',
          rawData: { textAmount: amtStr }
        })
      }
    }
  }

  return results
}

// ── Helpers ───────────────────────────────────────────────────────

function extractArray(data) {
  if (Array.isArray(data)) return data

  if (data && typeof data === 'object') {
    const wrapperKeys = [
      'mandates', 'data', 'result', 'results', 'items',
      'records', 'list', 'mandateList', 'response', 'content',
      'complaints', 'transactions', 'txns', 'rows', 'entries',
      'payload', 'body', 'mandateDetails', 'details', 'info'
    ]

    for (const key of wrapperKeys) {
      if (Array.isArray(data[key])) return data[key]
    }

    // Check one level deeper
    if (data.data && typeof data.data === 'object') {
      for (const key of wrapperKeys) {
        if (Array.isArray(data.data[key])) return data.data[key]
      }
      if (Array.isArray(data.data)) return data.data
    }
    if (data.result && typeof data.result === 'object') {
      for (const key of wrapperKeys) {
        if (Array.isArray(data.result[key])) return data.result[key]
      }
    }

    // Single mandate object
    if (findField(data, REF_KEYS) || findField(data, MERCHANT_KEYS) || findField(data, UMN_KEYS)) {
      return [data]
    }

    // Last resort: check ALL keys for arrays of objects
    for (const key of Object.keys(data)) {
      const val = data[key]
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        return val
      }
    }
  }

  return []
}

function findField(obj, keys) {
  // Exact match
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key]
    }
  }
  // Case-insensitive
  const objKeys = Object.keys(obj)
  for (const key of keys) {
    const lower = key.toLowerCase()
    const match = objKeys.find(k => k.toLowerCase() === lower)
    if (match && obj[match] !== undefined && obj[match] !== null && obj[match] !== '') {
      return obj[match]
    }
  }
  return null
}

function parseAmount(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[₹,\s]/g, '').replace(/[^0-9.]/g, '')
  return parseFloat(cleaned) || 0
}

function normalizeFrequency(value) {
  if (!value) return 'Monthly'
  const lower = String(value).toLowerCase()
  if (lower.includes('month'))  return 'Monthly'
  if (lower.includes('week'))   return 'Weekly'
  if (lower.includes('year') || lower.includes('annual')) return 'Yearly'
  if (lower.includes('quarter')) return 'Quarterly'
  if (lower.includes('half'))   return 'Half-Yearly'
  if (lower.includes('daily') || lower.includes('day')) return 'Daily'
  if (lower.includes('one') || lower.includes('once')) return 'One-Time'
  if (lower.includes('as presented') || lower.includes('as_presented')) return 'As Presented'
  if (lower === 'custom') return 'Custom'
  return String(value)  // preserve original if unknown
}

function normalizeStatus(value) {
  if (!value) return 'ACTIVE'
  const lower = String(value).toLowerCase()
  if (lower === 'true' || lower.includes('active') || lower.includes('live') || lower.includes('approved')) return 'ACTIVE'
  if (lower.includes('paus'))   return 'PAUSED'
  if (lower.includes('cancel') || lower.includes('revok')) return 'CANCELLED'
  if (lower.includes('expir')) return 'EXPIRED'
  if (lower === 'false' || lower.includes('inactive')) return 'CANCELLED'
  return 'ACTIVE'
}

function detectPaymentType(frequency) {
  if (!frequency) return 'RECURRING'
  const lower = String(frequency).toLowerCase()
  if (lower.includes('one') || lower.includes('once') || lower.includes('single')) return 'ONE_TIME'
  return 'RECURRING'
}

module.exports = { parse }
