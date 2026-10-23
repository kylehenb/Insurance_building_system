import type { MailAddress } from './summary'
import { mailDb } from './sync'

// Suggestions for the To / Cc / Bcc boxes: trades, insurers and adjusters,
// and anyone the office has emailed with (from the emails filed in the app).

const LIMIT = 8

export async function searchContacts(tenantId: string, q: string, db = mailDb()): Promise<MailAddress[]> {
  const term = q.trim().replace(/[%_,()]/g, '')
  if (term.length < 2) return []
  const like = `%${term}%`

  const [trades, clients, sent, received] = await Promise.all([
    db.from('trades').select('business_name, contact_email').eq('tenant_id', tenantId)
      .not('contact_email', 'is', null)
      .or(`business_name.ilike.${like},contact_email.ilike.${like}`).limit(LIMIT),
    db.from('clients').select('name, submission_email, adjuster_submission_email').eq('tenant_id', tenantId)
      .or(`name.ilike.${like},submission_email.ilike.${like},adjuster_submission_email.ilike.${like}`).limit(LIMIT),
    db.from('communications').select('to_email').eq('tenant_id', tenantId).eq('direction', 'outbound')
      .ilike('to_email', like).order('created_at', { ascending: false }).limit(40),
    db.from('communications').select('contact_name, from_email').eq('tenant_id', tenantId).eq('direction', 'inbound')
      .or(`from_email.ilike.${like},contact_name.ilike.${like}`).order('created_at', { ascending: false }).limit(40),
  ])

  const out: MailAddress[] = []
  const add = (name: string | null | undefined, email: string | null | undefined) => {
    const e = email?.trim()
    if (!e || !e.includes('@') || out.some(o => o.email.toLowerCase() === e.toLowerCase())) return
    const text = `${name ?? ''} ${e}`.toLowerCase()
    if (!text.includes(term.toLowerCase())) return
    out.push({ name: name?.trim() ?? '', email: e })
  }

  for (const t of (trades.data as { business_name: string | null; contact_email: string | null }[] | null) ?? []) add(t.business_name, t.contact_email)
  for (const c of (clients.data as { name: string; submission_email: string | null; adjuster_submission_email: string | null }[] | null) ?? []) {
    add(c.name, c.submission_email)
    add(c.name, c.adjuster_submission_email)
  }
  for (const r of (received.data as { contact_name: string | null; from_email: string | null }[] | null) ?? []) add(r.contact_name, r.from_email)
  for (const s of (sent.data as { to_email: string | null }[] | null) ?? []) {
    for (const email of (s.to_email ?? '').match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []) add('', email)
  }
  return out.slice(0, LIMIT)
}
