// Supabase Edge Function — invites a new admin by email.
//
// SETUP:
//   1. Deploy: supabase functions deploy invite-admin
//   2. No new secrets needed — reuses SUPABASE_URL/SUPABASE_ANON_KEY/
//      SUPABASE_SERVICE_ROLE_KEY, which Supabase auto-provides to every
//      edge function in this project already.
//   3. Called from the app via supabase.functions.invoke('invite-admin', { body: {...} })
//
// Requires Supabase Auth's email delivery (SMTP) to be configured on the
// project for the invite email to actually send — the same dependency
// customer signup confirmation emails already rely on.
//
// This runs with service-role power (needed to create the auth.users row
// and write admin_profiles, both blocked for normal clients by RLS/design),
// so it must verify the CALLER is already an admin itself before doing
// anything — service role bypasses RLS entirely, so that check can't be
// left to the database here.

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
    if (!callerProfile) return json({ error: 'Only an existing admin can invite another admin' }, 403)

    const { email, fullName, role } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return json({ error: 'Enter a valid email address' }, 400)
    }
    const cleanEmail = email.trim().toLowerCase()

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(cleanEmail)
    if (inviteErr || !invited?.user) {
      console.error('inviteUserByEmail failed:', inviteErr)
      return json({ error: inviteErr?.message || 'Could not send invite' }, 500)
    }

    const { error: profileErr } = await admin.from('admin_profiles').insert({
      id:        invited.user.id,
      email:     cleanEmail,
      full_name: fullName?.trim() || null,
      role:      role === 'technician' ? 'technician' : 'admin',
    })
    if (profileErr) {
      console.error('admin_profiles insert failed:', profileErr)
      return json({ error: 'Invite email was sent, but finishing setup failed — check Supabase Auth users and admin_profiles manually' }, 500)
    }

    return json({ message: `Invite sent to ${cleanEmail}` })

  } catch (err) {
    console.error('invite-admin error:', err)
    return json({ error: 'Something went wrong sending the invite' }, 500)
  }
})
