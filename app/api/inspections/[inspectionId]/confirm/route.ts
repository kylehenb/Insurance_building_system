import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await params

    const authClient = await createClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { error } = await supabase
      .from('inspections')
      .update({
        status: 'appointment_confirmed',
        booking_confirmed_at: new Date().toISOString(),
      })
      .eq('id', inspectionId)
      .eq('tenant_id', userRow.tenant_id)

    if (error) {
      console.error('[confirm] update error:', error)
      return NextResponse.json({ error: 'Failed to confirm appointment' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[confirm] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
