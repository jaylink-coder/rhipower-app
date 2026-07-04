// Supabase Edge Function — Safaricom Daraja posts here when an STK Push resolves.
//
// SECURITY NOTE: Daraja does not sign or authenticate its callbacks — anyone who
// learns this URL could POST a forged "success" body. So this handler never
// trusts the callback alone: it always re-confirms the result with Daraja's own
// STK Push Query endpoint before marking a deposit "completed", and only ever
// transitions a transaction it already created in 'pending' state (looked up by
// CheckoutRequestID) — an unrecognised ID is ignored, not trusted.
//
// SETUP:
//   1. Deploy: supabase functions deploy mpesa-callback --no-verify-jwt
//      (--no-verify-jwt because Safaricom can't send a Supabase auth token)
//   2. Set MPESA_CALLBACK_URL (in mpesa-stk-push's secrets) to this function's URL

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient }  from 'https://esm.sh/@supabase/supabase-js@2'
import { stkPushQuery }  from '../_shared/daraja.ts'

// Safaricom expects exactly this shape back, regardless of what we did internally —
// returning an error here just makes Safaricom retry the same callback.
const ACK = { ResultCode: 0, ResultDesc: 'Accepted' }

function metadataValue(items: { Name: string; Value?: unknown }[] | undefined, name: string) {
  return items?.find(i => i.Name === name)?.Value
}

serve(async (req: Request) => {
  try {
    const body      = await req.json()
    const callback  = body?.Body?.stkCallback
    if (!callback?.CheckoutRequestID) return new Response(JSON.stringify(ACK), { status: 200 })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: txn } = await supabase
      .from('deposit_transactions')
      .select('*')
      .eq('checkout_request_id', callback.CheckoutRequestID)
      .maybeSingle()

    // Unknown CheckoutRequestID, or already resolved — ack and stop (idempotent).
    if (!txn || txn.status !== 'pending') return new Response(JSON.stringify(ACK), { status: 200 })

    // Callback says success — independently re-confirm with Daraja before trusting it.
    if (callback.ResultCode === 0) {
      const items   = callback.CallbackMetadata?.Item
      const amount  = Number(metadataValue(items, 'Amount'))
      const receipt = metadataValue(items, 'MpesaReceiptNumber') as string | undefined

      let confirmed = false
      try {
        const query = await stkPushQuery(callback.CheckoutRequestID)
        confirmed = query.ResultCode === '0' || query.ResultCode === 0
      } catch (err) {
        console.error('stkPushQuery confirmation failed:', err)
      }

      if (confirmed && amount === Number(txn.amount_kes)) {
        await supabase.from('deposit_transactions').update({
          status:        'completed',
          mpesa_receipt: receipt ?? null,
          result_desc:   callback.ResultDesc,
          updated_at:    new Date().toISOString(),
        }).eq('id', txn.id)
      } else {
        // Callback claimed success but the independent query didn't agree, or the
        // amount didn't match what we asked for — don't auto-confirm, flag for a human.
        await supabase.from('deposit_transactions').update({
          status:      'needs_review',
          result_desc: `Callback said success but verification did not match (amount=${amount})`,
          updated_at:  new Date().toISOString(),
        }).eq('id', txn.id)
      }
    } else {
      await supabase.from('deposit_transactions').update({
        status:      'failed',
        result_desc: callback.ResultDesc ?? 'Payment failed or cancelled',
        updated_at:  new Date().toISOString(),
      }).eq('id', txn.id)
    }

  } catch (err) {
    console.error('mpesa-callback error:', err)
  }

  // Always 200 + this exact body — Safaricom retries on anything else.
  return new Response(JSON.stringify(ACK), { status: 200 })
})
