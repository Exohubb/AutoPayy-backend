const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service role key — bypasses RLS
)

/**
 * Upsert mandates. Conflict on (user_id, umn) — UMN is the NPCI canonical identity.
 * Falls back to (user_id, mandate_ref) for non-UMN mandates.
 * Now persists all enriched NPCI fields.
 */
async function saveMandates(userId, mandates) {
  const rows = mandates.map(m => ({
    user_id:              userId,
    mandate_ref:          m.mandateRef || m.id,
    umn:                  m.umn        || null,
    merchant_name:        m.merchantName,
    amount:               m.amount,
    frequency:            m.frequency,
    status:               m.status,
    bank_name:            m.bankName,
    upi_handle:           m.upiHandle,
    next_debit_date:      m.nextDebitDate  || null,
    start_date:           m.startDate      || null,
    end_date:             m.endDate        || null,
    creation_date:        m.creationDate   || null,
    last_exec_date:       m.lastExecDate   || null,
    total_exec_count:     m.totalExecCount  || 0,
    total_exec_amount:    m.totalExecAmount || 0,
    category:             m.category        || 'OTHERS',
    upi_app_name:         m.upiAppName      || null,
    remitter_bank:        m.remitterBank     || m.bankName || null,
    can_pause:            m.canPause  || false,
    can_revoke:           m.canRevoke || false,
    can_unpause:          m.canUnpause || false,
    revocation_deep_link: m.revocationDeepLink || null,
    payment_type:         m.paymentType || 'RECURRING',
    source:               'NPCI',
    raw_data:             m.rawData || null
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
 * Returns full enriched objects matching the app's NpciMandate model.
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
    id:                   row.id,
    merchantName:         row.merchant_name,
    amount:               parseFloat(row.amount) || 0,
    frequency:            row.frequency,
    status:               row.status,
    bankName:             row.bank_name,
    upiHandle:            row.upi_handle,
    nextDebitDate:        row.next_debit_date,
    startDate:            row.start_date,
    endDate:              row.end_date,
    creationDate:         row.creation_date,
    lastExecDate:         row.last_exec_date,
    totalExecCount:       row.total_exec_count  || 0,
    totalExecAmount:      parseFloat(row.total_exec_amount) || 0,
    category:             row.category || 'OTHERS',
    upiAppName:           row.upi_app_name,
    remitterBank:         row.remitter_bank,
    canPause:             row.can_pause  || false,
    canRevoke:            row.can_revoke || false,
    canUnpause:           row.can_unpause || false,
    revocationDeepLink:   row.revocation_deep_link,
    mandateRef:           row.mandate_ref,
    umn:                  row.umn,
    paymentType:          row.payment_type,
    source:               'NPCI'
  }))
}

/** Update status of a single mandate (Active → Paused / Revoked). */
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

/** Get mandates filtered by status (e.g., 'ACTIVE'). */
async function getMandatesByStatus(userId, status) {
  const { data, error } = await supabase
    .from('npci_mandates')
    .select('*')
    .eq('user_id', userId)
    .eq('status', status)
    .order('amount', { ascending: false })

  if (error) throw error
  return (data || [])
}

/** Log a fetch session (no tokens stored — metadata only). */
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

module.exports = { saveMandates, getMandates, updateMandateStatus, getMandatesByStatus, logSession }
