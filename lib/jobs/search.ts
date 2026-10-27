import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { STAGE_CONFIG } from '@/lib/jobs/stageConfig'
import type { JobStageKey } from '@/lib/jobs/getJobStage'

// Finding a job from what someone remembers about it: part of the street or
// suburb, the insured's or the client's name, the claim number or the job
// number. Every word has to match one of those (so "Leighton Mundaring"
// finds the job on Leighton Rd in Mundaring). Used by the voice connector's
// find_job.

type Client = SupabaseClient<Database>

export interface JobMatch {
  id: string
  job_number: string
  property_address: string | null
  insured_name: string | null
  client_name: string | null
  insurer: string | null
  claim_number: string | null
  stage: string | null
  /** What the words matched: address, insured, client, claim, job number… */
  matched_on: string[]
  created_at: string | null
}

const JOB_COLUMNS = 'id, job_number, property_address, insured_name, insurer, claim_number, adjuster_reference, client_id, current_stage, override_stage, created_at, contacts'
/** Columns a word is looked up in, with what to call a hit */
const FIELDS: [column: string, label: string][] = [
  ['job_number', 'job number'],
  ['property_address', 'address'],
  ['insured_name', 'insured'],
  ['claim_number', 'claim'],
  ['insurer', 'insurer'],
  ['adjuster_reference', 'adjuster ref'],
]
/** Reference numbers people say without their punctuation */
const NUMBER_FIELDS = ['job_number', 'claim_number', 'adjuster_reference']
const STOP_WORDS = new Set(['the', 'job', 'at', 'in', 'on', 'for', 'of', 'and', 'a', 'claim', 'number', 'irc'])
const CANDIDATES_PER_FIELD = 50
const DEFAULT_LIMIT = 8

/** ilike treats % and _ as wildcards */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, m => `\\${m}`)
const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

type Row = {
  id: string; job_number: string; property_address: string | null; insured_name: string | null; insurer: string | null
  claim_number: string | null; adjuster_reference: string | null; client_id: string | null; current_stage: string | null
  override_stage: string | null; created_at: string | null; contacts: unknown
}

/** The words to match: "IRC 1053" stays one job number */
export function searchWords(query: string): string[] {
  const q = query.trim().replace(/\birc[\s-]*(\d+)/gi, 'IRC$1')
  return [...new Set(q.split(/[\s,]+/).map(w => w.replace(/^[^\w]+|[^\w]+$/g, '')).filter(w => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase())))]
}

function contactNames(contacts: unknown): string {
  if (!Array.isArray(contacts)) return ''
  return contacts.map(c => (c && typeof c === 'object' ? String((c as Record<string, unknown>).name ?? '') : '')).join(' ')
}

export async function searchJobs(db: Client, tenantId: string, query: string, { limit = DEFAULT_LIMIT } = {}): Promise<{ matches: JobMatch[]; total: number }> {
  const words = searchWords(query)
  if (!words.length) return { matches: [], total: 0 }
  // Candidates from the most telling word (the longest); every word is checked below
  const lead = [...words].sort((a, b) => b.length - a.length)[0]
  const pattern = `%${escapeLike(lead)}%`

  const { data: clientHits } = await db.from('clients').select('id').eq('tenant_id', tenantId).ilike('name', pattern).limit(CANDIDATES_PER_FIELD)
  const clientIds = (clientHits ?? []).map(c => c.id)
  // A claim or job number said without its dashes or spaces: "CL0098812" finds "CL-0098812"
  const loose = /\d/.test(lead) && squash(lead).length >= 4 ? `%${squash(lead).split('').join('%')}%` : null
  const results = await Promise.all([
    ...FIELDS.map(([col]) => db.from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId).ilike(col, pattern).limit(CANDIDATES_PER_FIELD)),
    ...(loose ? NUMBER_FIELDS.map(col => db.from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId).ilike(col, loose).limit(CANDIDATES_PER_FIELD)) : []),
    clientIds.length ? db.from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId).in('client_id', clientIds).limit(CANDIDATES_PER_FIELD) : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of results) if (r.error) throw r.error
  const byId = new Map<string, Row>()
  for (const r of results) for (const row of (r.data ?? []) as unknown as Row[]) byId.set(row.id, row)
  if (!byId.size) return { matches: [], total: 0 }

  const allClientIds = [...new Set([...byId.values()].map(j => j.client_id).filter((id): id is string => !!id))]
  const { data: clients } = allClientIds.length
    ? await db.from('clients').select('id, name').eq('tenant_id', tenantId).in('id', allClientIds)
    : { data: [] }
  const clientName = new Map((clients ?? []).map(c => [c.id, c.name as string | null]))

  const scored: (JobMatch & { score: number })[] = []
  for (const job of byId.values()) {
    const fields: [string, string][] = [
      ...FIELDS.map(([col, label]) => [label, String((job as Record<string, unknown>)[col] ?? '')] as [string, string]),
      ['client', job.client_id ? clientName.get(job.client_id) ?? '' : ''],
      ['contact', contactNames(job.contacts)],
    ]
    const matched = new Set<string>()
    let score = 0
    let all = true
    for (const w of words) {
      const lw = w.toLowerCase()
      const hit = fields.filter(([, v]) => v.toLowerCase().includes(lw) || (squash(w).length >= 3 && squash(v).includes(squash(w))))
      if (!hit.length) { all = false; break }
      hit.forEach(([label]) => matched.add(label))
      // An exact job or claim number beats a word in an address
      if (hit.some(([label, v]) => (label === 'job number' || label === 'claim') && squash(v) === squash(w))) score += 10
      score += 1
    }
    if (!all) continue
    const stageKey = (job.override_stage || job.current_stage) as JobStageKey | null
    scored.push({
      id: job.id,
      job_number: job.job_number,
      property_address: job.property_address,
      insured_name: job.insured_name,
      client_name: job.client_id ? clientName.get(job.client_id) ?? null : null,
      insurer: job.insurer,
      claim_number: job.claim_number,
      stage: stageKey ? STAGE_CONFIG[stageKey]?.label ?? stageKey : null,
      matched_on: [...matched],
      created_at: job.created_at,
      score,
    })
  }
  scored.sort((a, b) => b.score - a.score || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  return { matches: scored.slice(0, limit).map(({ score: _s, ...m }) => m), total: scored.length }
}
