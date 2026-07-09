// Supabase Edge Function — lets an admin manually add a customer, instead
// of relying entirely on customer self-signup (CustomerAuth.jsx).
//
// SETUP:
//   1. Deploy: supabase functions deploy invite-customer
//   2. No new secrets needed — reuses SUPABASE_URL/SUPABASE_ANON_KEY/
//      SUPABASE_SERVICE_ROLE_KEY, already provided to every function.
//   3. Called from the app via supabase.functions.invoke('invite-customer', { body: {...} })
//
// Two modes, since "send an email and hope they follow through" isn't
// always practical (a walk-in or phone-order customer may not check email
// right away, or at all):
//   mode: 'invite' — auth.admin.inviteUserByEmail sends Supabase's built-in
//     invite email; the account exists immediately but has no password
//     until the customer clicks the link and sets one.
//   mode: 'create' — auth.admin.createUser with an admin-supplied password
//     and email_confirm: true creates a fully active account right away —
//     no email round-trip. The admin is responsible for relaying the
//     password to the customer themselves (it's returned once in the
//     response so they can copy it — never stored or logged anywhere).
//
// Neither mode inserts into a profile table itself — migration 003's
// handle_new_customer trigger already does that automatically on every new
// auth.users row, reading full_name out of the user's metadata.
//
// Runs with service-role power, so — same as invite-admin — it verifies the
// CALLER is an admin before doing anything, since service role bypasses RLS.

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient }  from 'https://esm.sh/@supabase/supabase-js@2'

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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Not signed in' }, 401)

    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return json({ error: 'Not signed in' }, 401)

    const { data: callerProfile } = await callerClient
      .from('admin_profiles').select('id').eq('id', caller.id).maybeSingle()
    if (!callerProfile) return json({ error: 'Only an admin can add a customer' }, 403)

    const { email, fullName, mode, password } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return json({ error: 'Enter a valid email address' }, 400)
    }
    const cleanEmail = email.trim().toLowerCase()

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (mode === 'create') {
      if (!password || typeof password !== 'string' || password.length < 6) {
        return json({ error: 'Password must be at least 6 characters' }, 400)
      }
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName?.trim() || null },
      })
      if (createErr || !created?.user) {
        console.error('createUser failed:', createErr)
        return json({ error: createErr?.message || 'Could not create account' }, 500)
      }
      return json({
        userId: created.user.id,
        message: `Account created for ${cleanEmail}. Password: ${password} — share this with the customer now, it won't be shown again.`,
      })
    }

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
      data: { full_name: fullName?.trim() || null },
    })
    if (inviteErr || !invited?.user) {
      console.error('inviteUserByEmail failed:', inviteErr)
      return json({ error: inviteErr?.message || 'Could not send invite' }, 500)
    }

    return json({
      userId: invited.user.id,
      message: `Invite sent to ${cleanEmail} — their account already appears in the list; they'll be able to sign in once they set a password via the emailed link.`,
    })

  } catch (err) {
    console.error('invite-customer error:', err)
    return json({ error: 'Something went wrong sending the invite' }, 500)
  }
})
