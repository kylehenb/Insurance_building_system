import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { listJobAttachables, readJobFile, storeDraftUpload, type JobFileContent } from '@/lib/mail/job-files'
import { renderJobDocument } from '@/lib/mail/job-documents'
import { parseNumbers, resolveFileRefs, resolvePhotoRefs } from '@/lib/mail/job-refs'
import { fitAttachments, megabytes, type FittedAttachments } from '@/lib/mail/attachment-budget'
import type { DraftAttachment } from '@/lib/mail/compose-rules'
import { ComposeError } from '@/lib/mail/compose'
import { DocumentSendError, parseDocumentRef, type DocumentRef } from '@/lib/documents/send/documents'
import { PrintDataError } from '@/lib/documents/print-data'
import { downscaleImage, EMAIL_MAX_EDGE, EMAIL_QUALITY, ImageError, jpegName } from '@/lib/images/downscale'
import { renderPdfPages } from '@/lib/pdf/render-pdf-pages'
import { attachmentKind, AttachmentReadError, readAttachment } from '@/lib/attachments/read'

// A job's photos, files and documents for the voice connector: attaching
// them to emails and drafts (send_email, save_draft, reply_to_email,
// send_documents), and looking at them (get_job_photo). Photos are picked as
// people say them ("photo 2", "photos 45-47", a label) with lib/mail/job-refs,
// read with the composer's own readJobFile / renderJobDocument, and fitted
// under Gmail's limit with lib/mail/attachment-budget.

export const MAX_JOB_ATTACHMENTS = 30
const MAX_DOCUMENTS = 8
/** Most images get_job_photo returns in one call */
export const MAX_VIEW_IMAGES = 5

const strings = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
  .filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean)

/** The attach_* properties shared by the email tools' schemas */
export const ATTACH_PROPERTIES = {
  attach_photos: {
    type: 'array', items: { type: 'string' }, maxItems: MAX_JOB_ATTACHMENTS,
    description: 'Job photos: numbers from list_job_files ("2", "45-47"), a label ("floor plan"), photo_id values, or "all".',
  },
  attach_files: {
    type: 'array', items: { type: 'string' }, maxItems: MAX_JOB_ATTACHMENTS,
    description: 'Uploaded job files: file_id or file name from list_job_files.',
  },
  attach_documents: {
    type: 'array', maxItems: MAX_DOCUMENTS,
    description: 'Quotes, reports or invoices as PDFs: the "document" values from list_job_documents.',
    items: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['quote', 'report', 'invoice'] }, id: { type: 'string' } },
      required: ['kind', 'id'],
      additionalProperties: false,
    },
  },
} as const

export function hasAttachArgs(args: Record<string, unknown>): boolean {
  return strings(args.attach_photos).length > 0 || strings(args.attach_files).length > 0
    || (Array.isArray(args.attach_documents) && args.attach_documents.length > 0)
}

export interface JobAttachment extends JobFileContent {
  /** How it's read back: "photo 2 (Floor plan)", "Scope.pdf", "Quote Q-IRC1055-1" */
  label: string
}

const photoLabel = (n: number, label: string | null) => `photo ${n}${label ? ` (${label})` : ''}`

function readError(err: unknown): McpToolResult {
  if (err instanceof ComposeError || err instanceof DocumentSendError || err instanceof PrintDataError) return { text: err.message, isError: true }
  throw err
}

/**
 * The job's photos, files and documents named in attach_photos /
 * attach_files / attach_documents, read and ready to attach. Anything that
 * matches nothing is an error and nothing is read.
 */
