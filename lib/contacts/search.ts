import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// Looking up someone's phone and email by name: the trades directory (the
// Trades page — the businesses work orders go to), then the people we've
// emailed with (communications), with a phone number from their latest email
// signature when the directory doesn't have one, then insureds on jobs. When
// none of those has a phone number, the mailbox is searched by sender name
// (suppliers often only appear there). Used by the voice connector's
// find_contact.

type Client = SupabaseClient<Database>

export interface ContactMatch {
  name: string
  /** The person at a business, if known */
  contact_person: string | null
  /** Their trade, from the trades directory */
  trade: string | null
  phone: string | null
  /** Where the phone number came from */
  phone_source: 'trade directory' | 'email signature' | 'job' | null
  other_phones: string[]
  email: string | null
  source: 'trade directory' | 'email history' | 'insured on a job'
  /** Jobs they're on (work orders, emails, insured) — newest first */
  jobs: string[]
  last_email: string | null
  status: string | null
  notes: string | null
}

const MAX_ROWS = 50
const MAX_JOBS = 5
const DEFAULT_LIMIT = 6
/** The mailbox search: messages read, and different senders kept */
const MAIL_MESSAGES = 6
const MAIL_SENDERS = 3

/** ilike treats % and _ as wildcards */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, m => `\\${m}`)
const tidy = (v: string | null | undefined) => v?.trim() || null

