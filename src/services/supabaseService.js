const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role key (bypasses RLS)
)

/**
 * Upsert mandates for a user.  Conflict resolution on (user_id, mandate_ref).
 * Never stores raw cookie data — only parsed mandate fields.
 */
async function saveMandates(userId, mandates) {
  const rows = mandates.map(m => ({
    user_id:         userId,
    mandate_ref:     m.mandateRef || m.id,
    umn:             m.umn || null,
    merchant_name:   m.merchantName,
    amount:          m.amount,
    frequency:       m.frequency,
    status:          m.status,
    bank_name:       m.bankName,
    upi_handle:      m.upiHandle,
    next_debit_date: m.nextDebitDate,
    start_date:      m.startDate,
    end_date:        m.endDate,
    payment_type:    m.paymentType,
    source:          'NPCI',
    raw_data:        m.rawData || null
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
 * Retrieve all mandates for a user, ordered by most recent first.
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
    id:            row.id,
    merchantName:  row.merchant_name,
    amount:        parseFloat(row.amount) || 0,
    frequency:     row.frequency,
    status:        row.status,
    bankName:      row.bank_name,
    upiHandle:     row.upi_handle,
    nextDebitDate: row.next_debit_date,
    startDate:     row.start_date,
    endDate:       row.end_date,
    mandateRef:    row.mandate_ref,
    umn:           row.umn,
    paymentType:   row.payment_type,
    source:        'NPCI'
  }))
}

/**
 * Update the status of a specific mandate.
 */
async function updateMandateStatus(userId, mandateRef, status) {
  const { error } = await supabase
    .from('npci_mandates')
    .update({ status })
    .eq('user_id', userId)
    .eq('mandate_ref', mandateRef)

  if (error) {
    console.error('[Supabase] updateMandateStatus error:', error.message)
    throw error
  }
}

/**
 * Log a fetch session (metadata only — no tokens).
 */
async function logSession(userId, totalFound) {
  const { error } = await supabase
    .from('npci_sessions')
    .insert({
      user_id:     userId,
      total_found: totalFound,
      status:      totalFound > 0 ? 'SUCCESS' : 'EMPTY'
    })

  if (error) {
    console.error('[Supabase] logSession error:', error.message)
    // Non-fatal — don't throw
  }
}

module.exports = {
  saveMandates,
  getMandates,
  updateMandateStatus,
  logSession
}