export async function loadJobAttachments(
  args: Record<string, unknown>,
  ctx: McpContext,
  job: { id: string; job_number: string },
): Promise<JobAttachment[] | McpToolResult> {
  const photoRefs = strings(args.attach_photos)
  const fileRefs = strings(args.attach_files)
  let docRefs: DocumentRef[]
  try {
    docRefs = (Array.isArray(args.attach_documents) ? args.attach_documents : []).map(parseDocumentRef)
  } catch (err) {
    if (err instanceof DocumentSendError) return { text: `${err.message} — use list_job_documents.`, isError: true }
    throw err
  }

  const wanted: { label: string; load: () => Promise<JobFileContent> }[] = []
  if (photoRefs.length || fileRefs.length) {
    const { photos, files } = await listJobAttachables(ctx.tenantId, job.id)
    const p = resolvePhotoRefs(photos, photoRefs)
    const f = resolveFileRefs(files, fileRefs)
    const unmatched = [...p.unmatched.map(r => `photo "${r}"`), ...f.unmatched.map(r => `file "${r}"`)]
    if (unmatched.length) {
      return {
        text: `Not on ${job.job_number}: ${unmatched.join(', ')}. It has ${photos.length} photo${photos.length === 1 ? '' : 's'} and ${files.length} file${files.length === 1 ? '' : 's'} — see list_job_files.`,
        isError: true,
      }
    }
    for (const photo of p.items) {
      const n = photos.indexOf(photo) + 1
      wanted.push({ label: photoLabel(n, photo.label), load: () => readJobFile(ctx.tenantId, job.id, 'photo', photo.id) })
    }
    for (const file of f.items) wanted.push({ label: file.name, load: () => readJobFile(ctx.tenantId, job.id, 'file', file.id) })
  }
  if (wanted.length + docRefs.length > MAX_JOB_ATTACHMENTS) {
    return { text: `That's ${wanted.length + docRefs.length} attachments — at most ${MAX_JOB_ATTACHMENTS} in one email.`, isError: true }
  }

  const out: JobAttachment[] = []
  try {
    for (const w of wanted) out.push({ ...(await w.load()), label: w.label })
    // One at a time: PDFs share one headless browser
    for (const ref of docRefs) {
      const doc = await renderJobDocument(ctx.tenantId, job.id, ref)
      out.push({ filename: doc.filename, mimeType: doc.mimeType, content: doc.content, label: doc.title })
    }
  } catch (err) {
    return readError(err)
  }
  return out
}

/** A smaller JPEG copy of a photo, to fit an email */
async function compressPhoto(file: JobAttachment): Promise<JobAttachment> {
  const small = await downscaleImage(file.content, EMAIL_MAX_EDGE, EMAIL_QUALITY)
  return { ...file, filename: jpegName(file.filename), mimeType: small.mimeType, content: small.data }
}

/** Fits the attachments under Gmail's limit, compressing photos first */
export function fitJobAttachments(files: JobAttachment[], alreadyBytes = 0): Promise<FittedAttachments<JobAttachment>> {
  return fitAttachments(files, alreadyBytes, compressPhoto)
}

/** "Left out (over Gmail's 25 MB limit): photo 45 (Roof) 9.1 MB." */
export function skippedText(fit: FittedAttachments<JobAttachment>): string {
  if (!fit.skipped.length) return ''
  return `Left out (over Gmail's 25 MB limit): ${fit.skipped.map(f => `${f.label} ${megabytes(f.content.length)}`).join(', ')}.`
}

/** Copies the attachments into the draft's uploads */
export async function storeJobAttachments(ctx: McpContext, files: JobAttachment[]): Promise<DraftAttachment[]> {
  const out: DraftAttachment[] = []
  for (const f of files) out.push(await storeDraftUpload(ctx.tenantId, f))
  return out
}

// ── get_job_photo ───────────────────────────────────────────────────────────

interface ViewImage { data: string; mimeType: string }

