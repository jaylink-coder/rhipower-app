// RhiPower — One-time Opening Balances wizard. The General Ledger (migration
// 021) starts empty, but this bolts onto an already-running business that
// already has real inventory value, unpaid invoices, and bank balances —
// without this, the Trial Balance would never reflect reality. Run once;
// blocked from running twice (postOpeningBalances throws). Corrections
// after the fact go through a manual entry in Accounting → Journal instead.
import { supabase } from './supabase.js'
import { postJournalEntry } from './ledger.js'

export async function hasOpeningBalancesBeenPosted() {
  const { data } = await supabase.from('journal_entries')
    .select('id').eq('source_type', 'opening_balance').limit(1).maybeSingle()
  return Boolean(data)
}

// Same formula as AdminReports.jsx's Stock Valuation tab, so the
// pre-filled number matches what the admin already sees elsewhere.
export async function computeSuggestedInventoryAsset() {
  const { data } = await supabase.from('inventory_prices')
    .select('stock_qty, weighted_avg_cost_kes, buying_price_kes, is_active')
  return (data || [])
    .filter(r => r.is_active !== false && r.stock_qty != null)
    .reduce((s, r) => s + r.stock_qty * (r.weighted_avg_cost_kes ?? r.buying_price_kes), 0)
}

// Same formula as AdminReports.jsx's Customer Balances tab.
export async function computeSuggestedAccountsReceivable() {
  const { data } = await supabase.from('invoices').select('balance_due_kes, status').neq('status', 'void')
  return (data || []).reduce((s, r) => s + Number(r.balance_due_kes || 0), 0)
}

// lines: [{ accountKey, amount, side: 'debit'|'credit' }] — the wizard UI
// computes an Owner's Capital plug live so this always balances by
// construction; postJournalEntry() re-validates it regardless.
export async function postOpeningBalances(cutoverDate, lines, session) {
  if (await hasOpeningBalancesBeenPosted()) {
    throw new Error('Opening balances have already been posted. Use a manual adjusting entry in the Journal tab instead.')
  }
  const nonZero = (lines || []).filter(l => Number(l.amount) > 0)
  if (nonZero.length === 0) throw new Error('Enter at least one opening balance.')

  await postJournalEntry({
    entryDate: cutoverDate,
    memo: `Opening balances as of ${cutoverDate}`,
    sourceType: 'opening_balance',
    lines: nonZero.map(l => ({
      accountKey: l.accountKey,
      debit:  l.side === 'debit'  ? Number(l.amount) : 0,
      credit: l.side === 'credit' ? Number(l.amount) : 0,
    })),
  }, session)
}
