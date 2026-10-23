import { NextRequest, NextResponse } from 'next/server'
import { composeAccess } from '@/lib/mail/access'
import { searchContacts } from '@/lib/mail/contacts'

// GET /api/mail/contacts?q= — address suggestions for To / Cc / Bcc
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access
  const q = req.nextUrl.searchParams.get('q') ?? ''
  return NextResponse.json(await searchContacts(access.tenantId, q))
}
