// RhiPower — Accounting (the full double-entry module: Chart of Accounts,
// General Ledger, Opening Balances, Bank Reconciliation, and Financial
// Statements). Every existing invoice/payment/sales-order-confirm/PO-
// receipt/vendor-bill/depreciation flow auto-posts into this ledger from
// its own file (see lib/invoices.js, payments.js, salesOrders.js,
// vendorBills.js, supplierPayments.js, fixedAssets.js) — this file is UI
// only, all financial logic lives in src/lib/ledger.js and its siblings.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import {
  fetchChartOfAccounts, createAccount, updateAccount, setAccountActive,
  fetchJournalEntries, postJournalEntry, reverseJournalEntry,
  getTrialBalance, getProfitAndLoss, getBalanceSheet, getVatReport,
} from '../lib/ledger.js'
import {
  hasOpeningBalancesBeenPosted, computeSuggestedInventoryAsset,
  computeSuggestedAccountsReceivable, postOpeningBalances,
} from '../lib/openingBalances.js'
import {
  fetchBankAccounts, fetchReconciliations, fetchUnclearedLines,
  startReconciliation, toggleLineCleared, completeReconciliation,
} from '../lib/bankReconciliation.js'
import { downloadCSV } from '../lib/csvExport.js'
import { fetchBudgets, setBudget } from '../lib/budgets.js'

const SECTIONS = [
  { id: 'coa',     label: '📖 Chart of Accounts' },
  { id: 'opening', label: '🚀 Opening Balances' },
  { id: 'journal', label: '📝 Journal' },
  { id: 'bank',    label: '🏦 Bank & Reconciliation' },
  { id: 'trial',   label: '⚖️ Trial Balance' },
  { id: 'pl',      label: '📈 Profit & Loss' },
  { id: 'bs',      label: '🧮 Balance Sheet' },
  { id: 'vat',     label: '🧾 VAT Report' },
  { id: 'budget',  label: '🎯 Budget vs Actual' },
]

// Shared date-range chip set for P&L and VAT Report — both need the same
// "this month / quarter / year / all-time / custom" shape.
const RANGE_OPTIONS = [
  { id: 'month',   label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'year',    label: 'This Year' },
  { id: 'all',     label: 'All Time' },
  { id: 'custom',  label: 'Custom' },
]
function rangeBounds(id, customFrom, customTo) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const iso = d => d.toISOString().slice(0, 10)
  if (id === 'month')   return { from: iso(new Date(y, m, 1)),           to: iso(new Date(y, m + 1, 0)) }
  if (id === 'quarter') { const q = Math.floor(m / 3); return { from: iso(new Date(y, q * 3, 1)), to: iso(new Date(y, q * 3 + 3, 0)) } }
  if (id === 'year')    return { from: iso(new Date(y, 0, 1)),           to: iso(new Date(y, 11, 31)) }
  if (id === 'all')     return { from: null, to: iso(now) }
  return { from: customFrom, to: customTo }
}

function RangePicker({ rangeId, setRangeId, customFrom, setCustomFrom, customTo, setCustomTo }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {RANGE_OPTIONS.map(r => (
        <button key={r.id} onClick={() => setRangeId(r.id)}
          className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${rangeId === r.id ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          {r.label}
        </button>
      ))}
      {rangeId === 'custom' && (
        <>
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
        </>
      )}
    </div>
  )
}

