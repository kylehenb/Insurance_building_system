import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { recordOperation } from '@/lib/activity/log'
import { OPERATIONS } from '@/lib/approvals/operations'
import { CARD_KINDS } from '@/lib/actions/auto-confirm'
import { FEATURE } from '@/lib/actions/learning'
import { autoConfirmState, dismissAutoConfirm, pendingAutoConfirm, refreshAutoConfirmSuggestions } from '@/lib/learning/auto-confirm'
import { permissionDenied } from '@/lib/permissions/http'
import { permissionLevel } from '@/lib/permissions/resolve'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Auto-confirm (tech spec §24.7). Action cards are the one feature with it.
const KINDS: Record<string, string[]> = { [FEATURE]: CARD_KINDS }

// GET — each kind's switch and how it's been going, what the office is
// being asked to turn on (the banner), who turned each on, and canChange.
export async function GET(): Promise<NextResponse> {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const db = createServiceClient()
  try {
    await refreshAutoConfirmSuggestions(db, me.tenantId, FEATURE, CARD_KINDS)
    const [state, pending, level] = await Promise.all([
      autoConfirmState(db, me.tenantId, FEATURE, CARD_KINDS),
      pendingAutoConfirm(db, me.tenantId),
      permissionLevel(me.tenantId, me.userId, 'settings.edit', db),
    ])
    const ids = [...new Set(state.map(s => s.changed_by).filter((id): id is string => !!id))]
    const { data: people } = ids.length ? await db.from('users').select('id, name').eq('tenant_id', me.tenantId).in('id', ids) : { data: [] }
    const names = new Map(((people ?? []) as { id: string; name: string | null }[]).map(p => [p.id, p.name]))
    return NextResponse.json({
      state: state.map(s => ({ ...s, changed_by_name: s.changed_by ? names.get(s.changed_by) ?? null : null })),
      pending,
      canChange: level === 'allowed',
    })
  } catch (err) {
    console.error('[auto-confirm] read failed:', err)
    return NextResponse.json({ error: 'Could not load auto-confirm' }, { status: 500 })
  }
}

// POST { feature, kind, enabled } turns it on or off (logged); { feature,
// kind, dismiss: true } is "Not now" on the banner. Permission settings.edit.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const body = await req.json().catch(() => ({})) as { feature?: unknown; kind?: unknown; enabled?: unknown; dismiss?: unknown }
  const feature = typeof body.feature === 'string' ? body.feature : ''
  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!KINDS[feature]?.includes(kind)) return NextResponse.json({ error: 'Unknown kind of card' }, { status: 400 })
  if (body.dismiss !== true && typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Say whether auto-confirm is on or off' }, { status: 400 })
  const denied = await permissionDenied(me.tenantId, me.userId, 'settings.edit')
  if (denied) return denied

  const service = createServiceClient()
  if (body.dismiss === true) {
    await dismissAutoConfirm(service, me.tenantId, feature, kind)
    return NextResponse.json({ ok: true })
  }
  const payload = { feature, kind, enabled: body.enabled as boolean }
  await OPERATIONS['auto_confirm.set'].run(payload, { service, tenantId: me.tenantId, requesterId: me.userId })
  await recordOperation({ tenantId: me.tenantId, userId: me.userId, action: 'settings.edit', operation: 'auto_confirm.set', payload, service })
  return NextResponse.json({ ok: true })
}
