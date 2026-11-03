import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { eventAsComm, jobEvents } from '@/lib/communications/ledger'

export async function GET(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobId = new URL(req.url).searchParams.get('job_id')
  if (!jobId) {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('communications')
    .select(
      'id,type,direction,contact_type,contact_name,contact_detail,subject,content,body_text,' +
      'attachments,requires_action,action_queue_id,created_at,from_email,to_email,' +
      'gmail_message_id,thread_id,work_order_id,persona,source,read_at,is_starred'
    )
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // The job's ledger: its emails and notes, and everything else that happened
  // on it (lib/communications/ledger.ts). A failure here leaves the messages.
  let events: ReturnType<typeof eventAsComm>[] = []
  try {
    events = (await jobEvents(supabase as never, userSession.tenant_id, jobId)).map(eventAsComm)
  } catch (err) {
    console.error('[communications] job events failed:', err)
  }
  const all = [...((data ?? []) as unknown as { created_at: string | null }[]), ...events]
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  return NextResponse.json(all)
}
