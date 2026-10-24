import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({}) }))

import { attachJobFile, listJobAttachables, photoFilename } from '../job-files'

// A fake database: rows per table, filtered by the .eq() calls made
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const uploads: { bucket: string; path: string; size: number; contentType?: string }[] = []
  const downloads: { bucket: string; path: string }[] = []
  const from = (name: string) => {
    const filters: [string, unknown][] = []
    const rows = () => (tables[name] ?? []).filter(r => filters.every(([k, v]) => r[k] === v))
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
      order: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null }),
      then: (resolve: (r: { data: unknown[] }) => unknown) => resolve({ data: rows() }),
    }
    return chain
  }
  const storage = {
    from: (bucket: string) => ({
      download: async (path: string) => { downloads.push({ bucket, path }); return { data: new Blob(['abc']), error: null } },
      upload: async (path: string, content: Buffer, opts: { contentType?: string }) => { uploads.push({ bucket, path, size: content.length, contentType: opts.contentType }); return { error: null } },
      createSignedUrls: async (paths: string[]) => ({ data: paths.map(p => ({ path: p, signedUrl: `https://signed/${p}` })) }),
    }),
  }
  return { db: { from, storage } as never, uploads, downloads }
}

const tables = {
  job_files: [
    { id: 'f1', tenant_id: 't1', job_id: 'j1', file_name: 'Scope.pdf', description: 'From insurer', mime_type: 'application/pdf', size_bytes: 3, storage_path: 't1/j1/scope.pdf', created_at: '2026-10-01' },
    { id: 'f2', tenant_id: 't2', job_id: 'j1', file_name: 'Other.pdf', description: null, mime_type: 'application/pdf', size_bytes: 3, storage_path: 't2/x.pdf', created_at: null },
  ],
  photos: [
    { id: 'p1', tenant_id: 't1', job_id: 'j1', file_name: null, label: 'Kitchen ceiling', mime_type: 'image/png', size_bytes: 3, sequence_number: 1, storage_path: 't1/j1/p1.png' },
  ],
}

describe('photoFilename', () => {
  it('uses the file name, else the label or number with an extension', () => {
    expect(photoFilename({ file_name: 'IMG_1.jpg', label: 'x', mime_type: null, sequence_number: 1 })).toBe('IMG_1.jpg')
    expect(photoFilename({ file_name: null, label: 'Roof / gutter', mime_type: 'image/png', sequence_number: 1 })).toBe('Roof gutter.png')
    expect(photoFilename({ file_name: null, label: null, mime_type: null, sequence_number: 4 })).toBe('Photo 4.jpg')
  })
})

describe('listJobAttachables', () => {
  it("lists only the tenant's files and photos, with thumbnails", async () => {
    const { db } = fakeDb(tables)
    const out = await listJobAttachables('t1', 'j1', db)
    expect(out.files.map(f => f.id)).toEqual(['f1'])
    expect(out.photos).toEqual([{ id: 'p1', name: 'Kitchen ceiling.png', label: 'Kitchen ceiling', size: 3, thumbUrl: 'https://signed/t1/j1/p1.png' }])
  })
})

describe('attachJobFile', () => {
  it('copies a job file into the mail attachments bucket', async () => {
    const { db, uploads, downloads } = fakeDb(tables)
    const a = await attachJobFile('t1', 'j1', 'file', 'f1', db)
    expect(downloads).toEqual([{ bucket: 'job-files', path: 't1/j1/scope.pdf' }])
    expect(uploads[0]).toMatchObject({ bucket: 'mail-attachments', size: 3, contentType: 'application/pdf' })
    expect(a).toMatchObject({ kind: 'upload', filename: 'Scope.pdf', mimeType: 'application/pdf', size: 3 })
    expect((a as { path: string }).path.startsWith('t1/')).toBe(true)
  })

  it('copies a photo from the photos bucket', async () => {
    const { db, downloads } = fakeDb(tables)
    const a = await attachJobFile('t1', 'j1', 'photo', 'p1', db)
    expect(downloads).toEqual([{ bucket: 'photos', path: 't1/j1/p1.png' }])
    expect(a).toMatchObject({ filename: 'Kitchen ceiling.png', mimeType: 'image/png' })
  })

  it("won't attach another tenant's file", async () => {
    const { db, uploads } = fakeDb(tables)
    await expect(attachJobFile('t1', 'j1', 'file', 'f2', db)).rejects.toThrow('File not found on this job')
    expect(uploads).toEqual([])
  })
})
