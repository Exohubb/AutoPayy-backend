'use strict'
const { createClient } = require('@supabase/supabase-js')
const { unescapeUnicode } = require('../utils/mandateParser')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role key — bypasses RLS
)

/**
 * Upsert mandates. Conflict on (user_id, mandate_ref).
 * UMN is the NPCI canonical identity — prefer it as the conflict key.
 * Columns removed: bank_name, upi_handle, next_debit_date, start_date, end_date, thread_id
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
    creation_date:      m.creationDate      || null,
    last_exec_date:     m.lastExecDate      || null,
    total_exec_count:   m.totalExecCount    || 0,
    total_exec_amount:  m.totalExecAmount   || 0,
    category:           m.category          || 'OTHERS',
    upi_app_name:       m.upiAppName        || null,
    remitter_bank:      m.remitterBank      || null,
    can_pause:          m.canPause          || false,
    can_revoke:         m.canRevoke         || false,
    can_unpause:        m.canUnpause        || false,
    revocation_deep_link: m.revocationDeepLink || null,
    payment_type:       m.paymentType       || 'RECURRING',
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
 * Increment npci_fetch_count and refresh mandate_count for a user.
 * Called automatically after every successful mandate save.
 */
async function incrementFetchCount(userId, mandateCount) {
  // Get current fetch count
  const { data: user, error: fetchErr } = await supabase
    .from('users')
    .select('npci_fetch_count')
    .eq('id', userId)
    .maybeSingle()

  if (fetchErr) {
    console.warn('[Supabase] incrementFetchCount lookup error (non-fatal):', fetchErr.message)
    return
  }

  const currentCount = (user && user.npci_fetch_count) ? user.npci_fetch_count : 0

  const { error } = await supabase
    .from('users')
    .update({
      npci_fetch_count: currentCount + 1,
      mandate_count:    mandateCount,
      last_seen:        new Date().toISOString()
    })
    .eq('id', userId)

  if (error) console.warn('[Supabase] incrementFetchCount update error (non-fatal):', error.message)
  else console.log(`[Supabase] User ${userId} fetch_count=${currentCount + 1} mandate_count=${mandateCount}`)
}

/**
 * Upsert user record. Called on every Google Sign-in from the Android app.
 * Only creates/updates non-deleted fields — is_deleted flag is managed separately.
 */
async function upsertUser(userId, userData) {
  const { name, email } = userData

  // Check if a non-deleted row exists for this userId
  const { data: existing } = await supabase
    .from('users')
    .select('id, is_deleted')
    .eq('id', userId)
    .maybeSingle()

  if (existing && existing.is_deleted) {
    console.warn(`[Supabase] upsertUser: userId ${userId} is marked deleted — skipping`)
    return
  }

  // Try full upsert (with all new columns). Falls back to minimal upsert
  // if the SQL patch hasn't been run yet (email/is_deleted columns missing).
  const { error } = await supabase
    .from('users')
    .upsert({
      id:         userId,
      name:       name  || null,
      email:      email || null,
      last_seen:  new Date().toISOString(),
      is_deleted: false
    }, { onConflict: 'id', ignoreDuplicates: false })

  if (error) {
    console.warn('[Supabase] upsertUser full upsert failed, trying minimal:', error.message)
    // Fallback: minimal upsert without new columns
    const { error: e2 } = await supabase
      .from('users')
      .upsert({
        id:        userId,
        name:      name || null,
        last_seen: new Date().toISOString()
      }, { onConflict: 'id', ignoreDuplicates: false })
    if (e2) {
      console.error('[Supabase] upsertUser minimal upsert also failed:', e2.message)
      throw e2
    }
  }

  console.log(`[Supabase] Upserted user ${userId}`)
}

/**
 * Soft-delete a user account:
 * - Sets is_deleted=true, deleted_at=now() on the user row
 * - Deletes ALL their mandates permanently
 * The user row itself is KEPT for audit trail.
 */
