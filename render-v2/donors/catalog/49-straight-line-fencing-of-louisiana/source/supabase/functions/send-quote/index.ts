import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { z } from 'npm:zod@3.23.8'

const Schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(7).max(40),
  projectType: z.string().trim().max(120).optional().default(''),
  address: z.string().trim().max(255).optional().default(''),
  message: z.string().trim().min(1).max(2000).optional(),
  details: z.string().trim().min(1).max(2000).optional(),
  sourceUrl: z.string().trim().max(500).optional().default(''),
  businessName: z.string().trim().max(200).optional().default(''),
}).transform((d) => ({ ...d, message: d.message || d.details || '' }))
  .refine((d) => d.message.length > 0, { message: 'message required' })

const TO = 'straightlinefencingla@gmail.com'
const BCC = 'woodwardsoftware@gmail.com'
const FROM = 'Straight Line Fencing <forms@wss-ai.com>'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'Email service not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const parsed = Schema.safeParse(await req.json())
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { name, email, phone, projectType, address, message, sourceUrl, businessName } = parsed.data

    const html = `
      <div style="font-family:Arial,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;color:#2A3E23;">New fence quote request${businessName ? ` — ${escape(businessName)}` : ''}</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#555;width:120px;">Name</td><td style="padding:6px 0;"><strong>${escape(name)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#555;">Email</td><td style="padding:6px 0;">${escape(email)}</td></tr>
          <tr><td style="padding:6px 0;color:#555;">Phone</td><td style="padding:6px 0;">${escape(phone)}</td></tr>
          ${projectType ? `<tr><td style="padding:6px 0;color:#555;">Project type</td><td style="padding:6px 0;">${escape(projectType)}</td></tr>` : ''}
          ${address ? `<tr><td style="padding:6px 0;color:#555;">Address</td><td style="padding:6px 0;">${escape(address)}</td></tr>` : ''}
          ${sourceUrl ? `<tr><td style="padding:6px 0;color:#555;">Source</td><td style="padding:6px 0;"><a href="${escape(sourceUrl)}">${escape(sourceUrl)}</a></td></tr>` : ''}
        </table>
        <h3 style="margin:20px 0 6px;color:#49331B;">Details</h3>
        <p style="white-space:pre-wrap;line-height:1.5;">${escape(message)}</p>
      </div>`

    const r = await fetch('https://connector-gateway.lovable.dev/resend/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        bcc: [BCC],
        reply_to: email,
        subject: `New quote request — ${name}`,
        html,
      }),
    })

    if (!r.ok) {
      const body = await r.text()
      console.error('resend failed', r.status, body)
      return new Response(JSON.stringify({ ok: false, error: 'send_failed' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true, provider: 'resend' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ ok: false, error: 'server_error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
