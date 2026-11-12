import type { EmailAttachment } from '@/lib/email/build-raw'
import { ATTACHMENT_BUCKET } from '@/lib/mail/compose'
import { readJobFile } from '@/lib/mail/job-files'
import { mailDb } from '@/lib/mail/sync'

// Extra files added to a document or work order email in Customise send: the
// job's own files and photos (Files and Photos tabs), or a file uploaded from
// the computer (kept in the mail-attachments bucket, as the Mail page does).
// The request carries only references, so an email waiting for approval
// stores no file contents; they're read when the email is sent.

export type ExtraFileRef =
  | { source: 'file' | 'photo'; id: string }
  | { source: 'upload'; path: string; filename: string; mimeType: string }

export class ExtraFileError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 502) {
    super(message)
    this.name = 'ExtraFileError'
  }
}

export const MAX_EXTRA_FILES = 20

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/

const cleanFilename = (name: string) => name.replace(/[/\\\r\n"]/g, '_').trim().slice(0, 200)

/** The extra files from a request body. Uploads must be this tenant's. */
export function parseExtraFiles(raw: unknown, tenantId: string): ExtraFileRef[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ExtraFileError('files must be a list', 400)
  if (raw.length > MAX_EXTRA_FILES) throw new ExtraFileError(`Attach at most ${MAX_EXTRA_FILES} extra files to one email`, 400)
  const seen = new Set<string>()
  const out: ExtraFileRef[] = []
  for (const item of raw) {
    const f = (item ?? {}) as Record<string, unknown>
    let ref: ExtraFileRef
    if ((f.source === 'file' || f.source === 'photo') && typeof f.id === 'string' && UUID_RE.test(f.id)) {
      ref = { source: f.source, id: f.id }
    } else if (f.source === 'upload' && typeof f.path === 'string' && typeof f.filename === 'string') {
      const path = f.path
      if (!path.startsWith(`${tenantId}/`) || path.includes('..')) throw new ExtraFileError('That upload is not available', 400)
      const filename = cleanFilename(f.filename)
      if (!filename) throw new ExtraFileError('An uploaded file has no name', 400)
      const mimeType = typeof f.mimeType === 'string' && MIME_RE.test(f.mimeType) ? f.mimeType : 'application/octet-stream'
      ref = { source: 'upload', path, filename, mimeType }
    } else {
      throw new ExtraFileError('An attached file is not valid', 400)
    }
    const key = ref.source === 'upload' ? `upload:${ref.path}` : `${ref.source}:${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

/** Reads each extra file, in order. Job files and photos must be on jobId. */
export async function loadExtraFiles(
  refs: ExtraFileRef[] | undefined,
  tenantId: string,
  jobId: string,
  database?: ReturnType<typeof mailDb>,
): Promise<EmailAttachment[]> {
  const out: EmailAttachment[] = []
  if (!refs?.length) return out
  const db = database ?? mailDb()
  for (const ref of refs) {
    if (ref.source === 'upload') {
      if (!ref.path.startsWith(`${tenantId}/`)) throw new ExtraFileError('That upload is not available', 400)
      const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).download(ref.path)
      if (error || !data) throw new ExtraFileError(`Couldn't read ${ref.filename} — attach it again`, 502)
      out.push({ filename: ref.filename, mimeType: ref.mimeType, content: Buffer.from(await data.arrayBuffer()) })
    } else {
      try {
        const f = await readJobFile(tenantId, jobId, ref.source, ref.id, db)
        out.push({ filename: f.filename, mimeType: f.mimeType, content: f.content })
      } catch (err) {
        const status = (err as { status?: number }).status
        throw new ExtraFileError(err instanceof Error ? err.message : 'Could not read a job file', status === 404 ? 404 : 502)
      }
    }
  }
  return out
}

/** "3 extra files" for approval summaries */
export function extraFilesPhrase(refs: ExtraFileRef[] | undefined): string {
  const n = refs?.length ?? 0
  return n ? `, with ${n} extra file${n === 1 ? '' : 's'}` : ''
}
