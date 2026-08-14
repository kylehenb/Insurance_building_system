import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw, ensureAngleBrackets } from '@/lib/email/build-raw'

const FALLBACK_FROM = 'office@insurancerepairco.com.au'

interface CommRow {
  job_id: string | null
  thread_id: string | null
  from_email: string | null
  subject: string | null
  gmail_message_id: string | null
}

export async function POST(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  let commId: string
  let body: string
  try {
    const parsed = await req.json() as { commId?: unknown; body?: unknown }
    if (typeof parsed.commId !== 'string' || !parsed.commId) {
      return NextResponse.json({ error: 'commId is required' }, { status: 400 })
    }
    if (typeof parsed.body !== 'string' || !parsed.body.trim()) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 })
    }
    commId = parsed.commId
    body = parsed.body.trim()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // RLS-scoped client — tenant isolation is enforced by the policy
  const supabase = await createClient()

  const { data: comm, error: commErr } = await supabase
    .from('communications')
    .select('job_id,thread_id,from_email,subject,gmail_message_id')
    .eq('id', commId)
    .eq('type', 'email')
    .single()

  if (commErr || !comm) {
    return NextResponse.json({ error: 'Communication not found' }, { status: 404 })
  }

  const source = comm as CommRow

  if (!source.from_email) {
    return NextResponse.json({ error: 'Source email has no from_email — cannot reply' }, { status: 422 })
  }

  // Resolve tenant From address
  const serviceClient = createServiceClient()
  const { data: tenant } = await serviceClient
    .from('tenants')
    .select('contact_email')
    .eq('id', tenantId)
    .single()

  const fromEmail = (tenant as { contact_email: string | null } | null)?.contact_email ?? FALLBACK_FROM

  // Build Re: subject (avoid double-prefix)
  const originalSubject = source.subject ?? ''
  const replySubject = originalSubject.toLowerCase().startsWith('re:')
    ? originalSubject
    : `Re: ${originalSubject}`

  // Build RFC 2822 threading headers from gmail_message_id
  const msgId = source.gmail_message_id
  const inReplyTo = msgId ? ensureAngleBrackets(msgId) : undefined
  const references = inReplyTo ?? undefined

  const raw = buildEmailRaw({
    from: fromEmail,
    to: source.from_email,
    subject: replySubject,
    body,
    inReplyTo,
    references,
  })

  // Send via Gmail — threadId appends to the existing conversation
  try {
    const gmail = getGmailClient()
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        ...(source.thread_id ? { threadId: source.thread_id } : {}),
      },
    })
  } catch (err) {
    console.error('[reply] Gmail send error:', err)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 })
  }

  // Record outbound communication
  const { error: insertErr } = await serviceClient.from('communications').insert({
    tenant_id: tenantId,
    job_id: source.job_id,
    type: 'email',
    direction: 'outbound',
    subject: replySubject,
    content: body,
    from_email: fromEmail,
    to_email: source.from_email,
    thread_id: source.thread_id,
    source: 'manual_reply',
  })

  if (insertErr) {
    console.error('[reply] insert error:', insertErr)
    // Don't fail the request — email already sent
  }

  return NextResponse.json({ ok: true })
}
