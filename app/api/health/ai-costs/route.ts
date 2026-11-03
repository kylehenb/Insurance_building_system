import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { loadAiCosts } from '@/lib/health/ai-costs'
import { healthDb } from '@/lib/health/db'
import { PERIOD_KINDS, type PeriodKind } from '@/lib/health/periods'

// Where the AI money goes (tech spec §25.6): one period's AI spend by feature
// and model, against the same days before. Read when the health panel's
// section is opened. Needs health.view.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  const denied = await permissionDenied(user.tenantId, user.userId, 'health.view')
  if (denied) return denied

  const params = req.nextUrl.searchParams
  const kind = (params.get('period') ?? 'week') as PeriodKind
  const offset = Number(params.get('offset') ?? 0)
  if (!PERIOD_KINDS.includes(kind)) return NextResponse.json({ error: 'period must be week, month, quarter or year' }, { status: 400 })
  if (!Number.isInteger(offset) || offset < 0 || offset > 4) return NextResponse.json({ error: 'offset must be 0 to 4' }, { status: 400 })

  const db = healthDb()
  if (!db) return NextResponse.json({ error: 'No database configured' }, { status: 500 })
  return NextResponse.json(await loadAiCosts(db, user.tenantId, kind, offset))
}