async function deleteAccount(userId) {
  // 1. Soft-delete the user row
  const { error: userErr } = await supabase
    .from('users')
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString()
    })
    .eq('id', userId)

  if (userErr) {
    console.error('[Supabase] deleteAccount user update error:', userErr.message)
    throw userErr
  }

  // 2. Hard-delete all mandates for this user
  const { error: mandateErr } = await supabase
    .from('npci_mandates')
    .delete()
    .eq('user_id', userId)

  if (mandateErr) {
    console.error('[Supabase] deleteAccount mandates delete error:', mandateErr.message)
    throw mandateErr
  }

  // 3. Delete sessions too
  const { error: sessionErr } = await supabase
    .from('npci_sessions')
    .delete()
    .eq('user_id', userId)

  if (sessionErr) {
    console.warn('[Supabase] deleteAccount sessions delete error (non-fatal):', sessionErr.message)
  }

  console.log(`[Supabase] Account deleted for user ${userId}`)
}

/**
 * Enrich mandates with data scraped from the NPCI AI chatbot.
 * parsedTables is [{ merchantName, rows: [{field, value}] }] from Phase 2.
 * parseDate converts DD-MM-YYYY → YYYY-MM-DD (passed in from the route).
 *
 * FIX: Added 'upi app name' / 'psp' / 'app' field handler so upi_app_name
 *      gets populated from the AI chat phase (previously missing).
 */
async function enrichMandates(userId, parsedTables, parseDate) {
  const updated = []

  for (const t of (parsedTables || [])) {
    const rows = t.rows || []
    if (rows.length === 0) continue

    const extra = { updated_at: new Date().toISOString() }
    let merchantFromRows = null

    for (const row of rows) {
      const field = (row.field || '').toLowerCase().trim()
      const raw   = (row.value || '').trim()
      const num   = unescapeUnicode(raw).replace(/[₹,\s]/g, '')

      if (field.includes('remitter') || field.includes('bank'))
        extra.remitter_bank = raw
      if (field.includes('last exec') || field.includes('last debit') || field.includes('last execution'))
        extra.last_exec_date = parseDate ? parseDate(raw) : raw
      if (field.includes('creation') || field.includes('created'))
        extra.creation_date = parseDate ? parseDate(raw) : raw
      if (field.includes('exec count') || field.includes('execution count'))
        extra.total_exec_count = parseInt(num) || 0
      if (field.includes('exec amount') || field.includes('execution amount'))
        extra.total_exec_amount = parseFloat(num) || 0
      if (field.includes('recurrence') || field.includes('frequency') || field.includes('recurrance'))
        extra.frequency = raw.toUpperCase()
      if (field.includes('status'))
        extra.status = raw.toUpperCase()
      if (field.includes('merchant') || field.includes('payee') || field.includes('beneficiary'))
        merchantFromRows = raw
      // ── FIX: capture UPI App Name / PSP / App field ──────────────
      if (field.includes('upi app') || field.includes('app name') || field === 'app' ||
          field.includes('psp') || field === 'upi_app_name')
        extra.upi_app_name = raw
    }

    const meaningful = Object.keys(extra).filter(k => k !== 'updated_at')
    if (meaningful.length === 0) continue

    const merchantName = (t.merchantName || merchantFromRows || '').trim()
    if (!merchantName) continue

    const { data, error: lookupErr } = await supabase
      .from('npci_mandates')
      .select('umn')
      .eq('user_id', userId)
      .ilike('merchant_name', merchantName)
      .limit(1)
      .maybeSingle()

    if (lookupErr) {
      console.warn(`[Supabase] enrichMandates lookup error for "${merchantName}":`, lookupErr.message)
      continue
    }
    if (!data) {
      console.warn(`[Supabase] enrichMandates: no mandate found for merchant "${merchantName}"`)
      continue
    }

    const { error: updateErr } = await supabase
      .from('npci_mandates')
      .update(extra)
      .eq('user_id', userId)
      .eq('umn', data.umn)

    if (updateErr) {
      console.error(`[Supabase] enrichMandates update error for umn ${data.umn}:`, updateErr.message)
      continue
    }

    console.log(`[Supabase] Enriched "${merchantName}" (${data.umn}): ${meaningful.join(', ')}`)
    updated.push({ merchantName, umn: data.umn, fieldsUpdated: meaningful })
  }

  return updated
}

module.exports = {
  saveMandates,
  getMandates,
  updateMandateStatus,
  getMandatesByStatus,
  logSession,
  enrichMandates,
  incrementFetchCount,
  upsertUser,
  deleteAccount
}
