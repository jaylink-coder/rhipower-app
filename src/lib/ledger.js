// RhiPower — General Ledger core. The only place in this app that knows how
// to write a balanced double-entry journal entry or compute a
// balance/statement from one. Every domain file (invoices.js, payments.js,
// salesOrders.js, and — from later phases — vendorBills.js,
// supplierPayments.js, fixedAssets.js) imports this and calls
// postJournalEntry() with its own dr/cr recipe at its own existing call
// site. There's no cross-cutting "postings" framework — that matches this
// codebase's habit of domain-specific lib files.
//
// Journal entries are immutable and append-only, same philosophy as
// `payments` — the only correction path is reverseJournalEntry(), which
// posts an equal-and-opposite entry rather than editing lines in place.
// Code refers to accounts by their stable `system_key` (e.g.
// 'accounts_receivable'), never by the mutable code/name, so renaming an
// account in the Chart of Accounts UI never breaks auto-posting.
//
// Balance is enforced here in JS, before anything is ever sent to Supabase
// — see migration 021 for the deferred DB-level backstop trigger, the one
// deliberate exception to this codebase's "no DB triggers" rule.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'

const ROUND = n => Math.round((Number(n) || 0) * 100) / 100

// ── Chart of Accounts cache — one fetch per admin session, invalidated after any COA edit ──
let accountCache = null
let accountCachePromise = null

export function invalidateAccountCache() {
  accountCache = null
  accountCachePromise = null
}

async function loadAccounts() {
  if (accountCache) return accountCache
  if (!accountCachePromise) {
    accountCachePromise = supabase.from('chart_of_accounts').select('*').then(({ data, error }) => {
      accountCachePromise = null
      if (error) throw error
      accountCache = data || []
      return accountCache
    })
  }
  return accountCachePromise
}

export async function fetchChartOfAccounts({ forceRefresh } = {}) {
  if (forceRefresh) invalidateAccountCache()
  return loadAccounts()
}

export async function getAccountBySystemKey(systemKey) {
  const accounts = await loadAccounts()
  const account = accounts.find(a => a.system_key === systemKey)
  if (!account) throw new Error(`Chart of Accounts is missing the required system account "${systemKey}" — check migration 021 ran, or that it wasn't deleted.`)
  return account
}

// ── Chart of Accounts management ─────────────────────────────────────────────
export async function createAccount(payload, session) {
  const { data, error } = await supabase.from('chart_of_accounts').insert(payload).select().single()
  if (error) throw error
  invalidateAccountCache()
  logAdminAction(session, 'account_created', data.id, { code: data.code, name: data.name })
  return data
}

export async function updateAccount(account, patch, session) {
  const { data, error } = await supabase.from('chart_of_accounts')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', account.id).select().single()
  if (error) throw error
  invalidateAccountCache()
  logAdminAction(session, 'account_updated', account.id, patch)
  return data
}

export async function setAccountActive(account, isActive, session) {
  if (account.is_system && !isActive) {
    throw new Error('System accounts required by the posting engine cannot be deactivated.')
  }
  return updateAccount(account, { is_active: isActive }, session)
}

// ── Period locking ───────────────────────────────────────────────────────────
export async function isPeriodLocked(dateStr) {
  const { data } = await supabase.from('accounting_periods')
    .select('period_end').is('reopened_at', null)
    .order('period_end', { ascending: false }).limit(1).maybeSingle()
  if (!data) return false
  return dateStr <= data.period_end
}

export async function fetchAccountingPeriods() {
  const { data, error } = await supabase.from('accounting_periods').select('*').order('period_end', { ascending: false })
  if (error) throw error
  return data || []
}

export async function lockPeriodThrough(periodEndDate, session) {
  const { data, error } = await supabase.from('accounting_periods').insert({
    period_end: periodEndDate,
    locked_by_email: session?.user?.email || null,
  }).select().single()
  if (error) throw error
  logAdminAction(session, 'accounting_period_locked', data.id, { period_end: periodEndDate })
  return data
}

export async function reopenPeriod(periodId, session) {
  const { data, error } = await supabase.from('accounting_periods')
    .update({ reopened_at: new Date().toISOString(), reopened_by_email: session?.user?.email || null })
    .eq('id', periodId).select().single()
  if (error) throw error
  logAdminAction(session, 'accounting_period_reopened', periodId, {})
  return data
}