const ACCOUNT_TYPES = [
  { value: 'asset',     label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity',    label: 'Equity' },
  { value: 'income',    label: 'Income' },
  { value: 'expense',   label: 'Expense' },
]
const ACCOUNT_SUBTYPES = {
  asset:     [['current_asset', 'Current Asset'], ['fixed_asset', 'Fixed Asset'], ['contra_asset', 'Contra Asset']],
  liability: [['current_liability', 'Current Liability']],
  equity:    [['equity', 'Equity'], ['contra_equity', 'Contra Equity']],
  income:    [['income', 'Income']],
  expense:   [['cogs', 'Cost of Goods Sold'], ['operating_expense', 'Operating Expense'], ['other_expense', 'Other Expense']],
}
const NORMAL_BALANCE_FOR_TYPE = { asset: 'debit', liability: 'credit', equity: 'credit', income: 'credit', expense: 'debit' }
const TYPE_LABEL = { asset: '🏦 Assets', liability: '💳 Liabilities', equity: '👤 Equity', income: '📈 Income', expense: '📉 Expenses' }

// ── Chart of Accounts ─────────────────────────────────────────────────────────
function AccountRow({ account, session, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ code: account.code, name: account.name, description: account.description || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setBusy(true); setError('')
    try {
      const updated = await updateAccount(account, form, session)
      onChanged(updated)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  async function toggleActive() {
    setBusy(true); setError('')
    try {
      const updated = await setAccountActive(account, account.is_active === false, session)
      onChanged(updated)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  if (editing) {
    return (
      <tr className="bg-blue-50">
        <td className="px-4 py-2"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="w-20 border-2 border-blue-400 rounded px-1.5 py-1 text-xs font-mono" /></td>
        <td className="px-4 py-2" colSpan={2}>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border-2 border-blue-400 rounded px-1.5 py-1 text-xs mb-1" />
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs" />
        </td>
        <td className="px-4 py-2 text-right">
          <button onClick={save} disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-2 py-1 rounded disabled:opacity-50">{busy ? '…' : 'Save'}</button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-400 px-1.5">✕</button>
          {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
        </td>
      </tr>
    )
  }
  return (
    <tr className="hover:bg-gray-50 transition">
      <td className="px-4 py-2 font-mono text-xs text-gray-500">{account.code}</td>
      <td className="px-4 py-2">
        <div className="font-semibold text-gray-800 text-sm">
          {account.name}
          {account.is_system && <span className="ml-1.5 text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full align-middle">System</span>}
          {account.is_active === false && <span className="ml-1.5 text-[10px] font-bold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full align-middle">Inactive</span>}
        </div>
        {account.description && <div className="text-xs text-gray-400">{account.description}</div>}
      </td>
      <td className="px-4 py-2 text-xs text-gray-500">{ACCOUNT_SUBTYPES[account.account_type]?.find(([v]) => v === account.account_subtype)?.[1] || account.account_subtype}</td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold mr-3">Edit</button>
        <button onClick={toggleActive} disabled={busy || (account.is_system && account.is_active !== false)}
          title={account.is_system && account.is_active !== false ? 'System accounts required by the posting engine cannot be deactivated' : ''}
          className="text-xs font-bold text-amber-700 hover:text-amber-900 disabled:opacity-30 disabled:cursor-not-allowed">
          {account.is_active === false ? 'Activate' : 'Deactivate'}
        </button>
        {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
      </td>
    </tr>
  )
}

function AddAccountForm({ session, onAdded, onCancel }) {
  const [form, setForm] = useState({ account_type: 'expense', account_subtype: 'operating_expense', code: '', name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function setType(type) {
    setForm(f => ({ ...f, account_type: type, account_subtype: ACCOUNT_SUBTYPES[type][0][0] }))
  }

  async function save() {
    if (!form.code.trim() || !form.name.trim()) { setError('Code and name are required.'); return }
    setSaving(true); setError('')
    try {
      const account = await createAccount({
        code: form.code.trim(), name: form.name.trim(), description: form.description.trim() || null,
        account_type: form.account_type, account_subtype: form.account_subtype,
        normal_balance: NORMAL_BALANCE_FOR_TYPE[form.account_type],
      }, session)
      onAdded(account)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  return (
    <div className="p-4 bg-blue-50 border-b border-blue-100 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <select value={form.account_type} onChange={e => setType(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={form.account_subtype} onChange={e => setForm(f => ({ ...f, account_subtype: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          {ACCOUNT_SUBTYPES[form.account_type].map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <input placeholder="Code (e.g. 6910)" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono" />
      </div>
      <input placeholder="Account name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      <input placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      {error && <div className="text-xs text-red-600 font-semibold bg-red-50 p-2 rounded-lg">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">{saving ? 'Adding…' : 'Add Account'}</button>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
      </div>
    </div>
  )
}

function ChartOfAccountsTab({ accounts, session, onChanged, onAdded }) {
  const [adding, setAdding] = useState(false)
  const byType = ACCOUNT_TYPES.map(t => ({ ...t, accounts: accounts.filter(a => a.account_type === t.value).sort((a, b) => a.code.localeCompare(b.code)) }))

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-400 max-w-lg">
          System accounts (blue badge) are read by the posting engine and can be renamed but not deleted or deactivated.
          Add your own sub-accounts for anything not already listed — extra expense categories, for example.
        </p>
        <button onClick={() => setAdding(a => !a)} className="text-xs font-bold text-blue-600 hover:text-blue-800 shrink-0 ml-3">
          {adding ? '✕ Cancel' : '+ Add Account'}
        </button>
      </div>
      {adding && <AddAccountForm session={session} onCancel={() => setAdding(false)} onAdded={a => { onAdded(a); setAdding(false) }} />}
      {byType.map(t => t.accounts.length > 0 && (
        <div key={t.value} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-100 px-5 py-3">
            <h3 className="font-black text-gray-700 text-sm">{TYPE_LABEL[t.value]}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                <th className="px-4 py-2 text-left font-bold w-20">Code</th>
                <th className="px-4 py-2 text-left font-bold">Account</th>
                <th className="px-4 py-2 text-left font-bold">Subtype</th>
                <th className="px-4 py-2 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {t.accounts.map(a => <AccountRow key={a.id} account={a} session={session} onChanged={onChanged} />)}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// ── Opening Balances ─────────────────────────────────────────────────────────
const OPENING_DEBIT_FIELDS = [
  { key: 'bank_operating',        label: 'Bank Account balance' },
  { key: 'mpesa_till',            label: 'M-Pesa Till balance' },
  { key: 'petty_cash',            label: 'Petty Cash balance' },
  { key: 'fixed_assets_vehicles', label: 'Fixed Assets — Vehicles (book value)' },
  { key: 'fixed_assets_tools',    label: 'Fixed Assets — Tools & Equipment (book value)' },
]
const OPENING_CREDIT_FIELDS = [
  { key: 'accounts_payable', label: 'Accounts Payable owed to suppliers' },
]

function OpeningBalancesTab({ session }) {
  const [status, setStatus] = useState(null)
  const [suggestedInventory, setSuggestedInventory] = useState(0)
  const [suggestedAR, setSuggestedAR] = useState(0)
  const [form, setForm] = useState({})
  const [cutoverDate, setCutoverDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    Promise.all([hasOpeningBalancesBeenPosted(), computeSuggestedInventoryAsset(), computeSuggestedAccountsReceivable()])
      .then(([posted, inv, ar]) => { setStatus({ posted }); setSuggestedInventory(inv); setSuggestedAR(ar) })
  }, [])

  const debitTotal  = suggestedInventory + suggestedAR + OPENING_DEBIT_FIELDS.reduce((s, f) => s + (parseFloat(form[f.key]) || 0), 0)
  const creditTotal = OPENING_CREDIT_FIELDS.reduce((s, f) => s + (parseFloat(form[f.key]) || 0), 0)
  const plug = debitTotal - creditTotal

  async function submit() {
    if (plug < 0) { setError("These entries don't leave a positive Owner's Capital — double-check the amounts above."); return }
    setSaving(true); setError('')
    try {
      const lines = [
        { accountKey: 'inventory_asset',     amount: suggestedInventory, side: 'debit' },
        { accountKey: 'accounts_receivable', amount: suggestedAR,        side: 'debit' },
        ...OPENING_DEBIT_FIELDS.map(f => ({ accountKey: f.key, amount: parseFloat(form[f.key]) || 0, side: 'debit' })),
        ...OPENING_CREDIT_FIELDS.map(f => ({ accountKey: f.key, amount: parseFloat(form[f.key]) || 0, side: 'credit' })),
        { accountKey: 'owners_capital', amount: plug, side: 'credit' },
      ]
      await postOpeningBalances(cutoverDate, lines, session)
      setDone(true)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  if (status === null) return <div className="text-gray-400 text-sm py-10 text-center">Loading…</div>

  if (status.posted || done) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-sm text-green-800">
        ✓ Opening balances have already been posted. To correct them, use a manual adjusting entry in the Journal tab instead.
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-xs text-gray-400">
        One-time wizard — run this once to seed the ledger with real-world balances as of a cutover date, since the
        General Ledger starts empty while the business already has inventory value, unpaid invoices, and bank balances.
        Inventory Asset and Accounts Receivable below are pre-filled using the same numbers already shown in Reports.
      </p>
      <div>
        <label className="block text-xs font-bold text-gray-500 mb-1">Cutover Date</label>
        <input type="date" value={cutoverDate} onChange={e => setCutoverDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
        <div className="flex justify-between text-sm"><span className="text-gray-500">Inventory Asset (from Stock Valuation)</span><span className="font-mono font-bold">{formatKsh(suggestedInventory)}</span></div>
        <div className="flex justify-between text-sm"><span className="text-gray-500">Accounts Receivable (from Customer Balances)</span><span className="font-mono font-bold">{formatKsh(suggestedAR)}</span></div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="text-xs font-bold text-gray-500 uppercase">Enter real balances as of the cutover date</div>
        {OPENING_DEBIT_FIELDS.map(f => (
          <div key={f.key} className="flex items-center justify-between gap-3">
            <label className="text-sm text-gray-700">{f.label}</label>
            <input type="number" value={form[f.key] || ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className="w-32 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono text-right" />
          </div>
        ))}
        {OPENING_CREDIT_FIELDS.map(f => (
          <div key={f.key} className="flex items-center justify-between gap-3">
            <label className="text-sm text-gray-700">{f.label}</label>
            <input type="number" value={form[f.key] || ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className="w-32 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono text-right" />
          </div>
        ))}
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex justify-between items-center">
        <span className="text-sm font-bold text-blue-800">Owner's Capital (computed)</span>
        <span className="font-mono font-black text-blue-800">{formatKsh(plug)}</span>
      </div>
      {error && <div className="text-xs text-red-600 font-semibold bg-red-50 p-2 rounded-lg">{error}</div>}
      <button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
        {saving ? 'Posting…' : 'Post Opening Balances'}
      </button>
    </div>
  )
}

// ── Journal ────────────────────────────────────────────────────────────────────
function blankLine() { return { accountId: '', debit: '', credit: '' } }

function NewEntryForm({ accounts, session, onPosted, onCancel }) {
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState([blankLine(), blankLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateLine(i, patch) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function addLine() { setLines(ls => [...ls, blankLine()]) }
  function removeLine(i) { setLines(ls => ls.filter((_, idx) => idx !== i)) }

  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0)
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01

  async function save() {
    if (!memo.trim()) { setError('Enter a memo describing this entry.'); return }
    if (!balanced) { setError('Debits must equal credits before this can be posted.'); return }
    setSaving(true); setError('')
    try {
      await postJournalEntry({
        entryDate, memo: memo.trim(), sourceType: 'manual',
        lines: lines.filter(l => l.accountId).map(l => ({
          accountId: l.accountId, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0,
        })),
      }, session)
      onPosted()
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  return (
    <div className="p-4 bg-blue-50 border-b border-blue-100 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input placeholder="Memo — what is this entry for?" value={memo} onChange={e => setMemo(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <div className="space-y-1.5">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <select value={line.accountId} onChange={e => updateLine(i, { accountId: e.target.value })} className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="">Select account…</option>
              {accounts.filter(a => a.is_active !== false).sort((a, b) => a.code.localeCompare(b.code)).map(a => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
            <input type="number" placeholder="Debit" value={line.debit} onChange={e => updateLine(i, { debit: e.target.value, credit: '' })} className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono text-right" />
            <input type="number" placeholder="Credit" value={line.credit} onChange={e => updateLine(i, { credit: e.target.value, debit: '' })} className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono text-right" />
            <button onClick={() => removeLine(i)} disabled={lines.length <= 2} className="text-gray-400 hover:text-red-600 disabled:opacity-20 text-sm px-1">✕</button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button onClick={addLine} className="text-xs font-bold text-blue-600 hover:text-blue-800">+ Add Line</button>
        <div className={`text-xs font-mono font-bold ${balanced ? 'text-green-700' : 'text-gray-500'}`}>
          Dr {formatKsh(totalDebit)} · Cr {formatKsh(totalCredit)} {balanced && '✓ Balanced'}
        </div>
      </div>
      {error && <div className="text-xs text-red-600 font-semibold bg-red-50 p-2 rounded-lg">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving || !balanced} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">{saving ? 'Posting…' : 'Post Entry'}</button>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
      </div>
    </div>
  )
}

function JournalEntryRow({ entry, session, onReversed }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lines = entry.journal_entry_lines || []
  const total = lines.reduce((s, l) => s + Number(l.debit_kes), 0)

  async function reverse() {
    if (!confirm(`Reverse JE-${String(entry.entry_number).padStart(4, '0')}? This posts an equal-and-opposite entry — the original stays on record, marked void.`)) return
    setBusy(true); setError('')
    try {
      await reverseJournalEntry(entry.id, {}, session)
      onReversed()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  return (
    <div className="border-b border-gray-50 last:border-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition text-left">
        <div className="min-w-0">
          <div className="font-semibold text-gray-800 text-sm truncate">
            <span className="font-mono text-gray-400 mr-2">JE-{String(entry.entry_number).padStart(4, '0')}</span>
            {entry.memo}
            {entry.status === 'void' && <span className="ml-1.5 text-[10px] font-bold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full align-middle">Void — reversed</span>}
            {entry.is_reversal_of && <span className="ml-1.5 text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full align-middle">Reversal</span>}
          </div>
          <div className="text-xs text-gray-400">{new Date(entry.entry_date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })} · {entry.source_type || 'manual'}</div>
        </div>
        <div className="font-mono font-bold text-gray-700 shrink-0 ml-3">{formatKsh(total)}</div>
      </button>
      {open && (
        <div className="px-5 pb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 uppercase">
                <th className="text-left py-1 font-bold">Account</th>
                <th className="text-right py-1 font-bold">Debit</th>
                <th className="text-right py-1 font-bold">Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id}>
                  <td className="py-1 text-gray-700">{l.chart_of_accounts?.code} — {l.chart_of_accounts?.name}{l.description && <span className="text-gray-400"> · {l.description}</span>}</td>
                  <td className="py-1 text-right font-mono">{Number(l.debit_kes) > 0 ? formatKsh(l.debit_kes) : ''}</td>
                  <td className="py-1 text-right font-mono">{Number(l.credit_kes) > 0 ? formatKsh(l.credit_kes) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
          {entry.status === 'posted' && !entry.reversed_by && (
            <button onClick={reverse} disabled={busy} className="mt-2 text-xs font-bold text-red-600 hover:text-red-800 disabled:opacity-50">
              {busy ? 'Reversing…' : 'Reverse Entry'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function JournalTab({ accounts, session }) {
  const [entries, setEntries] = useState(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    const rows = await fetchJournalEntries({ limit: 100 })
    setEntries(rows)
  }
  useEffect(() => { load() }, [])

  if (entries === null) return <div className="text-gray-400 text-sm py-10 text-center">Loading journal…</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-400">Every posted entry, newest first. Nothing auto-posts yet — this is where you record anything not already tracked elsewhere in the app: owner capital, loan proceeds, ad-hoc adjustments.</p>
        <button onClick={() => setAdding(a => !a)} className="text-xs font-bold text-blue-600 hover:text-blue-800 shrink-0 ml-3">
          {adding ? '✕ Cancel' : '+ New Manual Entry'}
        </button>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {adding && <NewEntryForm accounts={accounts} session={session} onCancel={() => setAdding(false)} onPosted={() => { setAdding(false); load() }} />}
        {entries.length === 0 ? (
          <div className="text-gray-400 text-sm py-10 text-center">No journal entries yet.</div>
        ) : (
          entries.map(e => <JournalEntryRow key={e.id} entry={e} session={session} onReversed={load} />)
        )}
      </div>
    </div>
  )
}

// ── Bank & Reconciliation ────────────────────────────────────────────────────
function BankReconciliationTab({ session }) {
  const [accounts, setAccounts] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [reconciliations, setReconciliations] = useState([])
  const [lines, setLines] = useState([])
  const [clearedIds, setClearedIds] = useState(new Set())
  const [starting, setStarting] = useState(false)
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10))
  const [statementBalance, setStatementBalance] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchBankAccounts().then(rows => { setAccounts(rows); if (rows[0]) setSelectedId(rows[0].id) })
  }, [])

  const account = accounts?.find(a => a.id === selectedId)
  const activeRecon = reconciliations.find(r => r.status === 'in_progress')
  const priorCompleted = reconciliations.filter(r => r.status === 'completed')

  const loadForAccount = useCallback(async (id) => {
    const acc = (accounts || []).find(a => a.id === id)
    if (!acc) return
    const [recons, unclearedLines] = await Promise.all([fetchReconciliations(id), fetchUnclearedLines(acc)])
    setReconciliations(recons)
    setLines(unclearedLines)
    setClearedIds(new Set())
  }, [accounts])
  useEffect(() => { if (accounts && selectedId) loadForAccount(selectedId) }, [accounts, selectedId, loadForAccount])

  async function handleStart() {
    setError('')
    const n = parseFloat(statementBalance)
    if (isNaN(n)) { setError('Enter the statement ending balance.'); return }
    setBusy(true)
    try {
      await startReconciliation(account, { statementDate, statementEndingBalanceKes: n }, session)
      setStarting(false)
      await loadForAccount(selectedId)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  async function handleToggle(line) {
    const willClear = !clearedIds.has(line.id)
    try {
      await toggleLineCleared(line, activeRecon.id, willClear)
      setClearedIds(prev => {
        const n = new Set(prev)
        if (willClear) n.add(line.id)
        else n.delete(line.id)
        return n
      })
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleComplete() {
    setError(''); setBusy(true)
    try {
      await completeReconciliation(activeRecon, session)
      await loadForAccount(selectedId)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  if (accounts === null) return <div className="text-gray-400 text-sm py-10 text-center">Loading…</div>

  const relevantLines = lines.filter(l => !activeRecon || l.journal_entries.entry_date <= activeRecon.statement_date)
  const clearedNet = relevantLines.filter(l => clearedIds.has(l.id)).reduce((s, l) => s + Number(l.debit_kes) - Number(l.credit_kes), 0)
  const priorBalance = priorCompleted[0] ? Number(priorCompleted[0].statement_ending_balance_kes) : 0
  const runningBalance = priorBalance + clearedNet
  const target = activeRecon ? Number(activeRecon.statement_ending_balance_kes) : null
  const balanced = target != null && Math.abs(runningBalance - target) < 0.01

  return (
    <div className="space-y-4">
      <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
        {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
      </select>

      {!activeRecon && !starting && (
        <button onClick={() => setStarting(true)} className="text-xs font-bold text-blue-600 hover:text-blue-800">+ Start Reconciliation</button>
      )}

      {!activeRecon && starting && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={statementDate} onChange={e => setStatementDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            <input type="number" placeholder="Statement ending balance" value={statementBalance} onChange={e => setStatementBalance(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          {error && <div className="text-xs text-red-600 font-semibold">{error}</div>}
          <div className="flex gap-2">
            <button onClick={handleStart} disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">{busy ? 'Starting…' : 'Start'}</button>
            <button onClick={() => setStarting(false)} className="text-xs text-gray-400 px-2">Cancel</button>
          </div>
        </div>
      )}

      {activeRecon && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-gray-100 p-4 flex justify-between items-center">
            <div className="text-sm">
              <div className="text-gray-500">Statement {new Date(activeRecon.statement_date).toLocaleDateString('en-KE')}</div>
              <div className="font-mono font-black text-gray-800">Target: {formatKsh(target)}</div>
            </div>
            <div className={`text-sm font-mono font-black ${balanced ? 'text-green-700' : 'text-amber-700'}`}>
              Cleared: {formatKsh(runningBalance)} {balanced && '✓'}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {relevantLines.length === 0 ? (
              <div className="text-gray-400 text-sm py-6 text-center">No uncleared transactions up to this date.</div>
            ) : relevantLines.map(l => (
              <label key={l.id} className="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={clearedIds.has(l.id)} onChange={() => handleToggle(l)} className="w-4 h-4" />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-700 truncate">{l.journal_entries.memo}</div>
                  <div className="text-xs text-gray-400">{new Date(l.journal_entries.entry_date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}</div>
                </div>
                <div className="font-mono font-semibold">{Number(l.debit_kes) > 0 ? '+' : '-'}{formatKsh(Number(l.debit_kes) || Number(l.credit_kes))}</div>
              </label>
            ))}
          </div>

          {error && <div className="text-xs text-red-600 font-semibold bg-red-50 p-2 rounded-lg">{error}</div>}
          <button onClick={handleComplete} disabled={busy || !balanced} className="bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
            {busy ? 'Completing…' : 'Complete Reconciliation'}
          </button>
        </div>
      )}

      {priorCompleted.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="text-xs font-bold text-gray-500 uppercase mb-2">History</div>
          {priorCompleted.map(r => (
            <div key={r.id} className="flex justify-between text-sm py-1">
              <span className="text-gray-500">{new Date(r.statement_date).toLocaleDateString('en-KE')}</span>
              <span className="font-mono font-semibold">{formatKsh(r.statement_ending_balance_kes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Trial Balance ────────────────────────────────────────────────────────────
function TrialBalanceTab() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState(null)

  useEffect(() => { getTrialBalance({ asOfDate }).then(setReport) }, [asOfDate])

  if (!report) return <div className="text-gray-400 text-sm py-10 text-center">Loading…</div>

  function exportCsv() {
    downloadCSV(report.rows.map(r => ({ Code: r.account.code, Account: r.account.name, Debit: r.debitSide, Credit: r.creditSide })), `rhipower-trial-balance-${asOfDate}.csv`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-bold text-gray-500">As of</label>
        <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={exportCsv} className="ml-auto text-xs font-bold text-blue-600 hover:text-blue-800">⬇ Export CSV</button>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="px-4 py-2 text-left font-bold">Account</th>
              <th className="px-4 py-2 text-right font-bold">Debit</th>
              <th className="px-4 py-2 text-right font-bold">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {report.rows.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-10 text-gray-400">No activity posted yet.</td></tr>
            ) : report.rows.map(r => (
              <tr key={r.account.id} className="hover:bg-gray-50 transition">
                <td className="px-4 py-2">{r.account.code} — {r.account.name}</td>
                <td className="px-4 py-2 text-right font-mono">{r.debitSide > 0 ? formatKsh(r.debitSide) : ''}</td>
                <td className="px-4 py-2 text-right font-mono">{r.creditSide > 0 ? formatKsh(r.creditSide) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-black">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right font-mono">{formatKsh(report.totalDebit)}</td>
              <td className="px-4 py-2 text-right font-mono">{formatKsh(report.totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!report.balanced && (
        <div className="text-xs text-red-600 font-bold bg-red-50 border border-red-200 rounded-xl p-3">
          ⚠️ Not balanced — this should never happen given the balance check in postJournalEntry() and the DB-level safety trigger; if you see this, look for a direct database edit outside the app.
        </div>
      )}
    </div>
  )
}

// ── Profit & Loss ─────────────────────────────────────────────────────────────
function StatementSection({ title, rows, total, totalLabel, extra }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-5 py-3"><h3 className="font-black text-gray-700 text-sm">{title}</h3></div>
      <div className="divide-y divide-gray-50">
        {rows.length === 0 && <div className="px-5 py-3 text-xs text-gray-400 italic">Nothing posted.</div>}
        {rows.map(r => (
          <div key={r.account.id} className="flex justify-between px-5 py-2 text-sm">
            <span className="text-gray-700">{r.account.name}</span>
            <span className="font-mono font-semibold">{formatKsh(r.amount)}</span>
          </div>
        ))}
        {extra}
        <div className="flex justify-between px-5 py-2 text-sm font-black bg-gray-50">
          <span>{totalLabel}</span>
          <span className="font-mono">{formatKsh(total)}</span>
        </div>
      </div>
    </div>
  )
}

function ProfitAndLossTab() {
  const [rangeId, setRangeId] = useState('month')
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState(null)
  const { from, to } = rangeBounds(rangeId, customFrom, customTo)

  useEffect(() => { getProfitAndLoss({ from, to }).then(setReport) }, [from, to])

  if (!report) return <div className="text-gray-400 text-sm py-10 text-center">Loading…</div>

  function exportCsv() {
    downloadCSV([
      ...report.income.map(r => ({ Section: 'Income', Account: r.account.name, Amount: r.amount })),
      { Section: '', Account: 'Total Income', Amount: report.totalIncome },
      ...report.cogs.map(r => ({ Section: 'COGS', Account: r.account.name, Amount: r.amount })),
      { Section: '', Account: 'Gross Profit', Amount: report.grossProfit },
      ...report.opex.map(r => ({ Section: 'Operating Expense', Account: r.account.name, Amount: r.amount })),
      { Section: '', Account: 'Net Profit', Amount: report.netProfit },
    ], `rhipower-profit-and-loss-${from || 'inception'}-to-${to}.csv`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <RangePicker rangeId={rangeId} setRangeId={setRangeId} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />
        <button onClick={exportCsv} className="ml-auto text-xs font-bold text-blue-600 hover:text-blue-800">⬇ Export CSV</button>
      </div>

      <StatementSection title="Income" rows={report.income} total={report.totalIncome} totalLabel="Total Income" />
      <StatementSection title="Cost of Goods Sold" rows={report.cogs} total={report.totalCogs} totalLabel="Total COGS" />
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex justify-between items-center">
        <span className="text-sm font-bold text-blue-800">Gross Profit</span>
        <span className="font-mono font-black text-blue-800">{formatKsh(report.grossProfit)}</span>
      </div>
      <StatementSection title="Operating Expenses" rows={report.opex} total={report.totalOpex} totalLabel="Total Operating Expenses" />
      <div className={`border rounded-xl p-4 flex justify-between items-center ${report.netProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <span className={`text-sm font-black ${report.netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>Net Profit</span>
        <span className={`font-mono font-black text-lg ${report.netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatKsh(report.netProfit)}</span>
      </div>
    </div>
  )
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────
function BalanceSheetTab() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState(null)

  useEffect(() => { getBalanceSheet({ asOfDate }).then(setReport) }, [asOfDate])

  if (!report) return <div className="text-gray-400 text-sm py-10 text-center">Loading…</div>

  function exportCsv() {
    downloadCSV([
      ...report.assets.map(r => ({ Section: 'Asset', Account: r.account.name, Amount: r.amount })),
      { Section: '', Account: 'Total Assets', Amount: report.totalAssets },
      ...report.liabilities.map(r => ({ Section: 'Liability', Account: r.account.name, Amount: r.amount })),
      { Section: '', Account: 'Total Liabilities', Amount: report.totalLiabilities },
      ...report.equity.map(r => ({ Section: 'Equity', Account: r.account.name, Amount: r.amount })),
      { Section: '', Account: 'Current Earnings', Amount: report.currentEarnings },
      { Section: '', Account: 'Total Equity', Amount: report.totalEquity },
    ], `rhipower-balance-sheet-${asOfDate}.csv`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-bold text-gray-500">As of</label>
        <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={exportCsv} className="ml-auto text-xs font-bold text-blue-600 hover:text-blue-800">⬇ Export CSV</button>
      </div>
      <StatementSection title="Assets" rows={report.assets} total={report.totalAssets} totalLabel="Total Assets" />
      <StatementSection title="Liabilities" rows={report.liabilities} total={report.totalLiabilities} totalLabel="Total Liabilities" />
      <StatementSection title="Equity" rows={report.equity} total={report.totalEquity} totalLabel="Total Equity"
        extra={
          <div className="flex justify-between px-5 py-2 text-sm">
            <span className="text-gray-700">Current Earnings (net profit to date)</span>
            <span className="font-mono font-semibold">{formatKsh(report.currentEarnings)}</span>
          </div>
        } />
      {!report.balanced && (
        <div className="text-xs text-red-600 font-bold bg-red-50 border border-red-200 rounded-xl p-3">
          ⚠️ Assets ≠ Liabilities + Equity — this should never happen; look for a direct database edit outside the app.
        </div>
      )}
    </div>
  )
}

// ── VAT Report ────────────────────────────────────────────────────────────────
const VAT_STATUS_LABELS = { standard: 'Standard-rated', zero_rated: 'Zero-rated', exempt: 'Exempt' }

// Sales/purchase breakdown by vat_status isn't a GL concept — it reads the
// source documents (invoice_lines/vendor_bill_lines) directly rather than
// going through ledger.js, which only knows about journal_entry_lines.
async function fetchVatBreakdown({ from, to }) {
  let salesQuery = supabase.from('invoice_lines')
    .select('vat_status, unit_price_kes, vat_amount_kes, invoices!inner(issue_date, status)')
    .neq('invoices.status', 'void')
  if (from) salesQuery = salesQuery.gte('invoices.issue_date', from)
  if (to)   salesQuery = salesQuery.lte('invoices.issue_date', to)
  const { data: salesLines } = await salesQuery

  let purchaseQuery = supabase.from('vendor_bill_lines')
    .select('vat_status, line_total_kes, vat_amount_kes, vendor_bills!inner(bill_date, status)')
    .neq('vendor_bills.status', 'void')
  if (from) purchaseQuery = purchaseQuery.gte('vendor_bills.bill_date', from)
  if (to)   purchaseQuery = purchaseQuery.lte('vendor_bills.bill_date', to)
  const { data: purchaseLines } = await purchaseQuery

  const bucket = (lines, amountKey) => {
    const out = { standard: { net: 0, vat: 0 }, zero_rated: { net: 0, vat: 0 }, exempt: { net: 0, vat: 0 } }
    ;(lines || []).forEach(l => {
      const status = l.vat_status || 'standard'
      out[status].net += Number(l[amountKey] || 0)
      out[status].vat += Number(l.vat_amount_kes || 0)
    })
    return out
  }

  return { sales: bucket(salesLines, 'unit_price_kes'), purchases: bucket(purchaseLines, 'line_total_kes') }
}

function VatReportTab() {
  const [rangeId, setRangeId] = useState('month')
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const { from, to } = rangeBounds(rangeId, customFrom, customTo)

  useEffect(() => {
    Promise.all([getVatReport({ from, to }), fetchVatBreakdown({ from, to })]).then(([r, b]) => { setReport(r); setBreakdown(b) })
  }, [from, to])

  if (!report || !breakdown) return <div className="text-gray-400 text-sm py-10 text-center">Loading…</div>

  function exportCsv() {
    downloadCSV([
      { Type: 'Output VAT (on sales)', Amount: report.outputVat },
      { Type: 'Input VAT (on purchases)', Amount: report.inputVat },
      { Type: 'Net VAT Payable', Amount: report.netPayable },
    ], `rhipower-vat-report-${from || 'inception'}-to-${to}.csv`)
  }

  const vatTable = (title, data) => (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-5 py-3"><h3 className="font-black text-gray-700 text-sm">{title}</h3></div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-400 uppercase"><th className="px-4 py-2 text-left font-bold">Status</th><th className="px-4 py-2 text-right font-bold">Net</th><th className="px-4 py-2 text-right font-bold">VAT</th></tr></thead>
        <tbody className="divide-y divide-gray-50">
          {Object.entries(data).map(([status, v]) => (
            <tr key={status}>
              <td className="px-4 py-2">{VAT_STATUS_LABELS[status]}</td>
              <td className="px-4 py-2 text-right font-mono">{formatKsh(v.net)}</td>
              <td className="px-4 py-2 text-right font-mono">{formatKsh(v.vat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <RangePicker rangeId={rangeId} setRangeId={setRangeId} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />
        <button onClick={exportCsv} className="ml-auto text-xs font-bold text-blue-600 hover:text-blue-800">⬇ Export CSV</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl p-4 bg-blue-50 text-blue-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Output VAT (on sales)</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{formatKsh(report.outputVat)}</div>
        </div>
        <div className="rounded-2xl p-4 bg-amber-50 text-amber-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Input VAT (on purchases)</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{formatKsh(report.inputVat)}</div>
        </div>
        <div className={`rounded-2xl p-4 ${report.netPayable >= 0 ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">{report.netPayable >= 0 ? 'Net VAT Payable to KRA' : 'Net VAT Receivable'}</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{formatKsh(Math.abs(report.netPayable))}</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {vatTable('Sales by VAT Status', breakdown.sales)}
        {vatTable('Purchases by VAT Status', breakdown.purchases)}
      </div>
      <p className="text-xs text-gray-400">Directly usable for filling KRA's VAT3 return — Output VAT minus Input VAT is the amount payable (or, if negative, receivable) for the period.</p>
    </div>
  )
}

// ── Budget vs Actual ─────────────────────────────────────────────────────────
function BudgetVsActualTab({ session }) {
  const [accounts, setAccounts] = useState([])
  const [periodMonth, setPeriodMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [budgets, setBudgets] = useState([])
  const [plReport, setPlReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({})
  const [saving, setSaving] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const [year, month] = periodMonth.split('-').map(Number)
    const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10)
    const [accs, budgetRows, pl] = await Promise.all([
      fetchChartOfAccounts({ forceRefresh: true }),
      fetchBudgets(periodMonth),
      getProfitAndLoss({ from: periodMonth, to: monthEnd }),
    ])
    setAccounts(accs.filter(a => (a.account_type === 'income' || a.account_type === 'expense') && a.is_active !== false))
    setBudgets(budgetRows)
    setPlReport(pl)
    setLoading(false)
  }, [periodMonth])
  useEffect(() => { load() }, [load])

  function actualFor(accountId) {
    const all = [...(plReport?.income || []), ...(plReport?.cogs || []), ...(plReport?.opex || [])]
    return all.find(r => r.account.id === accountId)?.amount || 0
  }
  function budgetFor(accountId) {
    return Number(budgets.find(b => b.account_id === accountId)?.budgeted_amount_kes || 0)
  }

  function startEdit(accountId) { setEditing(p => ({ ...p, [accountId]: String(budgetFor(accountId) || '') })) }
  async function saveBudget(accountId) {
    setSaving(p => ({ ...p, [accountId]: true }))
    await setBudget(accountId, periodMonth, parseFloat(editing[accountId]) || 0, session)
    await load()
    setEditing(p => { const n = { ...p }; delete n[accountId]; return n })
    setSaving(p => ({ ...p, [accountId]: false }))
  }

  if (loading) return <div className="text-gray-400 text-sm py-10 text-center">Loading…</div>

  const totalBudgeted = accounts.reduce((s, a) => s + budgetFor(a.id), 0)
  const totalActual = accounts.reduce((s, a) => s + actualFor(a.id), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-bold text-gray-500">Month</label>
        <input type="month" value={periodMonth.slice(0, 7)} onChange={e => setPeriodMonth(`${e.target.value}-01`)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="px-4 py-2 text-left font-bold">Account</th>
              <th className="px-4 py-2 text-right font-bold">Budgeted</th>
              <th className="px-4 py-2 text-right font-bold">Actual</th>
              <th className="px-4 py-2 text-right font-bold">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {accounts.map(a => {
              const actual = actualFor(a.id)
              const budgeted = budgetFor(a.id)
              const variance = actual - budgeted
              const favorable = a.account_type === 'expense' ? variance <= 0 : variance >= 0
              return (
                <tr key={a.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-2">{a.code} — {a.name}</td>
                  <td className="px-4 py-2 text-right">
                    {editing[a.id] !== undefined ? (
                      <div className="flex items-center gap-1 justify-end">
                        <input type="number" value={editing[a.id]} autoFocus onChange={e => setEditing(p => ({ ...p, [a.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') saveBudget(a.id) }}
                          className="w-24 border-2 border-blue-400 rounded-lg px-2 py-1 text-right font-mono text-xs outline-none" />
                        <button onClick={() => saveBudget(a.id)} disabled={saving[a.id]} className="text-xs font-bold text-blue-600">{saving[a.id] ? '…' : '✓'}</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(a.id)} className="font-mono hover:text-blue-600 hover:underline">{formatKsh(budgeted)}</button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{formatKsh(actual)}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${budgeted === 0 ? 'text-gray-300' : favorable ? 'text-green-700' : 'text-red-700'}`}>
                    {budgeted === 0 ? '—' : `${variance >= 0 ? '+' : ''}${formatKsh(variance)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 font-black">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right font-mono">{formatKsh(totalBudgeted)}</td>
              <td className="px-4 py-2 text-right font-mono">{formatKsh(totalActual)}</td>
              <td className="px-4 py-2 text-right font-mono">{formatKsh(totalActual - totalBudgeted)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-gray-400">Click a budgeted amount to set or edit it. Variance is green when favorable (spent less than budgeted for expenses, earned more than budgeted for income) and red when unfavorable.</p>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export default function AdminAccounting({ session }) {
  const [section, setSection] = useState('coa')
  const [accounts, setAccounts] = useState(null)

  async function loadAccounts() {
    const rows = await fetchChartOfAccounts({ forceRefresh: true })
    setAccounts(rows)
  }
  useEffect(() => { loadAccounts() }, [])

  if (accounts === null) return <div className="text-gray-400 text-sm py-10 text-center">Loading accounting…</div>

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 w-fit">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition ${section === s.id ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
            {s.label}
          </button>
        ))}
      </div>
      {section === 'coa' && (
        <ChartOfAccountsTab
          accounts={accounts}
          session={session}
          onChanged={updated => setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a))}
          onAdded={added => setAccounts(prev => [...prev, added])}
        />
      )}
      {section === 'opening' && <OpeningBalancesTab session={session} />}
      {section === 'journal' && <JournalTab accounts={accounts} session={session} />}
      {section === 'bank'    && <BankReconciliationTab session={session} />}
      {section === 'trial'   && <TrialBalanceTab />}
      {section === 'pl'      && <ProfitAndLossTab />}
      {section === 'bs'      && <BalanceSheetTab />}
      {section === 'vat'     && <VatReportTab />}
      {section === 'budget'  && <BudgetVsActualTab session={session} />}
    </div>
  )
}