export const getJobPhoto: McpTool = {
  name: 'get_job_photo',
  title: 'View job photo',
  description: [
    'Shows you a job\'s photos, or an uploaded image/PDF file, so you can look at them — e.g. read dimensions off a hand-drawn floor plan. Read only.',
    `Photos by number from list_job_files ("2", "45-47"), label or photo_id; files by file_id or name. At most ${MAX_VIEW_IMAGES} images per call.`,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1055.' },
      photos: { type: 'array', items: { type: 'string' }, maxItems: MAX_VIEW_IMAGES, description: 'e.g. ["2"], ["45-47"], ["floor plan"].' },
      files: { type: 'array', items: { type: 'string' }, maxItems: MAX_VIEW_IMAGES, description: 'file_id or file name (image or PDF).' },
      pages: { type: 'string', description: 'PDF pages, e.g. "1" or "2-4" (default the first pages).' },
    },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const photoRefs = strings(args.photos)
    const fileRefs = strings(args.files)
    if (!photoRefs.length && !fileRefs.length) return { text: 'Which photo? Give a number, range or label from list_job_files.', isError: true }
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job

    const { photos, files } = await listJobAttachables(ctx.tenantId, job.id)
    const p = resolvePhotoRefs(photos, photoRefs)
    const f = resolveFileRefs(files, fileRefs)
    const unmatched = [...p.unmatched.map(r => `photo "${r}"`), ...f.unmatched.map(r => `file "${r}"`)]
    if (unmatched.length) {
      return { text: `Not on ${job.job_number}: ${unmatched.join(', ')}. It has ${photos.length} photos and ${files.length} files.`, isError: true }
    }
    if (p.items.length + f.items.length > MAX_VIEW_IMAGES) {
      return { text: `That's ${p.items.length + f.items.length} — at most ${MAX_VIEW_IMAGES} per call.`, isError: true }
    }
    const pages = typeof args.pages === 'string' && args.pages.trim() ? parseNumbers(args.pages) : null
    if (typeof args.pages === 'string' && args.pages.trim() && !pages) return { text: 'pages must be like "1" or "2-4".', isError: true }

    const images: ViewImage[] = []
    const lines: string[] = []
    const shown: Record<string, unknown>[] = []
    const problems: string[] = []

    for (const photo of p.items) {
      const n = photos.indexOf(photo) + 1
      try {
        const file = await readJobFile(ctx.tenantId, job.id, 'photo', photo.id)
        const img = await downscaleImage(file.content)
        images.push({ data: img.data.toString('base64'), mimeType: img.mimeType })
        lines.push(photoLabel(n, photo.label))
        shown.push({ photo_id: photo.id, number: n, label: photo.label, width: img.width, height: img.height })
      } catch (err) {
        if (!(err instanceof ComposeError || err instanceof ImageError)) throw err
        problems.push(`${photoLabel(n, photo.label)}: ${err.message}`)
      }
    }

    for (const meta of f.items) {
      let file: JobFileContent
      try {
        file = await readJobFile(ctx.tenantId, job.id, 'file', meta.id)
      } catch (err) {
        if (!(err instanceof ComposeError)) throw err
        problems.push(`${meta.name}: ${err.message}`)
        continue
      }
      const kind = attachmentKind(file)
      if (kind === 'image') {
        try {
          const img = await downscaleImage(file.content)
          images.push({ data: img.data.toString('base64'), mimeType: img.mimeType })
          lines.push(meta.name)
          shown.push({ file_id: meta.id, name: meta.name, width: img.width, height: img.height })
        } catch (err) {
          if (!(err instanceof ImageError)) throw err
          problems.push(`${meta.name}: ${err.message}`)
        }
      } else if (kind === 'pdf') {
        const room = MAX_VIEW_IMAGES - images.length
        try {
          const rendered = await renderPdfPages(file.content, { widthPx: 1600, format: 'jpeg', quality: 0.8 })
          const wantedPages = (pages ?? rendered.map((_, i) => i + 1)).filter(n => n >= 1 && n <= rendered.length).slice(0, Math.max(0, room))
          if (!wantedPages.length) { problems.push(`${meta.name}: no such page (it has ${rendered.length})`); continue }
          for (const n of wantedPages) {
            const img = await downscaleImage(rendered[n - 1].image)
            images.push({ data: img.data.toString('base64'), mimeType: img.mimeType })
          }
          lines.push(`${meta.name} page${wantedPages.length === 1 ? '' : 's'} ${wantedPages.join(', ')} of ${rendered.length}`)
          shown.push({ file_id: meta.id, name: meta.name, pages: wantedPages, page_count: rendered.length })
        } catch (err) {
          // No page images (e.g. Chromium unavailable): its text instead
          console.error(`[mcp] get_job_photo: PDF pages failed for ${meta.name}:`, err)
          try {
            const reading = await readAttachment({ filename: file.filename, mimeType: file.mimeType, data: file.content })
            lines.push(`${meta.name} (text):\n${reading.text}`)
            shown.push({ file_id: meta.id, name: meta.name, text: true })
          } catch (readErr) {
            if (!(readErr instanceof AttachmentReadError)) throw readErr
            problems.push(`${meta.name}: ${readErr.message}`)
          }
        }
      } else {
        problems.push(`${meta.name}: not an image or PDF`)
      }
    }

    if (!images.length && !shown.length) return { text: `Couldn't show it. ${problems.join('; ')}`, isError: true }
    return {
      text: [`${job.job_number}: ${lines.join('; ')}`, ...(problems.length ? [`Couldn't show: ${problems.join('; ')}`] : [])].join('\n'),
      images,
      data: { job_number: job.job_number, shown },
    }
  },
}
