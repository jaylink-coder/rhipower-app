# RhiPower Edge Functions

Deploy each with the Supabase CLI, then set its secrets. Secrets are shared
across all functions in a project (`supabase secrets set` applies project-wide).

## notify-new-quote
Sends an email alert on every new `quotation_requests` row (via a Database Webhook).

```
supabase functions deploy notify-new-quote
supabase secrets set RESEND_API_KEY=...
```

## invite-admin
Lets an existing admin invite a new one from Settings -> Users, without needing
Supabase Dashboard access. Verifies the caller is already an admin, then creates
the auth.users row (`auth.admin.inviteUserByEmail`, sends Supabase's built-in
invite email) and the matching `admin_profiles` row. Requires Auth email delivery
(SMTP) to be configured on the project — the same dependency customer signup
confirmation already relies on.

```
supabase functions deploy invite-admin
```

No new secrets — reuses `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`,
which Supabase auto-provides to every function in the project already.

## M-Pesa deposit collection (mpesa-stk-push, mpesa-callback, mpesa-status)
Lets a client pay a booking deposit via Safaricom Daraja STK Push. See
`supabase/migrations/002_mpesa_deposits.sql` for the `deposit_transactions` table.

```
supabase functions deploy mpesa-stk-push
supabase functions deploy mpesa-callback --no-verify-jwt   # Safaricom can't send a Supabase auth token
supabase functions deploy mpesa-status

supabase secrets set \
  MPESA_ENV=sandbox \
  MPESA_CONSUMER_KEY=... \
  MPESA_CONSUMER_SECRET=... \
  MPESA_SHORTCODE=... \
  MPESA_PASSKEY=... \
  MPESA_CALLBACK_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/mpesa-callback \
  SUPABASE_SERVICE_ROLE_KEY=...
```

Get Daraja credentials at [developer.safaricom.co.ke](https://developer.safaricom.co.ke).
Start in `MPESA_ENV=sandbox` against the test shortcode/passkey Safaricom provides
in the developer portal, and switch to `production` (with your real paybill/till
shortcode) only once a few sandbox deposits complete end-to-end.

**Why three functions, not one:** `mpesa-stk-push` starts the payment and is called
from the browser. `mpesa-callback` is the public URL Safaricom posts the result to —
it never trusts that post alone, and re-confirms with Daraja's own STK Push Query
endpoint before marking a deposit "completed" (see the code comments in
`mpesa-callback/index.ts` for why). `mpesa-status` is a narrow read-only endpoint the
browser polls, so the `deposit_transactions` table itself never needs an anon RLS
policy — clients can't query it directly, only ask "what's the status of the one
transaction I just started."
