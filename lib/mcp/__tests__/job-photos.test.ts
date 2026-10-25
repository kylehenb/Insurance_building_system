import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { fakeSupabase, type Row } from './fake-supabase'

// A job's photos and files by voice, with IRC1055 (65 photos, 1 file) as the
// job: looking at a photo (get_job_photo), picking photos as people say them,
// and attaching photos, files and documents to send_email, save_draft,
// reply_to_email and send_documents within Gmail's 25 MB.

const JOB = { id: 'j1055', job_number: 'IRC1055' }
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const FILE_ID = 'f0000000-0000-4000-8000-000000000001'
const LABELS: Record<number, string> = { 1: 'Front elevation', 2: 'Floor plan', 45: 'Roof', 46: 'Roof', 47: 'Roof valley' }
const PHOTOS = Array.from({ length: 65 }, (_, i) => ({
  id: pid(i + 1), name: `IMG_${1000 + i}.jpg`, label: LABELS[i + 1] ?? null, size: 3_000_000, thumbUrl: null,
}))
const FILES = [{ id: FILE_ID, name: 'Insurer scope.pdf', description: 'Scope of works', mimeType: 'application/pdf', size: 40_000, createdAt: '2026-10-20' }]

// A big phone photo (4000×3000) — real image data, so the downscale runs for real
const bigPhoto = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#d0c8b0' } })
  .composite([{ input: Buffer.from('<svg width="4000" height="3000"><text x="200" y="400" font-size="200">4.2m x 3.6m</text></svg>'), top: 0, left: 0 }])
  .jpeg({ quality: 95 }).toBuffer()
const PDF = Buffer.from('%PDF-1.4 scope')
/** Photo content sizes by number, to push an email over the limit */
let photoBytes: Record<number, number> = {}

const calls: Record<string, unknown[][]> = {}
const spy = <T>(name: string, impl: (...a: unknown[]) => T) => vi.fn(async (...a: unknown[]) => { (calls[name] ??= []).push(a); return impl(...a) })

vi.mock('@/lib/mail/job-files', () => ({
  listJobAttachables: spy('listJobAttachables', () => ({ photos: PHOTOS, files: FILES })),
  readJobFile: spy('readJobFile', (_t, _j, source, id) => {
    if (source === 'file') return { filename: 'Insurer scope.pdf', mimeType: 'application/pdf', content: PDF }
    const n = PHOTOS.findIndex(p => p.id === id) + 1
    return { filename: PHOTOS[n - 1].name, mimeType: 'image/jpeg', content: photoBytes[n] ? Buffer.alloc(photoBytes[n], 1) : bigPhoto }
  }),
  storeDraftUpload: spy('storeDraftUpload', (_t, f) => {
    const file = f as { filename: string; mimeType: string; content: Buffer }
    return { kind: 'upload', path: `t1/u/${file.filename}`, filename: file.filename, mimeType: file.mimeType, size: file.content.length }
  }),
}))
vi.mock('@/lib/mail/job-documents', () => ({
  renderJobDocument: spy('renderJobDocument', (_t, _j, ref) => ({ filename: 'Quote Q-IRC1055-1.pdf', mimeType: 'application/pdf', content: PDF, title: `Quote ${(ref as { id: string }).id}`, warnings: [] })),
}))
vi.mock('@/lib/pdf/render-pdf-pages', () => ({
  renderPdfPages: spy('renderPdfPages', () => [1, 2, 3].map(() => ({ widthPt: 595, heightPt: 842, image: bigPhoto, contentType: 'image/jpeg' }))),
}))
vi.mock('@/lib/mcp/tools/excess', () => ({
  isToolResult: (v: unknown) => !!v && typeof v === 'object' && 'text' in v,
  jobFromArgs: async (args: { job_number?: string }) =>
    String(args.job_number).toUpperCase() === 'IRC1055' ? JOB : { text: `No job ${args.job_number} found.`, isError: true },
}))

