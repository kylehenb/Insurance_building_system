import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { loadSummary } from '@/lib/health/daily'
import { healthDb } from '@/lib/health/db'
import { PERIOD_KINDS, type PeriodKind } from '@/lib/health/periods'

// The dashboard's health panel (tech spec §25.3): figures for one week,
// month, quarter or year (offset 0 = current, up to 4 back), against the
// period before and the usual, with the open alerts. Needs health.view
// (admins by default).

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
  return NextResponse.json(await loadSummary(db, user.tenantId, kind, offset))
}
