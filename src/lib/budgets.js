// RhiPower — Simple budgeting: one budgeted amount per (account, month),
// compared against getProfitAndLoss()'s actuals in the UI. No posting
// logic here — this table is purely a comparison input.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'

export async function fetchBudgets(periodMonth) {
  const { data, error } = await supabase.from('budgets').select('*').eq('period_month', periodMonth)
  if (error) throw error
  return data || []
}

export async function setBudget(accountId, periodMonth, budgetedAmountKes, session) {
  const { data, error } = await supabase.from('budgets')
    .upsert({
      account_id: accountId, period_month: periodMonth, budgeted_amount_kes: budgetedAmountKes,
      admin_id: session?.user?.id || null, admin_email: session?.user?.email || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,period_month' })
    .select().single()
  if (error) throw error
  logAdminAction(session, 'budget_set', data.id, { account_id: accountId, period_month: periodMonth, amount: budgetedAmountKes })
  return data
}
