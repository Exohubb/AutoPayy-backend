'use strict'
const { createClient } = require('@supabase/supabase-js')

// ── Bug fix: was missing closing ) on createClient() ─────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role key — bypasses RLS
)

/**
 * Upsert mandates. Conflict on (user_id, mandate_ref).
 * UMN is the NPCI canonical identity — prefer it as the conflict key.
 */
async function saveMandates(userId, mandates) {
  if (!mandates || mandates.length === 0) return

  const rows = mandates.map(m => ({
    user_id:            userId,
    mandate_ref:        m.mandateRef || m.id || '',
    umn:                m.umn        || null,
    merchant_name:      m.merchantName,
    amount:             m.amount,
    frequency:          m.frequency,
    status:             m.status,
    bank_name:          m.bankName          || null,
    upi_handle:         m.upiHandle         || null,
    next_debit_date:    m.nextDebitDate      || null,
    start_date:         m.startDate         || null,
    end_date:           m.endDate           || null,
    creation_date:      m.creationDate      || null,
    last_exec_date:     m.lastExecDate      || null,
    total_exec_count:   m.totalExecCount    || 0,
    total_exec_amount:  m.totalExecAmount   || 0,
    category:           m.category          || 'OTHERS',
    upi_app_name:       m.upiAppName        || null,
    remitter_bank:      m.remitterBank      || m.bankName || null,
    can_pause:          m.canPause          || false,
    can_revoke:         m.canRevoke         || false,
    can_unpause:        m.canUnpause        || false,
    revocation_deep_link: m.revocationDeepLink || null,
    payment_type:       m.paymentType       || 'RECURRING',
    thread_id:          m.threadId          || null,
    source:             'NPCI',
    raw_data:           m.rawData           || null,
    updated_at:         new Date().toISOString()
  }))

  const { error } = await supabase
    .from('npci_mandates')
    .upsert(rows, { onConflict: 'user_id,mandate_ref' })

  if (error) {
    console.error('[Supabase] saveMandates error:', error.message)
    throw error
  }

  console.log(`[Supabase] Upserted ${rows.length} mandates for user ${userId}`)
}

/**
 * Get all mandates for a user, newest first.
 */
async function getMandates(userId) {
  const { data, error } = await supabase
    .from('npci_mandates')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[Supabase] getMandates error:', error.message)
    throw error
  }

  return (data || []).map(row => ({
    id:                 row.id,
    merchantName:       row.merchant_name,
    amount:             parseFloat(row.amount)          || 0,
    frequency:          row.frequency,
    status:             row.status,
    bankName:           row.bank_name,
    upiHandle:          row.upi_handle,
    nextDebitDate:      row.next_debit_date,
    startDate:          row.start_date,
    endDate:            row.end_date,
    creationDate:       row.creation_date,
    lastExecDate:       row.last_exec_date,
    totalExecCount:     row.total_exec_count  || 0,
    totalExecAmount:    parseFloat(row.total_exec_amount) || 0,
    category:           row.category          || 'OTHERS',
    upiAppName:         row.upi_app_name,
    remitterBank:       row.remitter_bank,
    canPause:           row.can_pause         || false,
    canRevoke:          row.can_revoke        || false,
    canUnpause:         row.can_unpause       || false,
    revocationDeepLink: row.revocation_deep_link,
    mandateRef:         row.mandate_ref,
    umn:                row.umn,
    paymentType:        row.payment_type,
    source:             'NPCI'
  }))
}

/** Update status of a single mandate. */
async function updateMandateStatus(userId, mandateRef, status) {
  const { error } = await supabase
    .from('npci_mandates')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('mandate_ref', mandateRef)

  if (error) {
    console.error('[Supabase] updateMandateStatus error:', error.message)
    throw error
  }
}

/** Get mandates filtered by status. */
async function getMandatesByStatus(userId, status) {
  const { data, error } = await supabase
    .from('npci_mandates')
    .select('*')
    .eq('user_id', userId)
    .eq('status', status)
    .order('amount', { ascending: false })

  if (error) throw error
  return data || []
}

/** Log a fetch session (metadata only, no tokens stored). */
async function logSession(userId, totalFound) {
  const { error } = await supabase
    .from('npci_sessions')
    .insert({
      user_id:     userId,
      total_found: totalFound,
      status:      totalFound > 0 ? 'SUCCESS' : 'EMPTY'
    })

  if (error) console.error('[Supabase] logSession error (non-fatal):', error.message)
}

/**
 * Upsert user's UPI profile into the users table.
 * Adds vpa, upi_app, bank_name columns if they exist.
 */
async function upsertUserProfile(userId, profile) {
  const { error } = await supabase
    .from('users')
    .upsert({
      id:        userId,
      vpa:       profile.vpa  || null,
      upi_app:   profile.app  || null,
      bank_name: profile.bank || null
    }, { onConflict: 'id' })

  if (error) {
    console.error('[Supabase] upsertUserProfile error:', error.message)
    throw error
  }
  console.log(`[Supabase] Profile updated for user ${userId}: vpa=${profile.vpa}`)
}

/**
 * Enrich an existing mandate row with data scraped from the NPCI thread page.
 * Matches by (user_id, umn).
 */
async function enrichMandateFromThread(userId, umn, threadId, tableRows) {
  const extra = {
    thread_id:  threadId,
    updated_at: new Date().toISOString()
  }

  for (const row of (tableRows || [])) {
    const field = (row.field || '').toLowerCase().trim()
    const raw   = (row.value || '').trim()
    const num   = raw.replace(/[₹,\s]/g, '')

    if (field.includes('last execution date')) extra.last_exec_date      = raw
    if (field.includes('creation date'))       extra.creation_date       = raw
    if (field.includes('execution count'))     extra.total_exec_count    = parseInt(num)    || 0
    if (field.includes('execution amount'))    extra.total_exec_amount   = parseFloat(num)  || 0
    if (field.includes('remitter bank'))       extra.remitter_bank       = raw
    if (field.includes('upi app'))             extra.upi_app_name        = raw
    if (field.includes('category'))            extra.category            = raw.toUpperCase()
    if (field.includes('status'))              extra.status              = raw.toUpperCase()
    if (field.includes('frequency'))           extra.frequency           = raw.toUpperCase()
  }

  const { error } = await supabase
    .from('npci_mandates')
    .update(extra)
    .eq('umn', umn)
    .eq('user_id', userId)

  if (error) {
    console.error('[Supabase] enrichMandateFromThread error:', error.message)
    throw error
  }
  console.log(`[Supabase] Thread-enriched mandate ${umn}: ${Object.keys(extra).join(', ')}`)
  return extra
}

/**
 * Look up a mandate's UMN by merchant name when the JS harvest script
 * couldn't extract it from the DOM (returns null if not found).
 */
async function findUmnByMerchantName(userId, merchantName) {
  const { data, error } = await supabase
    .from('npci_mandates')
    .select('umn')
    .eq('user_id', userId)
    .ilike('merchant_name', merchantName.trim())
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[Supabase] findUmnByMerchantName error:', error.message)
    return null
  }
  return data?.umn || null
}

module.exports = { saveMandates, getMandates, updateMandateStatus, getMandatesByStatus, logSession, upsertUserProfile, enrichMandateFromThread, findUmnByMerchantName }