const mailbox = { id: 'mb1', tenant_id: 't1', email_address: 'office@insurancerepairco.com.au' }
vi.mock('@/lib/mail/sync', () => ({ getMailbox: async () => mailbox }))
vi.mock('@/lib/mail/list', () => ({ getThreadDetail: async () => null, listFolder: async () => ({ threads: [] }), searchFolder: async () => ({ threads: [] }) }))
let openedDraft: Record<string, unknown> = {}
vi.mock('@/lib/mail/compose', async () => {
  const { emptyCompose } = await import('@/lib/mail/compose-rules')
  class ComposeError extends Error {}
  return {
    ComposeError,
    startCompose: spy('startCompose', (_m, mode, _id, jobId) => ({ ...emptyCompose(), mode, jobId, subject: jobId ? 'IRC1055 - 12 Smith St' : '', quoteHtml: '' })),
    openDraft: spy('openDraft', () => ({ ...emptyCompose(), quoteHtml: '', ...openedDraft })),
    saveDraft: spy('saveDraft', (_m, _t, _u, state) => ({ draftId: (state as { draftId: string | null }).draftId ?? 'r-1', threadId: 'th9', messageId: 'm9' })),
    sendDraft: spy('sendDraft', () => ({ messageId: 's1', threadId: 'th9' })),
  }
})
vi.mock('@/lib/communications/reply', () => {
  class ReplyError extends Error {}
  return { ReplyError, replyToEmail: spy('replyToEmail', () => ({ to: 'casey@insurer.com', subject: 'Re: IRC1055 plans', jobId: 'j1055' })) }
})
vi.mock('@/lib/documents/send/email', () => ({
  listJobDocuments: async () => [],
  buildDocumentEmailDraft: async () => ({ to: 'claims@insurer.com', cc: '', subject: 'Quote', bodyText: '', attachments: [{ ref: { kind: 'quote', id: QUOTE_ID }, title: 'Quote Q-IRC1055-1', filename: 'Quote Q-IRC1055-1.pdf' }], warnings: [], otherDocuments: [], audience: 'insurer', templateName: 'Quote' }),
  sendDocumentEmail: spy('sendDocumentEmail', () => ({ communicationId: 'c1', statusChanges: [] })),
}))

const QUOTE_ID = 'a0000000-0000-4000-8000-000000000001'
const EMAIL_ID = 'e0000000-0000-4000-8000-000000000001'
let db: Record<string, Row[]>
const ctx = () => ({ supabase: fakeSupabase(db) as never, tenantId: 't1', userId: 'u1' })

const { getJobPhoto, fitJobAttachments } = await import('../tools/job-attachments')
const { sendEmailTool, saveDraftTool } = await import('../tools/mailbox')
const { replyToEmailTool } = await import('../tools/emails')
const { sendDocuments } = await import('../tools/documents')
const { resolvePhotoRefs, resolveFileRefs, parseNumbers } = await import('@/lib/mail/job-refs')
const { handleMcpMessage } = await import('../server')

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k]
  photoBytes = {}
  openedDraft = {}
  db = {
    jobs: [{ id: 'j1055', tenant_id: 't1', job_number: 'IRC1055' }],
    communications: [{
      id: EMAIL_ID, tenant_id: 't1', type: 'email', direction: 'inbound', job_id: 'j1055', thread_id: 'th1',
      from_email: 'casey@insurer.com', subject: 'IRC1055 plans', created_at: '2026-10-24T01:00:00.000Z',
    }],
    quotes: [{ id: QUOTE_ID, tenant_id: 't1', job_id: 'j1055' }],
  }
})

