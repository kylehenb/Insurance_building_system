import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { loadUnbooked } from '@/lib/schedule/unbooked'

// GET ?person=me|everyone|<user id> — the Calendar page's "Not booked yet"
// (tech spec §23.18), the same loadUnbooked as list_unbooked by voice. Read only.
export async function GET(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const person = req.nextUrl.searchParams.get('person') ?? 'everyone'
  const personId = person === 'everyone' ? undefined : person === 'me' ? me.userId : person
  try {
    const db = createServiceClient() as unknown as SupabaseClient
    return NextResponse.json(await loadUnbooked(db, me.tenantId, { personId, includeUnassigned: personId === me.userId }))
  } catch (err) {
    console.error('[schedule/unbooked] failed:', err)
    return NextResponse.json({ error: 'Couldn\'t load what needs booking' }, { status: 500 })
  }
}
