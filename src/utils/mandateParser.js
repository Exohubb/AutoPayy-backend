const { v4: uuidv4 } = require('uuid')

// ── Field name mappings ───────────────────────────────────────────
// NPCI responses may use various field names for the same data.
// We try all known variations.

const MERCHANT_KEYS  = ['merchantName', 'merchant', 'payeeName', 'beneficiaryName', 'merchantVpa', 'payee', 'name', 'description']
const AMOUNT_KEYS    = ['amount', 'mandateAmount', 'maxAmount', 'limitAmount', 'debitAmount', 'amountLimit']
const FREQUENCY_KEYS = ['frequency', 'recurrencePattern', 'type', 'mandateType', 'billingCycle', 'recurrence']
const STATUS_KEYS    = ['status', 'mandateStatus', 'state', 'active']
const BANK_KEYS      = ['bankName', 'customerBank', 'debitBank', 'bankIfsc', 'bankCode', 'remitterBank']
const UPI_KEYS       = ['vpa', 'upiId', 'payeeVpa', 'merchantVpa']
const UMN_KEYS       = ['umn', 'umrn', 'uniqueMandateNumber']
const REF_KEYS       = ['mandateRef', 'mandateId', 'referenceId', 'txnRef', 'id']
const START_KEYS     = ['startDate', 'fromDate', 'validFrom', 'createdDate']
const END_KEYS       = ['endDate', 'toDate', 'validTill', 'expiryDate']
const NEXT_DATE_KEYS = ['nextDebitDate', 'nextExecutionDate', 'dueDate']

/**
 * Parse any NPCI response shape into a standard mandate array.
 * Handles: arrays, nested objects, paginated {data:[...]}, {mandates:[...]}, etc.
 */
function parse(responseData, endpoint) {
  const items = extractArray(responseData)
  if (!items || items.length === 0) return []

  const results = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue

    const mandate = {
      id:            findField(item, REF_KEYS) || uuidv4(),
      merchantName:  findField(item, MERCHANT_KEYS) || 'Unknown Merchant',
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

    // Only include if it looks like a real mandate (has name or amount)
    if (mandate.merchantName !== 'Unknown Merchant' || mandate.amount > 0) {
      results.push(mandate)
    }
  }

  return results
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Extract a flat array of mandate objects from any response shape.
 */
function extractArray(data) {
  if (Array.isArray(data)) return data

  if (data && typeof data === 'object') {
    // Try common wrapper keys
    const wrapperKeys = [
      'mandates', 'data', 'result', 'results', 'items',
      'records', 'list', 'mandateList', 'response', 'content'
    ]

    for (const key of wrapperKeys) {
      if (Array.isArray(data[key])) return data[key]
    }

    // Check nested: data.data, data.result.mandates, etc.
    if (data.data && typeof data.data === 'object') {
      for (const key of wrapperKeys) {
        if (Array.isArray(data.data[key])) return data.data[key]
      }
      if (Array.isArray(data.data)) return data.data
    }

    // If it's a single mandate object (has identifiable fields), wrap it
    if (findField(data, REF_KEYS) || findField(data, MERCHANT_KEYS)) {
      return [data]
    }
  }

  return []
}

/**
 * Find the first matching field value from an object given a list of key names.
 * Checks both exact and case-insensitive matches.
 */
function findField(obj, keys) {
  // Exact match first
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key]
    }
  }

  // Case-insensitive fallback
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

/**
 * Parse amount from various formats.
 */
function parseAmount(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[^0-9.]/g, '')
  return parseFloat(cleaned) || 0
}

/**
 * Normalize frequency strings to standard values.
 */
function normalizeFrequency(value) {
  if (!value) return 'Monthly'
  const lower = String(value).toLowerCase()

  if (lower.includes('month'))     return 'Monthly'
  if (lower.includes('week'))      return 'Weekly'
  if (lower.includes('year') || lower.includes('annual'))  return 'Yearly'
  if (lower.includes('quarter'))   return 'Quarterly'
  if (lower.includes('half'))      return 'Half-Yearly'
  if (lower.includes('daily') || lower.includes('day'))    return 'Daily'
  if (lower.includes('one') || lower.includes('once'))     return 'One-Time'
  if (lower.includes('bi-month'))  return 'Bi-Monthly'

  return 'Monthly'
}

/**
 * Normalize status strings.
 */
function normalizeStatus(value) {
  if (!value) return 'ACTIVE'
  const lower = String(value).toLowerCase()

  if (lower === 'true' || lower.includes('active'))    return 'ACTIVE'
  if (lower.includes('paus'))                          return 'PAUSED'
  if (lower.includes('cancel') || lower.includes('revok')) return 'CANCELLED'
  if (lower.includes('expir'))                         return 'EXPIRED'
  if (lower === 'false' || lower.includes('inactive')) return 'CANCELLED'

  return 'ACTIVE'
}

/**
 * Detect payment type from frequency.
 */
function detectPaymentType(frequency) {
  if (!frequency) return 'RECURRING'
  const lower = String(frequency).toLowerCase()
  if (lower.includes('one') || lower.includes('once') || lower.includes('single')) {
    return 'ONE_TIME'
  }
  return 'RECURRING'
}

module.exports = { parse }
