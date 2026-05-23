import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_SIZE = 20 * 1024 * 1024 // 20MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const tenantId = userRow.tenant_id

  // Verify inspection belongs to tenant
  const { data: insp } = await service
    .from('inspections')
    .select('id, job_id, report_id')
    .eq('id', inspectionId)
    .eq('tenant_id', tenantId)
    .single()
  if (!insp) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const label = (formData.get('label') as string) ?? ''
  const isRoofPhoto = formData.get('isRoofPhoto') === 'true'

  // Determine the correct report_id for this photo
  let photoReportId: string | null = (insp as any).report_id ?? null
  if (isRoofPhoto) {
    const { data: roofReport } = await service
      .from('reports')
      .select('id')
      .eq('inspection_id', inspectionId)
      .eq('report_type', 'roof')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    photoReportId = roofReport?.id ?? null
  }

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const mimeType = file.type || 'image/jpeg'
  if (!ALLOWED_MIME.has(mimeType) && !mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 })
  }

  const sanitized = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._\-]/g, '_')
  const fileName = `${Date.now()}-${sanitized}`
  const storagePath = `tenants/${tenantId}/inspections/${inspectionId}/${fileName}`

  const { error: uploadErr } = await service.storage
    .from('photos')
    .upload(storagePath, file)

  if (uploadErr) {
    console.error('Photo upload error:', uploadErr)
    return NextResponse.json({ error: uploadErr.message }, { status: 500 })
  }

  const { data: signed } = await service.storage
    .from('photos')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7) // 7 days

  const { data: record, error: dbErr } = await service
    .from('photos')
    .insert({
      tenant_id: tenantId,
      job_id: insp.job_id,
      inspection_id: inspectionId,
      report_id: photoReportId,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: mimeType,
      size_bytes: file.size,
      label: label || null,
    })
    .select()
    .single()

  if (dbErr) {
    await service.storage.from('photos').remove([storagePath])
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  return NextResponse.json({
    id: record.id,
    storagePath,
    url: signed?.signedUrl ?? null,
    label,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params
  const { photoId, label } = await req.json()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { error } = await service
    .from('photos')
    .update({ label })
    .eq('id', photoId)
    .eq('inspection_id', inspectionId)
    .eq('tenant_id', userRow.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params
  const { searchParams } = new URL(req.url)
  const photoId = searchParams.get('photoId')
  if (!photoId) return NextResponse.json({ error: 'photoId required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: photo } = await service
    .from('photos')
    .select('storage_path')
    .eq('id', photoId)
    .eq('inspection_id', inspectionId)
    .eq('tenant_id', userRow.tenant_id)
    .single()

  if (photo) {
    await service.storage.from('photos').remove([photo.storage_path])
    await service.from('photos').delete().eq('id', photoId).eq('tenant_id', userRow.tenant_id)
  }

  return NextResponse.json({ ok: true })
}
