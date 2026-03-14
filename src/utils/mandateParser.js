const { v4: uuidv4 } = require('uuid')

// ── Field name mappings ───────────────────────────────────────────
// Includes actual NPCI field names (with spaces, misspellings, etc.)
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
const CATEGORY_KEYS      = ['category', 'Category', 'mandateCategory', 'categoryName', 'mandate_category', 'mandateType', 'Mandate Category']
const UPI_APP_KEYS       = ['upiAppName', 'UPI App Name', 'upiApp', 'appName', 'App', 'App Name', 'pspName', 'psp', 'PSP']
const EXEC_COUNT_KEYS    = ['Total Execution Count', 'totalExecutionCount', 'executionCount', 'total_execution_count', 'Execution Count', 'execCount']
const EXEC_AMOUNT_KEYS   = ['Total Execution Amount', 'totalExecutionAmount', 'executionAmount', 'total_execution_amount', 'Execution Amount', 'execAmount']
const LAST_EXEC_DATE_KEYS= ['Last Execution Date', 'lastExecutionDate', 'last_execution_date', 'lastDebitDate', 'lastExecDate']
const CREATION_DATE_KEYS = ['Creation Date', 'creationDate', 'creation_date', 'createdDate', 'createDate', 'Created Date']
const IS_PAUSE_KEYS      = ['is_pause', 'isPause', 'canPause', 'pauseAllowed']
const IS_REVOKE_KEYS     = ['is_revoke', 'isRevoke', 'canRevoke', 'revokeAllowed']
const REMITTER_BANK_KEYS = ['Remitter Bank', 'remitterBank', 'remitter_bank', 'payerBankName', 'debitBankName']

