// app/api/reports/[id]/route.ts
// Handles: PATCH (lock/unlock/reinstate), DELETE (soft delete), POST (duplicate)

import { NextRequest, NextResponse, after } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { indexReports } from '@/lib/reports/similar-reports'
import { REPORT_TYPE_PREFIXES, ReportEditError, setReportLocked } from '@/lib/reports/edit'


export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const supabase = createServiceClient()
  const { id: reportId } = await params
  const body = await req.json()
  const { action } = body
  const tenantId = me.tenantId
  const userId = me.userId

  if (!action) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

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
      try {
        await setReportLocked(supabase, tenantId, reportId, true)
      } catch (err) {
        if (err instanceof ReportEditError) return NextResponse.json({ error: err.message }, { status: err.status })
        throw err
      }
      // Fingerprint for the similar-report lookup (the index-embeddings cron retries failures)
      after(() => indexReports(supabase, [reportId]).catch(err =>
        console.error(`[reports ${reportId}] fingerprint failed:`, err)))
      return NextResponse.json({ success: true, is_locked: true })
    }

    case 'unlock': {
      try {
        await setReportLocked(supabase, tenantId, reportId, false)
      } catch (err) {
        if (err instanceof ReportEditError) return NextResponse.json({ error: err.message }, { status: err.status })
        throw err
      }
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
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'records.delete')
  if (denied) return denied
  const supabase = createServiceClient()
  const { id: reportId } = await params
  const body = await req.json()
  const { reason } = body
  const tenantId = me.tenantId
  const userId = me.userId

  const { error } = await supabase
    .from('reports')
    .update({
      deleted_at: new Date().toISOString(), deleted_by: userId, delete_reason: reason ?? null,
    })
    .eq('id', reportId)
    .eq('tenant_id', tenantId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const supabase = createServiceClient()
  const { id: reportId } = await params
  const tenantId = me.tenantId
  const userId = me.userId

  const { data: source, error: fetchError } = await supabase
    .from('reports')
    .select('*')
    .eq('id', reportId)
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

  const newIndex = String((count ?? 0) + 1)
  const jobPart = source.report_ref?.split('-')[1] ?? 'UNKNOWN'
  const prefix = REPORT_TYPE_PREFIXES[source.report_type] || 'RPT'
  const newRef = `${prefix}-${jobPart}-${newIndex}`

  const { id: _id, created_at: _ca, report_ref: _ref, ...rest } = source
  const { data: newReport, error: insertError } = await supabase
    .from('reports')
    .insert({
      ...rest, report_ref: newRef, parent_report_id: source.id, version: 1, is_locked: false, status: 'draft', deleted_at: null, deleted_by: null, delete_reason: null,
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
  return NextResponse.json({ success: true, report: newReport })
}
