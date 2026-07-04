// Supabase Edge Function — lets the client poll the status of ONE deposit it
// just started, without ever granting anon read access to the deposits table
// itself (deposit_transactions has no anon RLS policy at all, by design).
//
// SETUP: supabase functions deploy mpesa-status

import { serve }       from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const { checkoutRequestId } = await req.json().catch(() => ({ checkoutRequestId: null }))
  if (!checkoutRequestId) {
    return new Response(JSON.stringify({ error: 'checkoutRequestId required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data } = await supabase
    .from('deposit_transactions')
    .select('status, mpesa_receipt, amount_kes')
    .eq('checkout_request_id', checkoutRequestId)
    .maybeSingle()

  return new Response(JSON.stringify(data ?? { status: 'unknown' }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