describe('photo references', () => {
  it('reads numbers, ranges and lists as people say them', () => {
    expect(parseNumbers('photo 2')).toEqual([2])
    expect(parseNumbers('photos 45-47')).toEqual([45, 46, 47])
    expect(parseNumbers('45 to 47')).toEqual([45, 46, 47])
    expect(parseNumbers('2, 5 and 7')).toEqual([2, 5, 7])
    expect(parseNumbers('#3')).toEqual([3])
    expect(parseNumbers('floor plan')).toBeNull()
  })

  it('finds IRC1055 photos by number, range, label, id or all', () => {
    const pick = (...refs: string[]) => resolvePhotoRefs(PHOTOS, refs)
    expect(pick('photo 2').items.map(p => p.label)).toEqual(['Floor plan'])
    expect(pick('photos 45-47').items.map(p => p.id)).toEqual([pid(45), pid(46), pid(47)])
    expect(pick('the floor plan').items.map(p => p.id)).toEqual([pid(2)])
    // "roof" exactly is photos 45 and 46; "valley" only matches part of a label
    expect(pick('roof').items.map(p => p.id)).toEqual([pid(45), pid(46)])
    expect(pick('valley').items.map(p => p.id)).toEqual([pid(47)])
    expect(pick(pid(10), 'IMG_1010').items.map(p => p.id)).toEqual([pid(10), pid(11)])
    expect(pick('all').items).toHaveLength(65)
    expect(pick('2', 'photo 2').items).toHaveLength(1)
  })

  it('reports what matches nothing', () => {
    expect(resolvePhotoRefs(PHOTOS, ['photo 66', 'photos 64-70', 'garage']).unmatched).toEqual(['photo 66', 'photos 64-70', 'garage'])
    expect(resolvePhotoRefs([], ['all']).unmatched).toEqual(['all'])
    expect(resolveFileRefs(FILES, ['insurer scope', 'scope of works', FILE_ID]).items).toHaveLength(1)
    expect(resolveFileRefs(FILES, ['invoice.pdf']).unmatched).toEqual(['invoice.pdf'])
  })
})

