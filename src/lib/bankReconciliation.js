// RhiPower — Bank Reconciliation. Simplified but real: each bank account's
// last COMPLETED reconciliation's statement ending balance becomes the
// starting point for the next one. The admin checks off ledger lines
// against a fresh statement until (prior completed balance + net of newly
// cleared lines) matches the new statement's ending balance — the standard
// "opening balance + cleared transactions = closing balance" reconciliation
// shape, just without a bank-feed import to auto-match against.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'
import { getAccountBalance } from './ledger.js'

export async function fetchBankAccounts() {
  const { data, error } = await supabase.from('bank_accounts').select('*').eq('is_active', true).order('account_name')
  if (error) throw error
  return data || []
}

export async function fetchReconciliations(bankAccountId) {
  const { data, error } = await supabase.from('bank_reconciliations')
    .select('*').eq('bank_account_id', bankAccountId).order('statement_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchUnclearedLines(bankAccount) {
  const { data, error } = await supabase.from('journal_entry_lines')
    .select('id, debit_kes, credit_kes, description, journal_entries!inner(id, entry_number, entry_date, memo, status)')
    .eq('account_id', bankAccount.account_id).eq('cleared', false).eq('journal_entries.status', 'posted')
    .order('entry_date', { foreignTable: 'journal_entries', ascending: true })
  if (error) throw error
  return data || []
}

export async function startReconciliation(bankAccount, { statementDate, statementEndingBalanceKes }, session) {
  const bookBalance = await getAccountBalance(bankAccount.account_id, { asOfDate: statementDate })
  const { data, error } = await supabase.from('bank_reconciliations').insert({
    bank_account_id: bankAccount.id, statement_date: statementDate,
    statement_ending_balance_kes: statementEndingBalanceKes, book_balance_kes: bookBalance,
    admin_id: session?.user?.id || null, admin_email: session?.user?.email || null,
  }).select().single()
  if (error) throw error
  logAdminAction(session, 'bank_reconciliation_started', data.id, { bank_account_id: bankAccount.id })
  return data
}

export async function toggleLineCleared(line, reconciliationId, cleared) {
  const { error } = await supabase.from('journal_entry_lines')
    .update({ cleared, reconciliation_id: cleared ? reconciliationId : null }).eq('id', line.id)
  if (error) throw error
}

async function clearedNetForReconciliation(reconciliationId) {
  const { data, error } = await supabase.from('journal_entry_lines')
    .select('debit_kes, credit_kes').eq('reconciliation_id', reconciliationId)
  if (error) throw error
  return (data || []).reduce((s, l) => s + Number(l.debit_kes) - Number(l.credit_kes), 0)
}

export async function completeReconciliation(reconciliation, session) {
  const { data: prior } = await supabase.from('bank_reconciliations')
    .select('statement_ending_balance_kes').eq('bank_account_id', reconciliation.bank_account_id).eq('status', 'completed')
    .order('statement_date', { ascending: false }).limit(1).maybeSingle()
  const priorBalance = prior ? Number(prior.statement_ending_balance_kes) : 0
  const clearedNet = await clearedNetForReconciliation(reconciliation.id)
  const runningBalance = Math.round((priorBalance + clearedNet) * 100) / 100
  const target = Math.round(Number(reconciliation.statement_ending_balance_kes) * 100) / 100
  if (runningBalance !== target) {
    throw new Error(`Not balanced yet — cleared total is ${runningBalance}, statement says ${target} (difference ${Math.round((target - runningBalance) * 100) / 100}).`)
  }
  const { data, error } = await supabase.from('bank_reconciliations')
    .update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', reconciliation.id).select().single()
  if (error) throw error
  logAdminAction(session, 'bank_reconciliation_completed', reconciliation.id, {})
  return data
}