// Australian mobiles, landlines (with area code) and 1300 / 1800 numbers
const PHONE_RE = /(?:\+61\s?|\b0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|(?:\+61\s?[2378]|\(0[2378]\)|\b0[2378])[\s-]?\d{4}[\s-]?\d{4}\b|\b1[38]00[\s-]?\d{3}[\s-]?\d{3}\b/g
// Where the quoted earlier email starts in a reply
const QUOTE_RE = /^(On .{0,200}wrote:|From:|-{2,}\s*Original Message|_{5,}|>)/im

const digits = (v: string) => v.replace(/\D/g, '').replace(/^61/, '0')

/** Phone numbers in an email's own text (not the email it quotes), minus the ones to leave out */
export function phonesInEmail(text: string | null | undefined, leaveOut: string[] = []): string[] {
  if (!text) return []
  const own = text.split(QUOTE_RE)[0]
  const skip = new Set(leaveOut.map(digits))
  const out = new Map<string, string>()
  for (const m of own.match(PHONE_RE) ?? []) {
    const d = digits(m)
    if (!skip.has(d) && !out.has(d)) out.set(d, m.replace(/\s+/g, ' ').trim())
  }
  return [...out.values()]
}

type CommRow = { contact_name: string | null; from_email: string | null; to_email: string | null; direction: string | null; body_text: string | null; created_at: string | null; job_id: string | null }

/** Recent senders in the mailbox whose name or address has these words, with the phone numbers in their signature */
export async function findMailContacts(name: string, leaveOutPhones: string[] = [], leaveOutAddresses: string[] = []): Promise<ContactMatch[]> {
  const { getGmailClient } = await import('@/lib/gmail/client')
  const { parseMessage, messageText } = await import('@/lib/mail/message')
  const gmail = getGmailClient()
  const list = await gmail.users.messages.list({ userId: 'me', q: `from:"${name.replace(/"/g, '')}"`, maxResults: MAIL_MESSAGES })
  const seen = new Map<string, ContactMatch>()
  for (const { id } of list.data.messages ?? []) {
    if (!id || seen.size >= MAIL_SENDERS) continue
    const msg = parseMessage((await gmail.users.messages.get({ userId: 'me', id, format: 'full' })).data)
    const email = msg.from?.email?.toLowerCase()
    if (!email || seen.has(email) || leaveOutAddresses.includes(email)) continue
    const phones = phonesInEmail(messageText(msg), leaveOutPhones)
    seen.set(email, {
      name: tidy(msg.from?.name) ?? email, contact_person: null, trade: null,
      phone: phones[0] ?? null, phone_source: phones.length ? 'email signature' : null, other_phones: phones.slice(1),
      email, source: 'email history', jobs: [], last_email: msg.date, status: null, notes: null,
    })
  }
  return [...seen.values()]
}

export async function findContacts(
  db: Client, tenantId: string, name: string,
  { limit = DEFAULT_LIMIT, mail = findMailContacts }: { limit?: number; mail?: typeof findMailContacts } = {},
): Promise<ContactMatch[]> {
  const q = name.trim()
  if (q.length < 2) return []
  const pattern = `%${escapeLike(q)}%`

  const [tradeHits, commHits, insuredHits, tenant] = await Promise.all([
    Promise.all(['business_name', 'entity_name', 'primary_contact', 'contact_email'].map(col =>
      db.from('trades').select('*').eq('tenant_id', tenantId).ilike(col, pattern).limit(MAX_ROWS))),
    Promise.all(['contact_name', 'from_email', 'to_email'].map(col =>
      db.from('communications').select('contact_name, from_email, to_email, direction, body_text, created_at, job_id')
        .eq('tenant_id', tenantId).eq('type', 'email').ilike(col, pattern).order('created_at', { ascending: false }).limit(MAX_ROWS))),
    db.from('jobs').select('job_number, insured_name, insured_phone, insured_email, created_at').eq('tenant_id', tenantId).ilike('insured_name', pattern)
      .order('created_at', { ascending: false }).limit(MAX_ROWS),
    db.from('tenants').select('contact_phone, contact_email, accounts_email').eq('id', tenantId).maybeSingle(),
  ])
  for (const r of [...tradeHits, ...commHits, insuredHits]) if (r.error) throw r.error
  const ours = [tenant.data?.contact_phone].filter((p): p is string => !!p)
  const ownAddresses = new Set([tenant.data?.contact_email, tenant.data?.accounts_email].filter(Boolean).map(e => e!.toLowerCase()))

  const trades = [...new Map(tradeHits.flatMap(r => r.data ?? []).map(t => [t.id, t])).values()]
  const comms = [...new Map(commHits.flatMap(r => (r.data ?? []) as CommRow[]).map(c => [`${c.created_at}|${c.from_email}|${c.to_email}`, c])).values()]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))

  // Jobs: work orders for the trades, emails for everyone
  const jobIds = new Set(comms.map(c => c.job_id).filter((id): id is string => !!id))
  const { data: wos } = trades.length
    ? await db.from('work_orders').select('trade_id, job_id, created_at').eq('tenant_id', tenantId).in('trade_id', trades.map(t => t.id))
        .order('created_at', { ascending: false }).limit(MAX_ROWS)
    : { data: [] }
  for (const w of wos ?? []) jobIds.add(w.job_id)
  const { data: jobs } = jobIds.size
    ? await db.from('jobs').select('id, job_number').eq('tenant_id', tenantId).in('id', [...jobIds])
    : { data: [] }
  const jobNumber = new Map((jobs ?? []).map(j => [j.id, j.job_number as string]))
  const jobsOf = (ids: (string | null)[]) => [...new Set(ids.map(id => (id ? jobNumber.get(id) : undefined)).filter((n): n is string => !!n))].slice(0, MAX_JOBS)

  // The address that's theirs on each email: the sender of what came in, the recipient of what we sent
  const addressOf = (c: CommRow) => tidy((c.direction === 'outbound' ? c.to_email : c.from_email)?.split(',')[0]?.replace(/^.*<|>.*$/g, ''))?.toLowerCase() ?? null
  const latestBody = (email: string | null) =>
    email ? comms.find(c => c.direction !== 'outbound' && addressOf(c) === email && c.body_text)?.body_text ?? null : null

  const out: ContactMatch[] = []
  const claimed = new Set<string>()
  for (const t of trades) {
    const email = tidy(t.contact_email)?.toLowerCase() ?? null
    if (email) claimed.add(email)
    const phones = [tidy(t.contact_mobile), tidy(t.contact_office)].filter((p): p is string => !!p)
    const signed = phones.length ? [] : phonesInEmail(latestBody(email), ours)
    const theirComms = comms.filter(c => email && addressOf(c) === email)
    out.push({
      name: tidy(t.business_name) ?? tidy(t.entity_name) ?? tidy(t.primary_contact) ?? 'Unnamed trade',
      contact_person: tidy(t.primary_contact),
      trade: tidy(t.primary_trade),
      phone: phones[0] ?? signed[0] ?? null,
      phone_source: phones.length ? 'trade directory' : signed.length ? 'email signature' : null,
      other_phones: phones.length ? phones.slice(1) : signed.slice(1),
      email,
      source: 'trade directory',
      jobs: jobsOf([...(wos ?? []).filter(w => w.trade_id === t.id).map(w => w.job_id), ...theirComms.map(c => c.job_id)]),
      last_email: theirComms[0]?.created_at ?? null,
      status: tidy(t.status),
      notes: tidy(t.gary_notes) ?? tidy(t.notes),
    })
  }

  // Everyone else we've emailed with, by address
  const byAddress = new Map<string, CommRow[]>()
  for (const c of comms) {
    const a = addressOf(c)
    if (!a || claimed.has(a) || ownAddresses.has(a)) continue
    // Only the person the search is about: their name or address has the words
    const nameHit = (c.contact_name ?? '').toLowerCase().includes(q.toLowerCase())
    if (!nameHit && !a.includes(q.toLowerCase())) continue
    byAddress.set(a, [...(byAddress.get(a) ?? []), c])
  }
  for (const [email, rows] of byAddress) {
    const phones = phonesInEmail(latestBody(email), ours)
    out.push({
      name: tidy(rows.find(r => r.contact_name)?.contact_name) ?? email,
      contact_person: null,
      trade: null,
      phone: phones[0] ?? null,
      phone_source: phones.length ? 'email signature' : null,
      other_phones: phones.slice(1),
      email,
      source: 'email history',
      jobs: jobsOf(rows.map(r => r.job_id)),
      last_email: rows[0].created_at,
      status: null,
      notes: null,
    })
  }

  for (const j of insuredHits.data ?? []) {
    const email = tidy(j.insured_email)?.toLowerCase() ?? null
    const same = out.find(o => (email && o.email === email) || (o.source === 'insured on a job' && o.name.toLowerCase() === (j.insured_name ?? '').toLowerCase()))
    if (same) {
      if (!same.jobs.includes(j.job_number) && same.jobs.length < MAX_JOBS) same.jobs.push(j.job_number)
      if (!same.phone && tidy(j.insured_phone)) { same.phone = tidy(j.insured_phone); same.phone_source = 'job' }
      continue
    }
    out.push({
      name: tidy(j.insured_name) ?? 'Insured',
      contact_person: null,
      trade: null,
      phone: tidy(j.insured_phone),
      phone_source: tidy(j.insured_phone) ? 'job' : null,
      other_phones: [],
      email,
      source: 'insured on a job',
      jobs: [j.job_number],
      last_email: null,
      status: null,
      notes: null,
    })
  }
  if (!out.some(o => o.phone)) {
    try {
      for (const found of await mail(q, ours, [...ownAddresses])) {
        const same = out.find(o => o.email === found.email)
        if (!same) out.push(found)
        else if (!same.phone && found.phone) Object.assign(same, { phone: found.phone, phone_source: found.phone_source, other_phones: found.other_phones })
      }
    } catch (err) {
      // The directory and email log still answer
      console.error('[contacts] mailbox search failed:', err)
    }
  }
  return out.slice(0, limit)
}