// UMN handle → bank name map (shared)
const BANK_MAP = {
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

// ── Chat detection ────────────────────────────────────────────────
const CHAT_TITLE_PATTERNS = [
  'new chat',
  'revoke the mandate',
  'pause the mandate',
  'cancel the mandate',
  'unpause the mandate',
  'resume the mandate'
]

function isChatMessage(item) {
  if (!item || typeof item !== 'object') return false
  // Must have BOTH message_count AND last_session_id (be strict)
  if (item.message_count !== undefined &&
      item.last_session_id !== undefined) {
    return true
  }
  // Title-only check for chat patterns
  const title = (item.title || '').toLowerCase().trim()
  if (title && CHAT_TITLE_PATTERNS.some(p => title.startsWith(p))) {
    return true
  }
  return false
}

// ── Extract mandates FROM chat content ────────────────────────────

/**
 * Parse NPCI chat messages and build real mandates from the markdown
 * tables inside last_message_content.
 *
 * Returns { enrichmentByUmn, mandatesFromChats }
 */
function extractFromChats(items) {
  const enrichmentByUmn = {}
  const mandatesFromChats = []

  for (const item of items) {
    if (!isChatMessage(item)) continue
    const content = item.last_message_content || ''
    if (!content) continue

    // Parse markdown table rows: | Field | Value |
    const tableRows = content.match(/\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)
    if (!tableRows || tableRows.length < 2) continue

    const data = {}
    for (const row of tableRows) {
      const cells = row.split('|').map(c => c.trim()).filter(c => c && !c.match(/^[-:]+$/))
      if (cells.length >= 2) {
        const key = cells[0].toLowerCase().replace(/\*+/g, '').trim()
        const val = cells[1].trim()
        if (key && val && key !== 'field' && key !== 'detail' && key !== 'value') {
          data[key] = val
        }
      }
    }
    if (Object.keys(data).length === 0) continue

    // Extract UMN from intent link in the chat content
    const umnMatch = content.match(/umn=([a-f0-9]+@[a-z]+)/i)
    const umn = umnMatch ? umnMatch[1] : ''

    // Store enrichment data keyed by UMN
    const enrichment = {
      upiAppName:   data['upi app name'] || data['linked app'] || '',
      category:     data['category'] || '',
      remitterBank: data['remitter bank'] || data['bank'] || '',
      lastExecDate: data['last execution date'] || '',
      execCount:    parseAmount(data['execution count'] || '0'),
      execAmount:   parseAmount(data['execution amount'] || '0'),
      creationDate: data['creation date'] || '',
      upiId:        data['upi id (vpa)'] || data['upi id'] || '',
      frequency:    data['frequency'] || '',
      status:       data['status'] || '',
      payeeName:    data['payee name'] || '',
      amount:       parseAmount(data['amount'] || '0'),
    }
    if (umn) enrichmentByUmn[umn] = enrichment

    // ── Build a full mandate if we have enough data ──────────
    const merchantName = enrichment.payeeName
    const amount       = enrichment.amount
    if (!merchantName || (amount <= 0 && !umn)) continue   // skip profile-only chats

    let bankName = enrichment.remitterBank
    if (!bankName && umn && umn.includes('@')) {
      const handle = (umn.split('@')[1] || '').toLowerCase()
      bankName = BANK_MAP[handle] || handle.toUpperCase()
    }

    const freq    = normalizeFrequency(enrichment.frequency)
    const refDate = enrichment.lastExecDate || enrichment.creationDate

    mandatesFromChats.push({
      id:                uuidv4(),
      merchantName,
      amount,
      frequency:         freq,
      status:            normalizeStatus(enrichment.status),
      bankName:          bankName || '',
      upiHandle:         umn || '',
      umn,
      mandateRef:        uuidv4(),
      startDate:         enrichment.creationDate || '',
      endDate:           '',
      nextDebitDate:     refDate ? calculateNextDebitDate(refDate, freq) : '',
      paymentType:       detectPaymentType(enrichment.frequency),
      source:            'NPCI',
      category:          enrichment.category || '',
      upiAppName:        enrichment.upiAppName || '',
      totalExecCount:    enrichment.execCount || 0,
      totalExecAmount:   enrichment.execAmount || 0,
      lastExecDate:      enrichment.lastExecDate || '',
      creationDate:      enrichment.creationDate || '',
      canPause:          true,
      canRevoke:         true,
      remitterBank:      bankName || '',
      rawData:           data,
    })
    console.log(`[Parser] ✓ Chat→Mandate: ${merchantName} ₹${amount} umn=${umn}`)
  }

  console.log(`[Parser] extractFromChats: ${mandatesFromChats.length} mandates from chat content`)
  return { enrichmentByUmn, mandatesFromChats }
}

// ── Next-date calculator ──────────────────────────────────────────

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

// ══════════════════════════════════════════════════════════════════
//  MAIN PARSE FUNCTION
// ══════════════════════════════════════════════════════════════════

function parse(responseData, endpoint) {
  const items = extractArray(responseData)
  const results = []

  // ── Step 1: extract mandates + enrichment from chats ───────
  const { enrichmentByUmn, mandatesFromChats } = extractFromChats(items)

  // ── Step 2: parse non-chat items the normal way ────────────
  let chatCount = 0
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    if (isChatMessage(item)) { chatCount++; continue }
    const mandate = buildMandate(item)
    if (mandate) results.push(mandate)
  }

  console.log(`[Parser] items=${items.length} chats=${chatCount} directMandates=${results.length} chatMandates=${mandatesFromChats.length}`)

  // ── Step 3: deep search if nothing found directly ──────────
  if (results.length === 0 && responseData && typeof responseData === 'object') {
    const deepItems = deepSearch(responseData)
    for (const item of deepItems) {
      if (isChatMessage(item)) continue
      const mandate = buildMandate(item)
      if (mandate) results.push(mandate)
    }
    if (results.length > 0) console.log(`[Parser] Deep search found ${results.length}`)
  }

  // ── Step 4: DOM scrape fallback ────────────────────────────
  if (results.length === 0 && responseData && responseData.source === 'dom_scrape') {
    results.push(...parseTextContent(responseData))
  }

  // ── Step 5: merge in chat-extracted mandates ───────────────
  if (mandatesFromChats.length > 0) {
    results.push(...mandatesFromChats)
  }

  // ── Step 6: apply enrichment + calculate missing dates ─────
  for (const mandate of results) {
    if (mandate.umn && enrichmentByUmn[mandate.umn]) {
      const e = enrichmentByUmn[mandate.umn]
      if (!mandate.upiAppName && e.upiAppName) mandate.upiAppName = e.upiAppName
      if (!mandate.category && e.category) mandate.category = e.category
      if (!mandate.remitterBank && e.remitterBank) {
        mandate.remitterBank = e.remitterBank
        if (!mandate.bankName) mandate.bankName = e.remitterBank
      }
      if (!mandate.lastExecDate && e.lastExecDate) mandate.lastExecDate = e.lastExecDate
      if (!mandate.totalExecCount && e.execCount) mandate.totalExecCount = e.execCount
      if (!mandate.totalExecAmount && e.execAmount) mandate.totalExecAmount = e.execAmount
      if (!mandate.creationDate && e.creationDate) mandate.creationDate = e.creationDate
    }
    if (!mandate.nextDebitDate) {
      const ref = mandate.lastExecDate || mandate.creationDate || mandate.startDate
      if (ref) mandate.nextDebitDate = calculateNextDebitDate(ref, mandate.frequency)
    }
  }

  console.log(`[Parser] Final: ${results.length} mandates`)
  return results
}

// ══════════════════════════════════════════════════════════════════
//  buildMandate — from a raw JSON object (non-chat)
// ══════════════════════════════════════════════════════════════════

