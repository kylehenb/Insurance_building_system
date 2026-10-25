import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// Job notes: internal notes that sit in the job's Comms feed (communications
// rows of type 'note'), alongside the emails, so a job's history reads in one
// place. Added from the feed's "Add note" box, by voice (add_job_note) and by
// the in-app assistant. Who wrote it goes in contact_name; how in source.
// (The free-text Notes field on the Overview tab is separate.)

export const MAX_NOTE_CHARS = 2000

export type NoteSource = 'app' | 'voice' | 'assistant'

export class JobNoteError extends Error {}

export interface JobNote {
  id: string
  content: string
  author: string | null
  source: string | null
  created_at: string | null
}

/** Tidies a note; throws JobNoteError when it's empty or too long. */
export function cleanNote(raw: unknown): string {
  const note = typeof raw === 'string' ? raw.trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : ''
  if (!note) throw new JobNoteError('What should the note say?')
  if (note.length > MAX_NOTE_CHARS) throw new JobNoteError(`That note is too long (${note.length} characters; ${MAX_NOTE_CHARS} max).`)
  return note
}

export async function addJobNote(
  supabase: SupabaseClient<Database>,
  params: { tenantId: string; userId: string | null; jobId: string; note: unknown; source: NoteSource },
): Promise<JobNote> {
  const content = cleanNote(params.note)

  const { data: job, error: jobErr } = await supabase
    .from('jobs').select('id').eq('tenant_id', params.tenantId).eq('id', params.jobId).maybeSingle()
  if (jobErr) throw jobErr
  if (!job) throw new JobNoteError('Job not found.')

  let author: string | null = null
  if (params.userId) {
    const { data: user } = await supabase
      .from('users').select('name').eq('tenant_id', params.tenantId).eq('id', params.userId).maybeSingle()
    author = user?.name?.trim() || null
  }
  const by = params.source === 'app' ? (author ?? 'Note') : `${author ?? 'Note'} (${params.source})`

  const { data, error } = await supabase
    .from('communications')
    .insert({
      tenant_id: params.tenantId,
      job_id: params.jobId,
      type: 'note',
      content,
      contact_name: by,
      source: params.source,
      created_by: params.userId,
    })
    .select('id, content, contact_name, source, created_at')
    .single()
  if (error) throw error
  return { id: data.id, content: data.content ?? content, author: data.contact_name, source: data.source, created_at: data.created_at }
}

/** The job's most recent notes, newest first. */
export async function listJobNotes(
  supabase: SupabaseClient<Database>,
  params: { tenantId: string; jobId: string; limit?: number },
): Promise<JobNote[]> {
  const { data, error } = await supabase
    .from('communications')
    .select('id, content, contact_name, source, created_at')
    .eq('tenant_id', params.tenantId).eq('job_id', params.jobId).eq('type', 'note')
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 5)
  if (error) throw error
  return (data ?? []).map(r => ({ id: r.id, content: r.content ?? '', author: r.contact_name, source: r.source, created_at: r.created_at }))
}
