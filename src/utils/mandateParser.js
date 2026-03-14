const { v4: uuidv4 } = require('uuid')

// ── Field name mappings ───────────────────────────────────────────
const MERCHANT_KEYS  = ['merchantName', 'merchant', 'payeeName', 'beneficiaryName', 'merchantVpa', 'payee', 'name', 'description', 'creditorName', 'billerName', 'org', 'orgName', 'orgId']
const AMOUNT_KEYS    = ['amount', 'mandateAmount', 'maxAmount', 'limitAmount', 'debitAmount', 'amountLimit', 'txnAmount', 'value', 'amt', 'mandateAmt']
const FREQUENCY_KEYS = ['frequency', 'recurrencePattern', 'type', 'mandateType', 'billingCycle', 'recurrence', 'recurrenceRule', 'tenure', 'cycle']
const STATUS_KEYS    = ['status', 'mandateStatus', 'state', 'active', 'mandateState', 'txnStatus']
const BANK_KEYS      = ['bankName', 'customerBank', 'debitBank', 'bankIfsc', 'bankCode', 'remitterBank', 'payerBank', 'bank', 'bankAccountName', 'ifsc']
const UPI_KEYS       = ['vpa', 'upiId', 'payeeVpa', 'merchantVpa', 'payerVpa', 'creditorVpa', 'debtorVpa']
const UMN_KEYS       = ['umn', 'umrn', 'uniqueMandateNumber', 'mandateUrn', 'txnId', 'refId']
const REF_KEYS       = ['mandateRef', 'mandateId', 'referenceId', 'txnRef', 'id', 'mandateNo', 'seqNo', 'srno', 'complaintId', 'transactionId']
const START_KEYS     = ['startDate', 'fromDate', 'validFrom', 'createdDate', 'createDate', 'initiationDate', 'mandateDate']
const END_KEYS       = ['endDate', 'toDate', 'validTill', 'expiryDate', 'expiry', 'validUpto']
const NEXT_DATE_KEYS = ['nextDebitDate', 'nextExecutionDate', 'dueDate', 'nextDate']

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

  return results
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

  const mandate = {
    id:            findField(item, REF_KEYS) || uuidv4(),
    merchantName:  merchantName,
    amount:        parseAmount(findField(item, AMOUNT_KEYS)),
    frequency:     normalizeFrequency(findField(item, FREQUENCY_KEYS)),
    status:        normalizeStatus(findField(item, STATUS_KEYS)),
    bankName:      findField(item, BANK_KEYS) || '',
    upiHandle:     findField(item, UPI_KEYS) || '',
    umn:           findField(item, UMN_KEYS) || '',
    mandateRef:    findField(item, REF_KEYS) || uuidv4(),
    startDate:     findField(item, START_KEYS) || '',
    endDate:       findField(item, END_KEYS) || '',
    nextDebitDate: findField(item, NEXT_DATE_KEYS) || '',
    paymentType:   detectPaymentType(findField(item, FREQUENCY_KEYS)),
    source:        'NPCI',
    rawData:       item
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

/**
 * Recursively search through nested objects to find arrays of
 * objects that might be mandate data.
 */
function deepSearch(obj, depth = 0) {
  if (depth > 8) return []  // prevent infinite recursion
  const results = []

  if (Array.isArray(obj)) {
    // Check if array items look like mandates
    for (const item of obj) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        if (hasAnyField(item, [...MERCHANT_KEYS, ...AMOUNT_KEYS, ...UMN_KEYS, ...UPI_KEYS, ...REF_KEYS])) {
          results.push(item)
        }
      }
    }
    if (results.length > 0) return results

    // Recurse into array items
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
  // Case-insensitive check
  const objKeys = Object.keys(obj).map(k => k.toLowerCase())
  for (const key of keys) {
    if (objKeys.includes(key.toLowerCase())) return true
  }
  return false
}

// ── Text content parsing (DOM scrape fallback) ────────────────────

/**
 * Parse mandate data from scraped DOM text content.
 */
function parseTextContent(scrapeData) {
  const results = []
  const fullText = scrapeData.fullText || ''
  const tables = scrapeData.tables || []
  const amounts = scrapeData.amounts || []

  // Try to parse tables (rows with amount and merchant data)
  for (const table of tables) {
    if (table.length < 2) continue // need headers + at least 1 data row

    const headers = table[0].map(h => h.toLowerCase())
    for (let i = 1; i < table.length; i++) {
      const row = table[i]
      const mandate = {
        id:            uuidv4(),
        merchantName:  'Unknown Merchant',
        amount:        0,
        frequency:     'Monthly',
        status:        'ACTIVE',
        bankName:      '',
        upiHandle:     '',
        umn:           '',
        mandateRef:    uuidv4(),
        startDate:     '',
        endDate:       '',
        nextDebitDate: '',
        paymentType:   'RECURRING',
        source:        'NPCI',
        rawData:       { tableRow: row, headers: table[0] }
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

  // If no tables found mandate data, try parsing text blocks
  if (results.length === 0 && amounts.length > 0) {
    console.log(`[Parser] Found ${amounts.length} amounts in page text, attempting text extraction`)
    // Create generic mandates from visible amounts
    for (const amtStr of amounts) {
      const amt = parseAmount(amtStr)
      if (amt > 0) {
        results.push({
          id:            uuidv4(),
          merchantName:  'NPCI Mandate',
          amount:        amt,
          frequency:     'Monthly',
          status:        'ACTIVE',
          bankName:      '',
          upiHandle:     '',
          umn:           '',
          mandateRef:    uuidv4(),
          startDate:     '',
          endDate:       '',
          nextDebitDate: '',
          paymentType:   'RECURRING',
          source:        'NPCI',
          rawData:       { textAmount: amtStr }
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
  if (lower.includes('as presented') || lower.includes('as_presented')) return 'Monthly'
  return 'Monthly'
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
