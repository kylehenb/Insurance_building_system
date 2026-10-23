import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import {
  buildWorkOrderEmailDraft,
  sendWorkOrderEmail,
  WorkOrderEmailError,
  type WorkOrderEmailOverrides,
} from '@/lib/work-orders/work-order-email'
import { WorkOrderPdfError } from '@/lib/work-orders/work-order-pdf'
import { permissionDenied } from '@/lib/permissions/http'

// GET  → the pre-filled email (from the work_order template) for the send modal
// POST → send to the trade and lock. Body { mode: 'auto' } sends the template
//        as-is; { mode: 'custom', to, cc, subject, body, includePhotos } sends
//        the edited copy. The job's photos PDF is attached unless includePhotos
//        is false.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function context() {
  const user = await getUser()
  if (!user?.tenant_id) return null
  return { supabase: await createClient(), tenantId: user.tenant_id, userId: user.session?.user.id ?? null }
}

function errorResponse(err: unknown, action: string) {
  if (err instanceof WorkOrderEmailError || err instanceof WorkOrderPdfError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error(`[work-orders/send] ${action} failed:`, err)
  return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
  const ctx = await context()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    return NextResponse.json(await buildWorkOrderEmailDraft(id, ctx))
  } catch (err) {
    return errorResponse(err, 'build email')
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
  const ctx = await context()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await permissionDenied(ctx.tenantId, ctx.userId, 'send.work_orders')
  if (denied) return denied

  let overrides: WorkOrderEmailOverrides = {}
  try {
    const parsed = await req.json() as Record<string, unknown>
    if (parsed.mode === 'custom') {
      const str = (k: string) => (typeof parsed[k] === 'string' ? parsed[k] as string : undefined)
      overrides = {
        to: str('to') ?? '', cc: str('cc') ?? '', subject: str('subject'), body: str('body'),
        includePhotos: parsed.includePhotos !== false,
      }
    } else if (parsed.mode !== 'auto') {
      return NextResponse.json({ error: "mode must be 'auto' or 'custom'" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const result = await sendWorkOrderEmail(id, ctx, overrides)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return errorResponse(err, 'send work order')
  }
}
