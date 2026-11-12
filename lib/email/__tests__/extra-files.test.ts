import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({}) }))

import { ExtraFileError, extraFilesPhrase, loadExtraFiles, parseExtraFiles } from '../extra-files'

const F1 = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const downloads: { bucket: string; path: string }[] = []
  const from = (name: string) => {
    const filters: [string, unknown][] = []
    const rows = () => (tables[name] ?? []).filter(r => filters.every(([k, v]) => r[k] === v))
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
      maybeSingle: async () => ({ data: rows()[0] ?? null }),
    }
    return chain
  }
  const storage = {
    from: (bucket: string) => ({
      download: async (path: string) => { downloads.push({ bucket, path }); return { data: new Blob([`${bucket}:${path}`]), error: null } },
    }),
  }
  return { db: { from, storage } as never, downloads }
}

describe('parseExtraFiles', () => {
  it("takes job files, photos and this tenant's uploads, once each", () => {
    expect(parseExtraFiles([
      { source: 'file', id: F1 },
      { source: 'photo', id: P1 },
      { source: 'file', id: F1 },
      { source: 'upload', path: 't1/abc/Plan.pdf', filename: 'Plan "v2".pdf', mimeType: 'application/pdf' },
    ], 't1')).toEqual([
      { source: 'file', id: F1 },
      { source: 'photo', id: P1 },
      { source: 'upload', path: 't1/abc/Plan.pdf', filename: 'Plan _v2_.pdf', mimeType: 'application/pdf' },
    ])
  })

  it('is empty when none are sent', () => {
    expect(parseExtraFiles(undefined, 't1')).toEqual([])
  })

  it("refuses another tenant's upload, bad ids and too many files", () => {
    expect(() => parseExtraFiles([{ source: 'upload', path: 't2/abc/x.pdf', filename: 'x.pdf' }], 't1')).toThrow(ExtraFileError)
    expect(() => parseExtraFiles([{ source: 'upload', path: 't1/../t2/x.pdf', filename: 'x.pdf' }], 't1')).toThrow(ExtraFileError)
    expect(() => parseExtraFiles([{ source: 'file', id: 'nope' }], 't1')).toThrow(ExtraFileError)
    expect(() => parseExtraFiles(Array.from({ length: 21 }, () => ({ source: 'file', id: F1 })), 't1')).toThrow(/at most 20/)
  })

  it('falls back to a generic type for an odd mime type', () => {
    expect(parseExtraFiles([{ source: 'upload', path: 't1/a/x', filename: 'x', mimeType: 'bad type' }], 't1')[0])
      .toMatchObject({ mimeType: 'application/octet-stream' })
  })
})

describe('loadExtraFiles', () => {
  const tables = {
    job_files: [{ id: F1, tenant_id: 't1', job_id: 'j1', file_name: 'Scope.pdf', mime_type: 'application/pdf', storage_path: 't1/j1/scope.pdf' }],
    photos: [{ id: P1, tenant_id: 't1', job_id: 'j1', file_name: null, label: 'Roof', mime_type: 'image/png', sequence_number: 1, storage_path: 't1/j1/p1.png' }],
  }

  it('reads uploads, job files and photos in order', async () => {
    const { db, downloads } = fakeDb(tables)
    const out = await loadExtraFiles([
      { source: 'upload', path: 't1/a/Plan.pdf', filename: 'Plan.pdf', mimeType: 'application/pdf' },
      { source: 'file', id: F1 },
      { source: 'photo', id: P1 },
    ], 't1', 'j1', db)
    expect(out.map(f => [f.filename, f.mimeType])).toEqual([['Plan.pdf', 'application/pdf'], ['Scope.pdf', 'application/pdf'], ['Roof.png', 'image/png']])
    expect(downloads).toEqual([
      { bucket: 'mail-attachments', path: 't1/a/Plan.pdf' },
      { bucket: 'job-files', path: 't1/j1/scope.pdf' },
      { bucket: 'photos', path: 't1/j1/p1.png' },
    ])
  })

  it("won't read a file from another job", async () => {
    const { db } = fakeDb(tables)
    await expect(loadExtraFiles([{ source: 'file', id: F1 }], 't1', 'j2', db)).rejects.toMatchObject({ status: 404 })
  })
})

describe('extraFilesPhrase', () => {
  it('describes the count for approvals', () => {
    expect(extraFilesPhrase(undefined)).toBe('')
    expect(extraFilesPhrase([{ source: 'file', id: F1 }])).toBe(', with 1 extra file')
  })
})