// ── Core posting ──────────────────────────────────────────────────────────────
// lines: [{ accountKey?, accountId?, debit?, credit?, description? }] — pass
// either accountKey (resolved via the COA cache, used by every auto-posting
// call site) or a raw accountId (used by the manual Journal Entry form,
// where the admin picks an account directly from a dropdown).
export async function postJournalEntry({ entryDate, memo, sourceType, sourceId, lines }, session) {
  if (!memo) throw new Error('Journal entry needs a memo.')
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Journal entry needs at least one line.')

  const date = entryDate || new Date().toISOString().slice(0, 10)
  if (await isPeriodLocked(date)) {
    throw new Error(`Books are locked through a period covering ${date}. Reopen the period in Accounting before posting here.`)
  }

  const resolved = []
  for (const line of lines) {
    const debit  = ROUND(line.debit)
    const credit = ROUND(line.credit)
    if (debit === 0 && credit === 0) continue  // skip zero-amount lines (e.g. a zero logistics bucket)
    if (debit > 0 && credit > 0) throw new Error('A journal line cannot have both a debit and a credit.')
    const accountId = line.accountId || (await getAccountBySystemKey(line.accountKey)).id
    resolved.push({ account_id: accountId, debit_kes: debit, credit_kes: credit, description: line.description || null })
  }
  if (resolved.length === 0) throw new Error('Journal entry has no non-zero lines to post.')

  const totalDebit  = ROUND(resolved.reduce((s, l) => s + l.debit_kes, 0))
  const totalCredit = ROUND(resolved.reduce((s, l) => s + l.credit_kes, 0))
  if (totalDebit !== totalCredit) {
    throw new Error(`Journal entry does not balance: debits ${totalDebit} ≠ credits ${totalCredit}.`)
  }

  const { data: entry, error: headerErr } = await supabase.from('journal_entries').insert({
    entry_date: date, memo, source_type: sourceType || 'manual', source_id: sourceId || null,
    admin_id: session?.user?.id || null, admin_email: session?.user?.email || null,
  }).select().single()
  if (headerErr) throw headerErr

  const { error: linesErr } = await supabase.from('journal_entry_lines')
    .insert(resolved.map(l => ({ ...l, journal_entry_id: entry.id })))
  if (linesErr) {
    // Best-effort compensating cleanup — same non-atomic sequential-insert
    // pattern already used for invoices+invoice_lines elsewhere in this codebase.
    await supabase.from('journal_entries').delete().eq('id', entry.id)
    throw linesErr
  }

  logAdminAction(session, 'journal_entry_posted', entry.id, { sourceType, sourceId, totalDebit })
  return entry
}

export async function reverseJournalEntry(journalEntryId, { memo, entryDate } = {}, session) {
  const { data: original, error: origErr } = await supabase.from('journal_entries')
    .select('*, journal_entry_lines(*)').eq('id', journalEntryId).single()
  if (origErr) throw origErr
  if (original.status === 'void') throw new Error('This entry has already been reversed.')

  const reversal = await postJournalEntry({
    entryDate: entryDate || new Date().toISOString().slice(0, 10),
    memo: memo || `Reversal of JE-${String(original.entry_number).padStart(4, '0')}: ${original.memo}`,
    sourceType: null,
    sourceId: null,
    lines: original.journal_entry_lines.map(l => ({
      accountId: l.account_id,
      debit: l.credit_kes,   // swapped
      credit: l.debit_kes,
      description: l.description,
    })),
  }, session)

  await supabase.from('journal_entries').update({ is_reversal_of: journalEntryId }).eq('id', reversal.id)
  await supabase.from('journal_entries').update({ reversed_by: reversal.id, status: 'void' }).eq('id', journalEntryId)

  logAdminAction(session, 'journal_entry_reversed', journalEntryId, { reversalId: reversal.id })
  return reversal
}

