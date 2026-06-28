// Supabase Edge Function — fires when a new quotation is submitted
// Sends an instant email to the RhiPower admin (you)
//
// SETUP:
//   1. Deploy this function from the Supabase Dashboard → Edge Functions
//   2. Set environment variable RESEND_API_KEY in the function settings
//   3. Create a Database Webhook: Database → Webhooks → Create
//      - Table: quotation_requests
//      - Event: INSERT
//      - URL: your Edge Function URL (shown after deploy)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const ADMIN_EMAIL    = 'jaylinkpowersystems@gmail.com'
const FROM_EMAIL     = 'noreply@rhipower.co.ke'  // must be a verified domain in Resend

serve(async (req: Request) => {
  try {
    const payload = await req.json()
    const record  = payload.record  // the new quotation_requests row

    const tierMap: Record<string, string> = {
      premium:  'Premium (Victron + BYD)',
      balanced: 'Balanced (Felicity + LONGi)',
      budget:   'Budget (Must Energy)',
    }
    const pathMap: Record<string, string> = {
      buy:  'Supply Only',
      diy:  'DIY / Own Electrician',
      book: 'Full Turnkey',
    }
    const profileMap: Record<string, string> = {
      homeowner:    'Homeowner',
      diy:          'DIY Enthusiast',
      professional: 'Electrical Engineer / Installer',
      business:     'Business / Project',
    }

    const tier     = tierMap[record.tier_selected]   || record.tier_selected
    const path     = pathMap[record.path_selected]   || record.path_selected   || 'Not selected'
    const profile  = profileMap[record.client_profile] || record.client_profile
    const total    = Number(record.grand_total_kes).toLocaleString('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })
    const whatsapp = (record.client_phone || '').replace(/\D/g, '')
    const created  = new Date(record.created_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })

    const emailBody = `
<h2 style="color:#1e40af;">⚡ New RhiPower Lead</h2>
<p><strong>Time:</strong> ${created}</p>
<hr/>
<h3>Client</h3>
<table cellpadding="6" style="border-collapse:collapse;width:100%">
  <tr><td><b>Name</b></td><td>${record.client_name}</td></tr>
  <tr><td><b>Phone</b></td><td><a href="https://wa.me/${whatsapp}">${record.client_phone}</a></td></tr>
  <tr><td><b>Email</b></td><td>${record.client_email || '—'}</td></tr>
  <tr><td><b>Address</b></td><td>${record.site_address || '—'}</td></tr>
  <tr><td><b>Profile</b></td><td>${profile}</td></tr>
  <tr><td><b>Path chosen</b></td><td>${path}</td></tr>
</table>
<h3>System Design</h3>
<table cellpadding="6" style="border-collapse:collapse;width:100%">
  <tr><td><b>Location</b></td><td>${record.location || '—'} (${record.psh} PSH/day)</td></tr>
  <tr><td><b>Tier</b></td><td>${tier}</td></tr>
  <tr><td><b>Backup</b></td><td>${record.backup_days} day${record.backup_days !== 1 ? 's' : ''}</td></tr>
  <tr><td><b>Solar Array</b></td><td>${record.panel_qty} panels — ${record.true_pv_kw} kWp</td></tr>
  <tr><td><b>Inverter</b></td><td>${record.inverter_qty} unit(s) — ${record.total_inv_kw} kW</td></tr>
  <tr><td><b>Battery</b></td><td>${record.battery_qty} pack(s) — ${record.true_batt_kwh} kWh</td></tr>
</table>
<h3>Pricing</h3>
<table cellpadding="6" style="border-collapse:collapse;width:100%">
  <tr><td><b>Hardware</b></td><td>KES ${Number(record.materials_kes).toLocaleString()}</td></tr>
  <tr><td><b>Labour</b></td><td>KES ${Number(record.labor_kes).toLocaleString()}</td></tr>
  <tr><td><b>Logistics</b></td><td>KES ${Number(record.logistics_kes).toLocaleString()}</td></tr>
  <tr style="background:#dcfce7"><td><b>TOTAL</b></td><td><b>${total}</b></td></tr>
</table>
<br/>
<a href="https://wa.me/${whatsapp}" style="background:#25d366;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
  Reply via WhatsApp
</a>
<br/><br/>
<p style="color:#9ca3af;font-size:12px;">
  View all leads: <a href="https://supabase.com/dashboard/project/qsuisdtnzrxrdqcqbvem/editor">Supabase Dashboard</a>
</p>
`

    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [ADMIN_EMAIL],
        subject: `🔆 New Lead: ${record.client_name} — ${total}`,
        html:    emailBody,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Resend error:', err)
      return new Response(JSON.stringify({ error: err }), { status: 500 })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })

  } catch (err) {
    console.error('Function error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
