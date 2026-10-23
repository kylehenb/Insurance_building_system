import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { JobContact } from '@/lib/types/contacts'
import { fetchJobContext } from '@/lib/jobs/fetchJobContext'
import { getJobStage } from '@/lib/jobs/getJobStage'
import { listJobDocuments } from '@/lib/documents/send/email'
import type { DocumentRef } from '@/lib/documents/send/documents'
import { mailDb } from './sync'

// The job beside a conversation on the Mail page: who and where, its stage
// and next step (the app's own getJobStage), who to email about it, and its
// documents to attach.

export type JobContactOption = { label: string; name: string; email: string }

export type JobPanel = {
  id: string
  job_number: string
  insured_name: string | null
  insured_phone: string | null
  property_address: string | null
  claim_number: string | null
  insurer: string | null
  stage: { label: string; description: string; next: string | null; warning: string | null } | null
  contacts: JobContactOption[]
  documents: { ref: DocumentRef; title: string }[]
}

export type JobHit = { id: string; job_number: string; insured_name: string | null; property_address: string | null; claim_number: string | null }

const CONTACT_LABELS: Record<string, string> = {
  tenant: 'Tenant', real_estate: 'Real estate', property_manager: 'Property manager', broker: 'Broker', owner: 'Owner', other: 'Contact',
}

/** Everyone to email about a job: insured, the order's sender, the insurer and adjuster inboxes, other contacts */
export function jobContacts(job: {
  insured_name: string | null
  insured_email: string | null
  order_sender_name: string | null
  order_sender_email: string | null
  contacts: unknown
}, client: { name: string; submission_email: string | null; adjuster_submission_email: string | null } | null): JobContactOption[] {
  const out: JobContactOption[] = []
  const add = (label: string, name: string | null | undefined, email: string | null | undefined) => {
    const e = email?.trim()
    if (!e || out.some(o => o.email.toLowerCase() === e.toLowerCase())) return
    out.push({ label, name: name?.trim() ?? '', email: e })
  }
  add('Insured', job.insured_name, job.insured_email)
  add('Order sender', job.order_sender_name, job.order_sender_email)
  if (client) {
    add('Insurer inbox', client.name, client.submission_email)
    add('Adjuster inbox', client.name, client.adjuster_submission_email)
  }
  for (const c of Array.isArray(job.contacts) ? (job.contacts as JobContact[]) : []) {
    add(c.slot === 'insured' ? 'Insured' : CONTACT_LABELS[c.type ?? 'other'] ?? 'Contact', c.name, c.email)
  }
  return out
}

export async function jobPanel(tenantId: string, jobId: string, db = mailDb()): Promise<JobPanel | null> {
  const { data: job } = await db
    .from('jobs')
    .select('id, job_number, insured_name, insured_phone, insured_email, property_address, claim_number, insurer, client_id, order_sender_name, order_sender_email, contacts')
    .eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
  if (!job) return null
  const j = job as JobPanel & { insured_email: string | null; client_id: string | null; order_sender_name: string | null; order_sender_email: string | null; contacts: unknown }

  const typed = db as unknown as SupabaseClient<Database>
  const [client, stage, documents] = await Promise.all([
    j.client_id
      ? db.from('clients').select('name, submission_email, adjuster_submission_email').eq('tenant_id', tenantId).eq('id', j.client_id).maybeSingle().then(r => r.data)
      : Promise.resolve(null),
    fetchJobContext(jobId, typed).then(getJobStage).catch(err => { console.error('[mail] job stage failed:', err); return null }),
    listJobDocuments({ supabase: typed, tenantId }, jobId).catch(() => []),
  ])

  return {
    id: j.id,
    job_number: j.job_number,
    insured_name: j.insured_name,
    insured_phone: j.insured_phone,
    property_address: j.property_address,
    claim_number: j.claim_number,
    insurer: j.insurer,
    stage: stage ? {
      label: stage.label,
      description: stage.description,
      next: stage.primaryAction?.label ?? null,
      warning: stage.contextualWarning?.message ?? null,
    } : null,
    contacts: jobContacts(j, client as { name: string; submission_email: string | null; adjuster_submission_email: string | null } | null),
    documents: documents.map(d => ({ ref: d.ref, title: d.title })),
  }
}

/** Jobs matching a job number, claim number, insured name or address */
export async function searchJobs(tenantId: string, q: string, db = mailDb()): Promise<JobHit[]> {
  const term = q.trim().replace(/[%_,()]/g, '')
  if (term.length < 2) return []
  const { data } = await db
    .from('jobs')
    .select('id, job_number, insured_name, property_address, claim_number')
    .eq('tenant_id', tenantId)
    .or(`job_number.ilike.%${term}%,claim_number.ilike.%${term}%,insured_name.ilike.%${term}%,property_address.ilike.%${term}%`)
    .order('created_at', { ascending: false })
    .limit(8)
  return (data as JobHit[] | null) ?? []
}
