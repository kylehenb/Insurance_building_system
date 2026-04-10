// app/api/reports/[id]/route.ts
// Handles: PATCH (lock/unlock/reinstate), DELETE (soft delete), POST (duplicate)

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServiceClient()
  const body = await req.json()
  const { action, userId, tenantId } = body

  if (!action || !userId || !tenantId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const reportId = params.id

  const { data: report, error: fetchError } = await supabase
    .from('reports')
    .select('id, tenant_id, is_locked, report_type, report_ref, version, deleted_at')
    .eq('id', reportId)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchError || !report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  switch (action) {
    case 'lock': {
      const { error } = await supabase
        .from('reports')
        .update({ is_locked: true })
        .eq('id', reportId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, is_locked: true })
    }

    case 'unlock': {
      const { error } = await supabase
        .from('reports')
        .update({ is_locked: false })
        .eq('id', reportId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, is_locked: false })
    }

    case 'reinstate': {
      const { error } = await supabase
        .from('reports')
        .update({ deleted_at: null, deleted_by: null, delete_reason: null })
        .eq('id', reportId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServiceClient()
  const body = await req.json()
  const { userId, tenantId, reason } = body

  if (!userId || !tenantId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { error } = await supabase
    .from('reports')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
      delete_reason: reason ?? null,
    })
    .eq('id', params.id)
    .eq('tenant_id', tenantId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServiceClient()
  const body = await req.json()
  const { userId, tenantId } = body

  if (!userId || !tenantId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data: source, error: fetchError } = await supabase
    .from('reports')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchError || !source) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  const { count } = await supabase
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', source.job_id)
    .eq('tenant_id', tenantId)

  const newIndex = String((count ?? 0) + 1).padStart(3, '0')
  const jobPart = source.report_ref?.split('-')[1] ?? 'UNKNOWN'
  const newRef = `RPT-${jobPart}-${newIndex}`

  const { id: _id, created_at: _ca, report_ref: _ref, ...rest } = source
  const { data: newReport, error: insertError } = await supabase
    .from('reports')
    .insert({
      ...rest,
      report_ref: newRef,
      parent_report_id: source.id,
      version: 1,
      is_locked: false,
      status: 'draft',
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
  return NextResponse.json({ success: true, report: newReport })
}
