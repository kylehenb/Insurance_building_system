import { describe, it, expect, vi, beforeEach } from 'vitest'

// The voice notes route: a signed-in user's recording, for their own company's
// inspection, turned into text with each phrase's timing (whisper-1), and the
// audio kept in the private voice-notes bucket when it can be.

let me: { tenantId: string; userId: string } | null = null
let inspection: { id: string; job_id: string } | null = { id: 'i1', job_id: 'j1' }
let storeError: { message: string } | null = null
const uploads: Array<{ bucket: string; path: string }> = []
const tracked: Array<Record<string, unknown>> = []
const aiCalls: Array<Record<string, unknown>> = []
const errors: string[] = []

vi.mock('@/lib/auth/session', () => ({ sessionUser: async () => me, unauthorized: () => new Response('{}', { status: 401 }) }))
vi.mock('@/lib/health/errors', () => ({ logError: async (source: string) => { errors.push(source) } }))
vi.mock('@/lib/health/ai-usage', () => ({
  trackAi: async (meta: Record<string, unknown>, call: () => Promise<unknown>) => { tracked.push(meta); return call() },
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: inspection }) }) }) }) }),
    storage: { from: (bucket: string) => ({ upload: async (path: string) => { uploads.push({ bucket, path }); return { error: storeError } } }) },
  }),
}))
vi.mock('openai', () => ({
  toFile: async (data: Buffer, name: string) => ({ name, size: data.length }),
  default: class {
    audio = {
      transcriptions: {
        create: async (args: Record<string, unknown>) => {
          aiCalls.push(args)
          return { text: 'Tiles short of the gutter.', duration: 6.2, segments: [{ start: 0, end: 3.1, text: ' Tiles short ' }, { start: 3.1, end: 6.2, text: 'of the gutter.' }] }
        },
      },
    }
  },
}))

process.env.OPENAI_API_KEY = 'test'
const route = await import('../voice/route')
const post = (fields: Record<string, string | Blob>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return route.POST(new Request('https://app.test/api/midcity/voice', { method: 'POST', body: fd }) as never)
}
const audio = () => new Blob([new Uint8Array(2048)], { type: 'audio/mp4' })

beforeEach(() => {
  me = null; inspection = { id: 'i1', job_id: 'j1' }; storeError = null
  uploads.length = 0; tracked.length = 0; aiCalls.length = 0; errors.length = 0
})

describe('voice notes route', () => {
  it('refuses without a signed-in user, before any AI call', async () => {
    expect((await post({ inspectionId: 'i1', sectionId: 'vabc123', audio: audio() })).status).toBe(401)
    expect(aiCalls).toHaveLength(0)
  })

  it("won't transcribe another company's inspection", async () => {
    me = { tenantId: 't1', userId: 'u1' }
    inspection = null
    expect((await post({ inspectionId: 'i9', sectionId: 'vabc123', audio: audio() })).status).toBe(404)
    expect(aiCalls).toHaveLength(0)
  })

  it('returns the text with each phrase timed, keeps the audio privately, and records the cost', async () => {
    me = { tenantId: 't1', userId: 'u1' }
    const res = await post({ inspectionId: 'i1', sectionId: 'vabc123', audio: audio() })
    expect(await res.json()).toEqual({ ok: true, text: 'Tiles short of the gutter.', seconds: 6.2, parts: [{ start: 0, end: 3.1, text: 'Tiles short' }, { start: 3.1, end: 6.2, text: 'of the gutter.' }] })
    expect(uploads).toEqual([{ bucket: 'voice-notes', path: 'tenants/t1/inspections/i1/voice/vabc123.m4a' }])
    expect(aiCalls[0]).toMatchObject({ model: 'whisper-1', response_format: 'verbose_json', timestamp_granularities: ['segment'] })
    expect(String(aiCalls[0].prompt)).toContain('sarking')
    expect(tracked).toEqual([expect.objectContaining({ feature: 'midcity-voice-notes', provider: 'openai', model: 'whisper-1', tenantId: 't1', jobId: 'j1' })])
  })

  it('still returns the text when the audio can\'t be kept (bucket not set up yet), and logs it', async () => {
    me = { tenantId: 't1', userId: 'u1' }
    storeError = { message: 'Bucket not found' }
    const res = await post({ inspectionId: 'i1', sectionId: 'vabc123', audio: audio() })
    expect((await res.json()).text).toBe('Tiles short of the gutter.')
    expect(errors).toEqual(['midcity-voice-notes'])
  })

  it('checks what it is sent', async () => {
    me = { tenantId: 't1', userId: 'u1' }
    expect((await post({ inspectionId: 'i1', sectionId: '../x', audio: audio() })).status).toBe(400)
    expect((await post({ inspectionId: 'i1', sectionId: 'vabc123' })).status).toBe(400)
    expect(await (await post({ inspectionId: 'i1', sectionId: 'vabc123', audio: new Blob([], { type: 'audio/mp4' }) })).json()).toEqual({ ok: true, text: '', parts: [], seconds: 0 })
  })
})
