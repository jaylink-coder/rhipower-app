// Safaricom Daraja API — STK Push (deposit collection) + status query.
// Shared by mpesa-stk-push and mpesa-callback Edge Functions.
//
// Secrets required (set with `supabase secrets set NAME=value`):
//   MPESA_ENV, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET,
//   MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL

const BASE = Deno.env.get('MPESA_ENV') === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

let cachedToken: { value: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value

  const key    = Deno.env.get('MPESA_CONSUMER_KEY')    ?? ''
  const secret = Deno.env.get('MPESA_CONSUMER_SECRET') ?? ''
  const creds  = btoa(`${key}:${secret}`)

  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` },
  })
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`)

  const { access_token, expires_in } = await res.json()
  cachedToken = { value: access_token, expiresAt: Date.now() + (Number(expires_in) - 60) * 1000 }
  return access_token
}

/** Kenyan phone → Daraja's expected 2547XXXXXXXX / 2541XXXXXXXX format */
export function normPhone(phone: string): string {
  const p = phone.trim().replace(/[\s\-()]/g, '')
  if (p.startsWith('+254')) return p.slice(1)
  if (p.startsWith('254'))  return p
  if (p.startsWith('0'))    return `254${p.slice(1)}`
  return p
}

function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14)
}

function password(shortcode: string, passkey: string, ts: string): string {
  return btoa(`${shortcode}${passkey}${ts}`)
}

export async function stkPush({
  phone, amount, reference, description,
}: { phone: string; amount: number; reference: string; description: string }) {
  const token     = await getToken()
  const shortcode = Deno.env.get('MPESA_SHORTCODE') ?? ''
  const passkey   = Deno.env.get('MPESA_PASSKEY')   ?? ''
  const ts        = timestamp()

  const res = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password:          password(shortcode, passkey, ts),
      Timestamp:         ts,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            Math.ceil(amount),
      PartyA:            normPhone(phone),
      PartyB:            shortcode,
      PhoneNumber:       normPhone(phone),
      CallBackURL:       `${Deno.env.get('MPESA_CALLBACK_URL')}`,
      AccountReference:  reference.slice(0, 12),
      TransactionDesc:   description.slice(0, 13),
    }),
  })
  return res.json()
}

/**
 * Independent server-to-server confirmation of an STK push result.
 * Used by the callback handler so a single (unsigned) Safaricom callback
 * is never the sole basis for marking a deposit "completed" — see the
 * RhiPower architecture review for why Daraja callbacks can't be trusted alone.
 */
export async function stkPushQuery(checkoutRequestId: string) {
  const token     = await getToken()
  const shortcode = Deno.env.get('MPESA_SHORTCODE') ?? ''
  const passkey   = Deno.env.get('MPESA_PASSKEY')   ?? ''
  const ts        = timestamp()

  const res = await fetch(`${BASE}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password:          password(shortcode, passkey, ts),
      Timestamp:         ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  })
  return res.json()
}
