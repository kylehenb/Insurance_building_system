import { NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { DocumentSendError } from '@/lib/documents/send/documents'
import { inspectionPackage } from '@/lib/documents/send/inspection-package'

// The documents in an inspection's package, for Compile & Submit Package
// (which then sends them through POST /api/documents/send). Reads only.
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { inspectionId } = await params
  try {
    // Service client: every query filters the session's tenant
    const pkg = await inspectionPackage({ supabase: createServiceClient(), tenantId: me.tenantId }, inspectionId)
    return NextResponse.json(pkg)
  } catch (err) {
    if (err instanceof DocumentSendError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error(`[inspection package ${inspectionId}] failed:`, err)
    return NextResponse.json({ error: 'Failed to load the package' }, { status: 500 })
  }
}
