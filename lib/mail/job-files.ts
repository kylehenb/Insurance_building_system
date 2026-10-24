import { randomUUID } from 'crypto'
import { ATTACHMENT_BUCKET, ComposeError } from './compose'
import { MAX_EMAIL_BYTES, type DraftAttachment } from './compose-rules'
import { mailDb } from './sync'

// A job's uploaded files (Files tab) and photos (Photos tab), to attach to the
// email being written. Attaching copies the file into the draft's uploads, so
// removing it from the email never touches the job.

const FILES_BUCKET = 'job-files'
const PHOTOS_BUCKET = 'photos'
const THUMB_SECONDS = 60 * 60

export type JobFileOption = { id: string; name: string; description: string | null; mimeType: string; size: number; createdAt: string | null }
export type JobPhotoOption = { id: string; name: string; label: string | null; size: number | null; thumbUrl: string | null }
export type JobAttachables = { files: JobFileOption[]; photos: JobPhotoOption[] }
export type JobFileSource = 'file' | 'photo'

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic' }

type PhotoRow = { id: string; file_name: string | null; label: string | null; mime_type: string | null; size_bytes: number | null; sequence_number: number | null; storage_path: string }

/** The name a photo goes out as: its own file name, else its label or number */
export function photoFilename(p: Pick<PhotoRow, 'file_name' | 'label' | 'mime_type' | 'sequence_number'>): string {
  if (p.file_name?.trim()) return p.file_name.trim()
  const ext = EXTENSIONS[p.mime_type ?? ''] ?? 'jpg'
  const base = p.label?.trim() || (p.sequence_number != null ? `Photo ${p.sequence_number}` : 'Photo')
  return `${base.replace(/[/\\:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}.${ext}`
}

export async function listJobAttachables(tenantId: string, jobId: string, db = mailDb()): Promise<JobAttachables> {
  const [files, photos] = await Promise.all([
    db.from('job_files')
      .select('id, file_name, description, mime_type, size_bytes, created_at')
      .eq('tenant_id', tenantId).eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .then(r => (r.data ?? []) as { id: string; file_name: string; description: string | null; mime_type: string; size_bytes: number; created_at: string | null }[]),
    db.from('photos')
      .select('id, file_name, label, mime_type, size_bytes, sequence_number, storage_path')
      .eq('tenant_id', tenantId).eq('job_id', jobId)
      .order('sequence_number', { ascending: true, nullsFirst: false })
      .order('uploaded_at', { ascending: true })
      .then(r => (r.data ?? []) as PhotoRow[]),
  ])

  const paths = photos.map(p => p.storage_path)
  const signed = paths.length
    ? (await db.storage.from(PHOTOS_BUCKET).createSignedUrls(paths, THUMB_SECONDS)).data ?? []
    : []
  const urlFor = new Map(signed.filter(s => s.path && s.signedUrl).map(s => [s.path!, s.signedUrl]))

  return {
    files: files.map(f => ({ id: f.id, name: f.file_name, description: f.description, mimeType: f.mime_type, size: f.size_bytes, createdAt: f.created_at })),
    photos: photos.map(p => ({ id: p.id, name: photoFilename(p), label: p.label, size: p.size_bytes, thumbUrl: urlFor.get(p.storage_path) ?? null })),
  }
}

/** Copies one of the job's files or photos into the draft's uploads */
export async function attachJobFile(tenantId: string, jobId: string, source: JobFileSource, id: string, db = mailDb()): Promise<DraftAttachment> {
  let bucket: string, storagePath: string, filename: string, mimeType: string
  if (source === 'file') {
    const { data } = await db.from('job_files').select('file_name, mime_type, storage_path')
      .eq('tenant_id', tenantId).eq('job_id', jobId).eq('id', id).maybeSingle()
    if (!data) throw new ComposeError('File not found on this job', 404)
    const f = data as { file_name: string; mime_type: string; storage_path: string }
    bucket = FILES_BUCKET; storagePath = f.storage_path; filename = f.file_name; mimeType = f.mime_type
  } else {
    const { data } = await db.from('photos').select('file_name, label, mime_type, sequence_number, storage_path')
      .eq('tenant_id', tenantId).eq('job_id', jobId).eq('id', id).maybeSingle()
    if (!data) throw new ComposeError('Photo not found on this job', 404)
    const p = data as Omit<PhotoRow, 'id' | 'size_bytes'>
    bucket = PHOTOS_BUCKET; storagePath = p.storage_path; filename = photoFilename(p); mimeType = p.mime_type || 'image/jpeg'
  }

  const { data: blob, error } = await db.storage.from(bucket).download(storagePath)
  if (error || !blob) throw new ComposeError(`Couldn't read ${filename}`, 502)
  const content = Buffer.from(await blob.arrayBuffer())
  if (content.length > MAX_EMAIL_BYTES) throw new ComposeError(`${filename} is over Gmail's 25 MB limit`, 413)

  const path = `${tenantId}/${randomUUID()}/${filename.replace(/[/\\]/g, '_')}`
  const { error: upErr } = await db.storage.from(ATTACHMENT_BUCKET).upload(path, content, { contentType: mimeType, upsert: false })
  if (upErr) throw new ComposeError(`Couldn't attach ${filename}`, 502)
  return { kind: 'upload', path, filename, mimeType, size: content.length }
}