export async function fetchJournalEntries({ limit = 50, sourceType } = {}) {
  let query = supabase.from('journal_entries')
    .select('*, journal_entry_lines(*, chart_of_accounts(code, name))')
    .order('entry_date', { ascending: false }).order('entry_number', { ascending: false }).limit(limit)
  if (sourceType) query = query.eq('source_type', sourceType)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

// ── Reporting ────────────────────────────────────────────────────────────────
async function fetchPostedLines({ from, to } = {}) {
  let query = supabase.from('journal_entry_lines')
    .select('debit_kes, credit_kes, account_id, journal_entries!inner(entry_date, status)')
    .eq('journal_entries.status', 'posted')
  if (from) query = query.gte('journal_entries.entry_date', from)
  if (to)   query = query.lte('journal_entries.entry_date', to)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

function aggregateByAccount(lines) {
  const byAccount = new Map()
  lines.forEach(l => {
    const cur = byAccount.get(l.account_id) || { debit: 0, credit: 0 }
    cur.debit  += Number(l.debit_kes)
    cur.credit += Number(l.credit_kes)
    byAccount.set(l.account_id, cur)
  })
  return byAccount
}

// Signed "as a human reads it" balance: positive for an account in its
// normal-balance direction (an asset with money in it, a liability that's
// owed, revenue that's been earned).
function normalBalanceAmount(byAccount, account) {
  const agg = byAccount.get(account.id) || { debit: 0, credit: 0 }
  return ROUND(account.normal_balance === 'credit' ? agg.credit - agg.debit : agg.debit - agg.credit)
}

// { asOfDate } alone gives the cumulative balance as of a date (the usual
// case — an account's running balance). Passing { from, asOfDate } instead
// gives the NET MOVEMENT within that window (e.g. "VAT collected this
// month") — used by getVatReport below.
export async function getAccountBalance(accountKeyOrId, { asOfDate, from } = {}) {
  const accounts = await loadAccounts()
  const account = accounts.find(a => a.system_key === accountKeyOrId || a.id === accountKeyOrId)
  if (!account) throw new Error(`Account "${accountKeyOrId}" not found.`)
  const byAccount = aggregateByAccount(await fetchPostedLines({ from, to: asOfDate }))
  return normalBalanceAmount(byAccount, account)
}

export async function getAccountLedger(accountId, { from, to } = {}) {
  let query = supabase.from('journal_entry_lines')
    .select('id, debit_kes, credit_kes, description, journal_entries!inner(id, entry_number, entry_date, memo, source_type, status)')
    .eq('account_id', accountId).eq('journal_entries.status', 'posted')
    .order('entry_date', { foreignTable: 'journal_entries', ascending: true })
  if (from) query = query.gte('journal_entries.entry_date', from)
  if (to)   query = query.lte('journal_entries.entry_date', to)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

// Standard trial balance: raw net (debit − credit) per account, bucketed
// into Dr/Cr columns by sign — deliberately ignores normal_balance, since a
// trial balance is a mechanical check that the ledger nets to zero, not a
// human-readable statement (that's what P&L/Balance Sheet are for).
export async function getTrialBalance({ asOfDate } = {}) {
  const accounts = await loadAccounts()
  const byAccount = aggregateByAccount(await fetchPostedLines({ to: asOfDate }))
  const rows = accounts.map(account => {
    const agg = byAccount.get(account.id) || { debit: 0, credit: 0 }
    const net = ROUND(agg.debit - agg.credit)
    return { account, debitSide: net > 0 ? net : 0, creditSide: net < 0 ? -net : 0 }
  }).filter(r => r.debitSide !== 0 || r.creditSide !== 0)
  const totalDebit  = ROUND(rows.reduce((s, r) => s + r.debitSide, 0))
  const totalCredit = ROUND(rows.reduce((s, r) => s + r.creditSide, 0))
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit }
}

export async function getProfitAndLoss({ from, to } = {}) {
  const accounts = await loadAccounts()
  const byAccount = aggregateByAccount(await fetchPostedLines({ from, to }))
  const rowsFor = predicate => accounts.filter(predicate)
    .map(a => ({ account: a, amount: normalBalanceAmount(byAccount, a) }))
    .filter(r => r.amount !== 0)

  const income = rowsFor(a => a.account_type === 'income')
  const cogs   = rowsFor(a => a.account_subtype === 'cogs')
  const opex   = rowsFor(a => a.account_type === 'expense' && a.account_subtype !== 'cogs')

  const totalIncome = ROUND(income.reduce((s, r) => s + r.amount, 0))
  const totalCogs   = ROUND(cogs.reduce((s, r) => s + r.amount, 0))
  const grossProfit = ROUND(totalIncome - totalCogs)
  const totalOpex   = ROUND(opex.reduce((s, r) => s + r.amount, 0))
  const netProfit   = ROUND(grossProfit - totalOpex)

  return { income, cogs, opex, totalIncome, totalCogs, grossProfit, totalOpex, netProfit }
}

// Includes a live "Current Earnings" equity line — P&L net profit from
// inception through asOfDate — so the sheet always balances without ever
// needing a formal year-end closing entry. Appropriate for a single
// non-accountant admin; a multi-year business would want real closing entries.
export async function getBalanceSheet({ asOfDate } = {}) {
  const accounts = await loadAccounts()
  const byAccount = aggregateByAccount(await fetchPostedLines({ to: asOfDate }))
  const rowsFor = predicate => accounts.filter(predicate)
    .map(a => ({ account: a, amount: normalBalanceAmount(byAccount, a) }))
    .filter(r => r.amount !== 0)

  const assets      = rowsFor(a => a.account_type === 'asset')
  const liabilities = rowsFor(a => a.account_type === 'liability')
  const equity       = rowsFor(a => a.account_type === 'equity')

  const { netProfit: currentEarnings } = await getProfitAndLoss({ to: asOfDate })

  const totalAssets      = ROUND(assets.reduce((s, r) => s + r.amount, 0))
  const totalLiabilities = ROUND(liabilities.reduce((s, r) => s + r.amount, 0))
  const totalEquity      = ROUND(equity.reduce((s, r) => s + r.amount, 0) + currentEarnings)

  return {
    assets, liabilities, equity, currentEarnings,
    totalAssets, totalLiabilities, totalEquity,
    balanced: ROUND(totalAssets) === ROUND(totalLiabilities + totalEquity),
  }
}

// Output VAT collected on sales minus Input VAT paid on purchases, for the
// period — a positive netPayable is owed to KRA; negative means a
// receivable (unusual, but not impossible if inputs outpace outputs).
export async function getVatReport({ from, to } = {}) {
  const outputVat = await getAccountBalance('output_vat', { from, asOfDate: to })
  const inputVat  = await getAccountBalance('input_vat',  { from, asOfDate: to })
  return { outputVat, inputVat, netPayable: ROUND(outputVat - inputVat) }
}

// Revenue/profit bucketed by calendar month, for the Reports dashboard's
// trend charts. One fetch across the whole window rather than calling
// getProfitAndLoss() once per month, since that would re-query the same
// journal_entry_lines range N times.
export async function getMonthlyTrend({ months = 12 } = {}) {
  const now = new Date()
  const startMonth = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const accounts = await loadAccounts()
  const accountById = new Map(accounts.map(a => [a.id, a]))
  const lines = await fetchPostedLines({ from: startMonth.toISOString().slice(0, 10) })

  const buckets = new Map()
  for (let i = 0; i < months; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1)
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, { income: 0, cogs: 0, opex: 0 })
  }

  lines.forEach(l => {
    const account = accountById.get(l.account_id)
    if (!account) return
    const bucket = buckets.get(l.journal_entries.entry_date.slice(0, 7))
    if (!bucket) return
    const amt = account.normal_balance === 'credit'
      ? Number(l.credit_kes) - Number(l.debit_kes)
      : Number(l.debit_kes) - Number(l.credit_kes)
    if (account.account_type === 'income') bucket.income += amt
    else if (account.account_subtype === 'cogs') bucket.cogs += amt
    else if (account.account_type === 'expense') bucket.opex += amt
  })

  return Array.from(buckets.entries()).map(([month, b]) => {
    const revenue = ROUND(b.income), cogs = ROUND(b.cogs), opex = ROUND(b.opex)
    const grossProfit = ROUND(revenue - cogs)
    return { month, revenue, cogs, grossProfit, opex, netProfit: ROUND(grossProfit - opex) }
  })
}