describe('get_job_photo', () => {
  it('returns IRC1055 photo 2 as a downscaled JPEG image', async () => {
    const out = await getJobPhoto.run({ job_number: 'IRC1055', photos: ['photo 2'] }, ctx())
    expect(out.isError).toBeFalsy()
    expect(out.text).toBe('IRC1055: photo 2 (Floor plan)')
    expect(out.images).toHaveLength(1)
    const img = out.images![0]
    expect(img.mimeType).toBe('image/jpeg')
    const meta = await sharp(Buffer.from(img.data, 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([1600, 1200])
    expect(Buffer.from(img.data, 'base64').length).toBeLessThan(bigPhoto.length)
    expect(out.data).toEqual({ job_number: 'IRC1055', shown: [{ photo_id: pid(2), number: 2, label: 'Floor plan', width: 1600, height: 1200 }] })
  })

  it('takes a range, but at most 5 per call', async () => {
    expect((await getJobPhoto.run({ job_number: 'IRC1055', photos: ['45-47'] }, ctx())).images).toHaveLength(3)
    const tooMany = await getJobPhoto.run({ job_number: 'IRC1055', photos: ['1-6'] }, ctx())
    expect(tooMany).toMatchObject({ isError: true, text: 'That\'s 6 — at most 5 per call.' })
  })

  it('shows a PDF file\'s pages as images', async () => {
    const out = await getJobPhoto.run({ job_number: 'IRC1055', files: ['Insurer scope.pdf'], pages: '2' }, ctx())
    expect(out.text).toBe('IRC1055: Insurer scope.pdf page 2 of 3')
    expect(out.images).toHaveLength(1)
  })

  it('says what isn\'t on the job', async () => {
    const out = await getJobPhoto.run({ job_number: 'IRC1055', photos: ['photo 99'] }, ctx())
    expect(out).toMatchObject({ isError: true, text: 'Not on IRC1055: photo "photo 99". It has 65 photos and 1 files.' })
    expect((await getJobPhoto.run({ job_number: 'IRC1055' }, ctx())).isError).toBe(true)
  })

  it('is read only and needs no permission', () => {
    expect(getJobPhoto.annotations.readOnlyHint).toBe(true)
    expect(getJobPhoto.permission).toBeUndefined()
  })

  it('goes out as MCP image content', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_job_photo', arguments: { job_number: 'IRC1055', photos: ['2'] } } }, [getJobPhoto], ctx()) as { result: { content: { type: string; mimeType?: string }[] } }
    expect(res.result.content.map(c => c.type)).toEqual(['text', 'image', 'text'])
    expect(res.result.content[1].mimeType).toBe('image/jpeg')
  })
})

describe('send_email attachments', () => {
  it('attaches photos by number and range, the file and a quote PDF', async () => {
    const out = await sendEmailTool.run({
      to: 'bob@trade.com', subject: 'Plans', body: 'Hi Bob', job_number: 'IRC1055',
      attach_photos: ['photo 2', 'photos 45-47'], attach_files: ['Insurer scope'], attach_documents: [{ kind: 'quote', id: QUOTE_ID }],
    }, ctx())
    expect(out.text).toBe('Sent "Plans" to bob@trade.com with 6 attachments.')
    expect(calls.readJobFile.map(c => c[3])).toEqual([pid(2), pid(45), pid(46), pid(47), FILE_ID])
    expect(calls.renderJobDocument[0].slice(1, 3)).toEqual(['j1055', { kind: 'quote', id: QUOTE_ID }])
  })

  it('compresses photos to get under 25 MB', async () => {
    photoBytes = { 45: 10_000_000, 46: 10_000_000 }
    const fit = await fitJobAttachments([
      { filename: 'IMG_1044.jpg', mimeType: 'image/jpeg', content: bigPhoto, label: 'photo 45' },
      { filename: 'big.jpg', mimeType: 'image/jpeg', content: Buffer.concat([bigPhoto, Buffer.alloc(19_000_000)]), label: 'photo 46' },
    ])
    expect(fit.compressed).toEqual(['big.jpg'])
    expect(fit.skipped).toEqual([])
  })

  it('refuses to send when something won\'t fit, naming it', async () => {
    // 10 MB each and not compressible (not real image data): the second can't fit
    photoBytes = { 45: 10_000_000, 46: 10_000_000 }
    const out = await sendEmailTool.run({ to: 'bob@trade.com', subject: 'Roof', body: 'Hi', job_number: 'IRC1055', attach_photos: ['45-46'] }, ctx())
    expect(out).toEqual({ text: 'Not sent. Left out (over Gmail\'s 25 MB limit): photo 46 (Roof) 9.5 MB. Send them in a second email.', isError: true })
    expect(calls.saveDraft).toBeUndefined()
    expect(calls.storeDraftUpload).toBeUndefined()
  })

  it('refuses photos that aren\'t on the job before doing anything', async () => {
    const out = await sendEmailTool.run({ to: 'bob@trade.com', subject: 'x', body: 'Hi', job_number: 'IRC1055', attach_photos: ['photo 70'] }, ctx())
    expect(out).toMatchObject({ isError: true })
    expect(out.text).toMatch(/^Not on IRC1055: photo "photo 70". It has 65 photos and 1 file/)
    expect(calls.saveDraft).toBeUndefined()
  })
})

describe('save_draft', () => {
  it('creates a draft with the floor plan attached and sends nothing', async () => {
    const out = await saveDraftTool.run({ to: 'casey@insurer.com', body: 'Floor plan attached', job_number: 'IRC1055', attach_photos: ['floor plan'] }, ctx())
    expect(out.text).toBe('Draft saved: "IRC1055 - 12 Smith St" to casey@insurer.com, attached IMG_1001.jpg.')
    expect(calls.sendDraft).toBeUndefined()
    expect(out.data).toMatchObject({ draft_id: 'r-1', attachments: ['IMG_1001.jpg'] })
  })

  it('editing keeps the draft\'s attachments (Gmail replaces them on save) and adds new ones', async () => {
    openedDraft = {
      draftId: 'r-7', to: 'casey@insurer.com', subject: 'IRC1055 plans', body: '<p>old</p>', jobId: 'j1055',
      attachments: [{ kind: 'upload', path: 't1/u/IMG_1001.jpg', filename: 'IMG_1001.jpg', mimeType: 'image/jpeg', size: 500 }],
    }
    const out = await saveDraftTool.run({ draft_id: 'r-7', attach_photos: ['45-46'] }, ctx())
    const state = calls.saveDraft[0][3] as { draftId: string; body: string; attachments: { filename: string }[] }
    expect(state.draftId).toBe('r-7')
    expect(state.body).toBe('<p>old</p>')
    expect(state.attachments.map(a => a.filename)).toEqual(['IMG_1001.jpg', 'IMG_1044.jpg', 'IMG_1045.jpg'])
    expect(out.text).toBe('Draft updated: "IRC1055 plans" to casey@insurer.com, attached IMG_1001.jpg, IMG_1044.jpg, IMG_1045.jpg.')
  })

  it('takes attachments off by name', async () => {
    openedDraft = {
      draftId: 'r-7', to: 'casey@insurer.com', subject: 'x', jobId: 'j1055',
      attachments: [
        { kind: 'upload', path: 'p1', filename: 'IMG_1001.jpg', mimeType: 'image/jpeg', size: 5 },
        { kind: 'upload', path: 'p2', filename: 'Insurer scope.pdf', mimeType: 'application/pdf', size: 5 },
      ],
    }
    await saveDraftTool.run({ draft_id: 'r-7', remove_attachments: ['insurer scope'] }, ctx())
    expect((calls.saveDraft[0][3] as { attachments: { filename: string }[] }).attachments.map(a => a.filename)).toEqual(['IMG_1001.jpg'])
    expect((await saveDraftTool.run({ draft_id: 'r-7', remove_attachments: ['invoice'] }, ctx())).isError).toBe(true)
  })

  it('keeps what fits and lists what was left out', async () => {
    photoBytes = { 45: 10_000_000, 46: 10_000_000 }
    const out = await saveDraftTool.run({ to: 'a@b.com', body: 'x', job_number: 'IRC1055', attach_photos: ['45', '46'] }, ctx())
    expect(out.text).toBe('Draft saved: "IRC1055 - 12 Smith St" to a@b.com, attached IMG_1044.jpg. Left out (over Gmail\'s 25 MB limit): photo 46 (Roof) 9.5 MB.')
    expect(out.isError).toBeFalsy()
  })

  it('runs at "needs approval" — a draft sends nothing', () => {
    expect(saveDraftTool).toMatchObject({ permission: 'mail.send', runsAtApproval: true })
    expect(saveDraftTool.annotations.destructiveHint).toBe(false)
  })
})

describe('reply_to_email attachments', () => {
  it('attaches photos from the email\'s job', async () => {
    const out = await replyToEmailTool.run({ email_id: EMAIL_ID, body: 'Plan attached', attach_photos: ['photo 2'] }, ctx())
    expect(out.text).toBe('Replied to casey@insurer.com: "Re: IRC1055 plans", attached IMG_1001.jpg.')
    const sent = calls.replyToEmail[0][4] as { filename: string }[]
    expect(sent.map(f => f.filename)).toEqual(['IMG_1001.jpg'])
  })

  it('needs a job when the email isn\'t on one', async () => {
    db.communications[0].job_id = null
    const out = await replyToEmailTool.run({ email_id: EMAIL_ID, body: 'x', attach_photos: ['2'] }, ctx())
    expect(out.text).toMatch(/Which job/)
    expect(calls.replyToEmail).toBeUndefined()
  })
})

describe('send_documents attachments', () => {
  it('adds the job\'s photos and file alongside the PDFs', async () => {
    const out = await sendDocuments.run({ documents: [{ kind: 'quote', id: QUOTE_ID }], attach_photos: ['photo 2'], attach_files: [FILE_ID] }, ctx())
    expect(out.text).toBe('Emailed Quote Q-IRC1055-1, photo 2 (Floor plan), Insurer scope.pdf to claims@insurer.com.')
    const overrides = calls.sendDocumentEmail[0][2] as { extraAttachments: { filename: string }[] }
    expect(overrides.extraAttachments.map(f => f.filename)).toEqual(['IMG_1001.jpg', 'Insurer scope.pdf'])
  })
})
