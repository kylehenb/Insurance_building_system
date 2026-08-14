import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  let communicationId: string
  let storagePath: string
  try {
    const parsed = await req.json() as { communicationId?: unknown; storagePath?: unknown }
    if (typeof parsed.communicationId !== 'string' || !parsed.communicationId) {
      return NextResponse.json({ error: 'communicationId is required' }, { status: 400 })
    }
    if (typeof parsed.storagePath !== 'string' || !parsed.storagePath) {
      return NextResponse.json({ error: 'storagePath is required' }, { status: 400 })
    }
    communicationId = parsed.communicationId
    storagePath = parsed.storagePath
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Verify the path starts with this tenant's prefix before signing anything.
  // This is belt-and-suspenders on top of the DB ownership check below.
  const expectedPrefix = `tenants/${tenantId}/`
  if (!storagePath.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify the communication row belongs to this tenant (RLS enforces it server-side too).
  const supabase = await createClient()
  const { data: comm, error: commErr } = await supabase
    .from('communications')
    .select('tenant_id')
    .eq('id', communicationId)
    .single()

  if (commErr || !comm) {
    return NextResponse.json({ error: 'Communication not found' }, { status: 404 })
  }

  if ((comm as { tenant_id: string }).tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Sign the URL with service role (bypasses storage RLS; path ownership is verified above).
  // Never persist the signed URL — it is returned directly to the caller.
  const serviceClient = createServiceClient()
  const { data, error: signErr } = await serviceClient.storage
    .from('job-files')
    .createSignedUrl(storagePath, 3600)

  if (signErr || !data?.signedUrl) {
    console.error('[attachments/sign] createSignedUrl error:', signErr)
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 })
  }

  return NextResponse.json({ url: data.signedUrl })
}