function buildMandate(item) {
  if (!item || typeof item !== 'object') return null
  if (isChatMessage(item)) return null

  let merchantName = findField(item, MERCHANT_KEYS) || ''

  if (!merchantName) {
    const upi = findField(item, UPI_KEYS) || ''
    if (upi.includes('@')) merchantName = upi.split('@')[0]
  }

  if (!merchantName) {
    for (const key of Object.keys(item)) {
      const fieldVal = item[key]
      if (typeof fieldVal === 'string' && fieldVal.length > 2 && fieldVal.length < 100) {
        const lower = key.toLowerCase()
        if (lower.includes('name') || lower.includes('label') ||
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

  if (umn.includes('@')) {
    const handle = umn.split('@')[1] || ''
    if (!upiHandle) upiHandle = umn
    if (!bankName && handle) {
      bankName = BANK_MAP[handle.toLowerCase()] || handle.toUpperCase()
    }
  }

  const remitterBank = findField(item, REMITTER_BANK_KEYS) || ''
  if (!bankName && remitterBank) bankName = remitterBank

  const mandate = {
    id:            findField(item, REF_KEYS) || uuidv4(),
    merchantName,
    amount:        parseAmount(findField(item, AMOUNT_KEYS)),
    frequency:     normalizeFrequency(findField(item, FREQUENCY_KEYS)),
    status:        normalizeStatus(findField(item, STATUS_KEYS)),
    bankName,
    upiHandle,
    umn,
    mandateRef:    findField(item, REF_KEYS) || uuidv4(),
    startDate:     findField(item, START_KEYS) || findField(item, CREATION_DATE_KEYS) || '',
    endDate:       findField(item, END_KEYS) || '',
    nextDebitDate: findField(item, NEXT_DATE_KEYS) || '',
    paymentType:   detectPaymentType(findField(item, FREQUENCY_KEYS)),
    source:        'NPCI',
    category:      findField(item, CATEGORY_KEYS) || '',
    upiAppName:    findField(item, UPI_APP_KEYS) || '',
    totalExecCount:  parseAmount(findField(item, EXEC_COUNT_KEYS)) || 0,
    totalExecAmount: parseAmount(findField(item, EXEC_AMOUNT_KEYS)) || 0,
    lastExecDate:    findField(item, LAST_EXEC_DATE_KEYS) || '',
    creationDate:    findField(item, CREATION_DATE_KEYS) || findField(item, START_KEYS) || '',
    canPause:        !!findField(item, IS_PAUSE_KEYS),
    canRevoke:       !!findField(item, IS_REVOKE_KEYS),
    remitterBank:    remitterBank || bankName,
    rawData:         item,
  }

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
        results.push(...deepSearch(val, depth + 1))
      } else if (val && typeof val === 'object') {
        results.push(...deepSearch(val, depth + 1))
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

// ── DOM scrape fallback ───────────────────────────────────────────

function parseTextContent(scrapeData) {
  const results = []
  const tables = scrapeData.tables || []
  const amounts = scrapeData.amounts || []

  for (const table of tables) {
    if (table.length < 2) continue
    const headers = table[0].map(h => h.toLowerCase())
    for (let i = 1; i < table.length; i++) {
      const row = table[i]
      const m = {
        id: uuidv4(), merchantName: 'Unknown Merchant', amount: 0,
        frequency: 'Monthly', status: 'ACTIVE', bankName: '', upiHandle: '',
        umn: '', mandateRef: uuidv4(), startDate: '', endDate: '',
        nextDebitDate: '', paymentType: 'RECURRING', source: 'NPCI',
        rawData: { tableRow: row, headers: table[0] }
      }
      for (let j = 0; j < headers.length && j < row.length; j++) {
        const h = headers[j], v = row[j]
        if (h.includes('merchant') || h.includes('payee') || h.includes('name')) m.merchantName = v
        else if (h.includes('amount') || h.includes('amt')) m.amount = parseAmount(v)
        else if (h.includes('frequency') || h.includes('recur')) m.frequency = normalizeFrequency(v)
        else if (h.includes('status')) m.status = normalizeStatus(v)
        else if (h.includes('bank') || h.includes('remit')) m.bankName = v
        else if (h.includes('vpa') || h.includes('upi')) m.upiHandle = v
        else if (h.includes('umn') || h.includes('ref')) { m.umn = v; m.mandateRef = v }
        else if (h.includes('start') || h.includes('create')) m.startDate = v
        else if (h.includes('end') || h.includes('expir')) m.endDate = v
        else if (h.includes('next') || h.includes('due')) m.nextDebitDate = v
      }
      if (m.merchantName !== 'Unknown Merchant' || m.amount > 0) results.push(m)
    }
  }

  if (results.length === 0 && amounts.length > 0) {
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
    // Single mandate object — but NOT a chat
    if (!isChatMessage(data) &&
        (findField(data, REF_KEYS) || findField(data, MERCHANT_KEYS) || findField(data, UMN_KEYS))) {
      return [data]
    }
    // Last resort: arrays of objects inside any key
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
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key]
  }
  const objKeys = Object.keys(obj)
  for (const key of keys) {
    const lower = key.toLowerCase()
    const match = objKeys.find(k => k.toLowerCase() === lower)
    if (match && obj[match] !== undefined && obj[match] !== null && obj[match] !== '') return obj[match]
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
  return String(value)
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
