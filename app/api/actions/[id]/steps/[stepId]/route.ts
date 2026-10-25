import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { CardError, withContext, type StepDraft } from '@/lib/actions/cards'
import { saveStepDraft, saveStepEdits, stepDetail } from '@/lib/actions/steps'
import { mailDb } from '@/lib/mail/sync'

export const maxDuration = 60

type Params = { params: Promise<{ id: string; stepId: string }> }

const MAX_HTML = 2_000_000

function fail(err: unknown, what: string): NextResponse {
  if (err instanceof CardError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(`[actions] ${what} failed:`, err)
  return NextResponse.json({ error: `Could not ${what}` }, { status: 502 })
}

async function ids(params: Params['params']) {
  const { id, stepId } = await params
  return isUuid(id) && isUuid(stepId) ? { id, stepId } : null
}

// GET /api/actions/[id]/steps/[stepId] — one step in full: its details as a
// form, a preview of what it acts on, and the record it acts on if that can
// be corrected first (lib/actions/steps.ts)
export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(false)
  if (access instanceof NextResponse) return access
  const p = await ids(params)
  if (!p) return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  try {
    return NextResponse.json(await stepDetail(access.tenantId, access.userId, p.id, p.stepId))
  } catch (err) {
    return fail(err, 'load the step')
  }
}

// POST /api/actions/[id]/steps/[stepId] { args } | { draft } — save changes to
// a step before it runs: args from its form, or (an email step) the
// composer's draft, null to go back to the AI's email. Nothing is sent or
// changed yet — that's Do steps, with the user's permissions.
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const p = await ids(params)
  if (!p) return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  let body: { args?: unknown; draft?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  try {
    const db = mailDb()
    let card
    if ('draft' in body) {
      const d = body.draft as Record<string, unknown> | null
      const s = (k: string, max = 5000) => (d && typeof d[k] === 'string' ? (d[k] as string).slice(0, max) : '')
      const draft: StepDraft | null = d && typeof d === 'object' && s('id')
        ? { id: s('id', 200), to: s('to'), cc: s('cc'), bcc: s('bcc'), subject: s('subject', 1000), html: s('html', MAX_HTML) }
        : null
      card = await saveStepDraft(access.tenantId, p.id, p.stepId, draft, { db })
    } else if (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) {
      card = await saveStepEdits(access.tenantId, p.id, p.stepId, body.args as Record<string, unknown>, { db })
    } else {
      return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
    }
    return NextResponse.json({ card: (await withContext(db, access.tenantId, [card]))[0] })
  } catch (err) {
    return fail(err, 'save the step')
  }
}
