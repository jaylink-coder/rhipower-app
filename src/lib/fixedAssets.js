// RhiPower — Fixed Assets & straight-line depreciation. Deliberately not
// linked to vendor_bills (see migration 025's comment) — an asset bought on
// credit posts straight to Accounts Payable itself.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'
import { postJournalEntry } from './ledger.js'

const PAYMENT_TO_ACCOUNT_KEY = {
  petty_cash: 'petty_cash', bank_operating: 'bank_operating', mpesa_till: 'mpesa_till', accounts_payable: 'accounts_payable',
}

export async function fetchFixedAssets() {
  const { data, error } = await supabase.from('fixed_assets')
    .select('*, depreciation_entries(*)').order('asset_number')
  if (error) throw error
  return data || []
}

export function accumulatedDepreciation(asset) {
  return (asset.depreciation_entries || []).reduce((s, d) => s + Number(d.amount_kes), 0)
}
export function bookValue(asset) {
  return Number(asset.purchase_cost_kes) - accumulatedDepreciation(asset)
}

export async function createFixedAsset({ name, category, assetAccountId, accumDeprAccountId, purchaseDate, purchaseCostKes, salvageValueKes, usefulLifeMonths, paymentMethod, notes }, session) {
  const { data: asset, error } = await supabase.from('fixed_assets').insert({
    name, category, asset_account_id: assetAccountId, accum_depr_account_id: accumDeprAccountId,
    purchase_date: purchaseDate, purchase_cost_kes: purchaseCostKes,
    salvage_value_kes: salvageValueKes || 0, useful_life_months: usefulLifeMonths,
    notes: notes || null,
    admin_id: session?.user?.id || null, admin_email: session?.user?.email || null,
  }).select().single()
  if (error) throw error

  await postJournalEntry({
    entryDate: purchaseDate,
    memo: `Fixed asset acquired — ${name}`,
    sourceType: 'fixed_asset', sourceId: asset.id,
    lines: [
      { accountId: assetAccountId, debit: purchaseCostKes },
      { accountKey: PAYMENT_TO_ACCOUNT_KEY[paymentMethod] || 'bank_operating', credit: purchaseCostKes },
    ],
  }, session)

  logAdminAction(session, 'fixed_asset_created', asset.id, { name, purchase_cost_kes: purchaseCostKes })
  return asset
}

// UNIQUE(fixed_asset_id, period_date) makes this idempotent — running the
// same month twice for the same asset is a safe no-op (returns null).
export async function runDepreciation(asset, periodDate, session) {
  const depreciableBase = Number(asset.purchase_cost_kes) - Number(asset.salvage_value_kes)
  const monthlyAmount = Math.round((depreciableBase / asset.useful_life_months) * 100) / 100
  const remaining = Math.round((depreciableBase - accumulatedDepreciation(asset)) * 100) / 100
  if (remaining <= 0) return null  // already fully depreciated

  const amount = Math.min(monthlyAmount, remaining)

  const { data: entry, error } = await supabase.from('depreciation_entries')
    .insert({ fixed_asset_id: asset.id, period_date: periodDate, amount_kes: amount }).select().single()
  if (error) {
    if (error.code === '23505') return null  // unique violation — this month already ran
    throw error
  }

  const je = await postJournalEntry({
    entryDate: periodDate,
    memo: `Depreciation — ${asset.name} (${periodDate.slice(0, 7)})`,
    sourceType: 'depreciation', sourceId: asset.id,
    lines: [
      { accountKey: 'depreciation_expense', debit:  amount },
      { accountId: asset.accum_depr_account_id, credit: amount },
    ],
  }, session)

  await supabase.from('depreciation_entries').update({ journal_entry_id: je.id }).eq('id', entry.id)
  logAdminAction(session, 'depreciation_posted', asset.id, { period_date: periodDate, amount })
  return entry
}

export async function runDepreciationForAllActive(periodDate, session) {
  const assets = await fetchFixedAssets()
  const results = []
  for (const asset of assets.filter(a => a.status === 'active')) {
    const entry = await runDepreciation(asset, periodDate, session)
    if (entry) results.push({ asset, entry })
  }
  return results
}

export async function disposeAsset(asset, { disposalDate, proceedsKes }, session) {
  const accumulated = accumulatedDepreciation(asset)
  const netBookValue = Number(asset.purchase_cost_kes) - accumulated
  const proceeds = Number(proceedsKes) || 0
  const gainLoss = Math.round((proceeds - netBookValue) * 100) / 100

  const lines = [
    { accountId: asset.accum_depr_account_id, debit:  accumulated },
    { accountId: asset.asset_account_id,       credit: Number(asset.purchase_cost_kes) },
  ]
  if (proceeds > 0) lines.push({ accountKey: 'bank_operating', debit: proceeds })
  if (gainLoss > 0) lines.push({ accountKey: 'disposal_gain_loss', credit: gainLoss })
  if (gainLoss < 0) lines.push({ accountKey: 'disposal_gain_loss', debit: -gainLoss })

  await postJournalEntry({
    entryDate: disposalDate,
    memo: `Disposed asset — ${asset.name}`,
    sourceType: 'fixed_asset', sourceId: asset.id,
    lines,
  }, session)

  const { data: updated, error } = await supabase.from('fixed_assets')
    .update({ status: 'disposed', disposed_at: disposalDate, disposal_proceeds_kes: proceeds, updated_at: new Date().toISOString() })
    .eq('id', asset.id).select().single()
  if (error) throw error
  logAdminAction(session, 'fixed_asset_disposed', asset.id, { proceeds, gain_loss: gainLoss })
  return updated
}
