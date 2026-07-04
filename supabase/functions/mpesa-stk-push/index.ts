// Supabase Edge Function — starts an M-Pesa STK Push to collect a booking deposit.
//
// SETUP:
//   1. Deploy: supabase functions deploy mpesa-stk-push
//   2. Set secrets: supabase secrets set MPESA_ENV=sandbox MPESA_CONSUMER_KEY=... \
//        MPESA_CONSUMER_SECRET=... MPESA_SHORTCODE=... MPESA_PASSKEY=... \
//        MPESA_CALLBACK_URL=https://YOUR_PROJECT.supabase.co/functions/v1/mpesa-callback \
//        SUPABASE_SERVICE_ROLE_KEY=...
//   3. Called from the app via supabase.functions.invoke('mpesa-stk-push', { body: {...} })

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient }  from 'https://esm.sh/@supabase/supabase-js@2'
import { stkPush, normPhone } from '../_shared/daraja.ts'

const MIN_DEPOSIT_KES = 500
const MAX_DEPOSIT_KES = 500_000

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { quotationId, phone, amount } = await req.json()

    if (!phone || typeof phone !== 'string') return json({ error: 'Phone number required' }, 400)
    const numericAmount = Number(amount)
    if (!numericAmount || numericAmount < MIN_DEPOSIT_KES || numericAmount > MAX_DEPOSIT_KES) {
      return json({ error: `Amount must be between KES ${MIN_DEPOSIT_KES} and ${MAX_DEPOSIT_KES}` }, 400)
    }

    const normalised = normPhone(phone)
    if (!/^2547\d{8}$|^2541\d{8}$/.test(normalised)) {
      return json({ error: 'Enter a valid Safaricom number, e.g. 07XX XXX XXX' }, 400)
    }

    const stkRes = await stkPush({
      phone:       normalised,
      amount:      numericAmount,
      reference:   quotationId ? String(quotationId).slice(0, 12) : 'RhiPower',
      description: 'RhiPower Deposit',
    })

    if (stkRes.ResponseCode !== '0' || !stkRes.CheckoutRequestID) {
      return json({ error: stkRes.errorMessage || stkRes.ResponseDescription || 'STK push failed' }, 502)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { error: dbError } = await supabase.from('deposit_transactions').insert({
      quotation_id:        quotationId || null,
      phone:               normalised,
      amount_kes:          numericAmount,
      checkout_request_id: stkRes.CheckoutRequestID,
      merchant_request_id: stkRes.MerchantRequestID,
      status:              'pending',
    })
    if (dbError) {
      console.error('deposit_transactions insert failed:', dbError)
      return json({ error: 'Could not record transaction — please try again' }, 500)
    }

    return json({
      checkoutRequestId: stkRes.CheckoutRequestID,
      message: 'Check your phone and enter your M-Pesa PIN to complete the deposit.',
    })

  } catch (err) {
    console.error('mpesa-stk-push error:', err)
    return json({ error: 'Something went wrong starting the M-Pesa request' }, 500)
  }
})
