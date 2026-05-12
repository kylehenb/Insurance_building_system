import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

interface ScopeRoom {
  room: string
  l: string
  w: string
  h: string
  items: string[]
}

interface ScopeItem {
  room: string
  trade: string
  keyword: string
  item_description: string
  qty: number | null
  unit: string
}

async function parseScopeWithAI(scopeRooms: ScopeRoom[], jobContext: { insurer: string; lossType: string }, tenantId: string, service: any): Promise<ScopeItem[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const scopeText = scopeRooms.map(r => {
    const dims = [r.l, r.w, r.h].filter(Boolean).join('×')
    const dimStr = dims ? ` (${dims}m)` : ''
    const items = r.items.filter(Boolean).map(i => `  - ${i}`).join('\n')
    return `${r.room || 'General'}${dimStr}:\n${items || '  (no items)'}`
  }).join('\n\n')

  // Fetch the scope parsing prompt from the database
  let systemPrompt = 'You are a building insurance scope parser. Parse the following field inspection scope notes into structured scope items.'
  try {
    const { data: promptData } = await service
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', 'scope_field_parse')
      .single()
    if (promptData?.system_prompt) {
      systemPrompt = promptData.system_prompt
    }
  } catch (e) {
    console.error('Failed to fetch scope parsing prompt, using default:', e)
  }

  // Replace placeholders in the prompt with actual values
  const prompt = systemPrompt
    .replace('{insurer}', jobContext.insurer || 'Unknown')
    .replace('{loss_type}', jobContext.lossType || 'Unknown')
    .replace('{scope_notes}', scopeText)

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0]?.type === 'text' ? message.content[0].text : '[]'
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []

  try {
    return JSON.parse(match[0]) as ScopeItem[]
  } catch {
    return []
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params
  const body = await req.json()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id, name')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const tenantId = userRow.tenant_id

  const { data: insp } = await service
    .from('inspections')
    .select('id, job_id, quote_id, report_id, status')
    .eq('id', inspectionId)
    .eq('tenant_id', tenantId)
    .single()
  if (!insp) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

  const {
    personMet,
    safetyData,
    scopeRooms,
    rawReportDump,
    propDesc,
    photoContext,
    insurer,
    lossType,
  }: {
    personMet: string
    safetyData: {
      general: boolean
      ppe: boolean
      asbestos: boolean
      structural: boolean
      roofPower: boolean
      weather: boolean
      customNotes: string
      hospitalName: string
      signedBy: string
    }
    scopeRooms: ScopeRoom[]
    rawReportDump: string
    propDesc: string
    photoContext: string
    insurer: string
    lossType: string
  } = body

  const now = new Date().toISOString()

  // 1. Save safety record
  await service.from('safety_records').insert({
    tenant_id: tenantId,
    job_id: insp.job_id,
    inspection_id: inspectionId,
    inspector_id: user.id,
    date: now.split('T')[0],
    confirmed_at: now,
    structural_ok: safetyData?.structural ?? false,
    ppe_confirmed: safetyData?.ppe ?? false,
    asbestos_risk: !(safetyData?.asbestos ?? false),
    roof_access: safetyData?.roofPower ?? false,
    nearest_hospital: safetyData?.hospitalName ?? null,
    custom_notes: safetyData?.customNotes ?? null,
    signed_by: safetyData?.signedBy ?? personMet ?? null,
    status: 'confirmed',
    type: 'field_inspection',
  })

  // 2. Update inspection record
  await service.from('inspections').update({
    status: 'submitted',
    form_submitted_at: now,
    safety_confirmed_at: safetyData ? now : null,
    person_met: personMet ?? null,
    raw_report_dump: rawReportDump ?? null,
    field_draft: null, // clear draft on submit
  }).eq('id', inspectionId).eq('tenant_id', tenantId)

  // 2.5. Generate AI report if inspection has a report and raw_report_dump exists
  let reportGenerated = false
  if (insp.report_id && rawReportDump && rawReportDump.trim()) {
    try {
      // First, copy raw_report_dump to the report
      await service.from('reports').update({
        raw_report_dump: rawReportDump,
      }).eq('id', insp.report_id).eq('tenant_id', tenantId)

      // Then call AI generate report endpoint
      const aiRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/api/ai/generate-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawReportDump: rawReportDump,
          reportType: 'BAR',
          tenantId,
        }),
      })
      if (aiRes.ok) {
        const aiData = await aiRes.json()
        // Update the report with AI-generated content using the same fields as the web app
        const updateData: Record<string, unknown> = {}
        if (aiData.reportData.property_address) updateData.property_address = aiData.reportData.property_address
        if (aiData.reportData.property_description) updateData.property_description = aiData.reportData.property_description
        if (aiData.reportData.damage_description) updateData.damage_description = aiData.reportData.damage_description
        if (aiData.reportData.cause_of_damage) updateData.cause_of_damage = aiData.reportData.cause_of_damage
        if (aiData.reportData.pre_existing_conditions) updateData.pre_existing_conditions = aiData.reportData.pre_existing_conditions
        if (aiData.reportData.maintenance_notes) updateData.maintenance_notes = aiData.reportData.maintenance_notes
        if (aiData.reportData.conclusion) updateData.conclusion = aiData.reportData.conclusion
        if (aiData.reportData.recommendations) updateData.recommendations = aiData.reportData.recommendations

        if (Object.keys(updateData).length > 0) {
          await service.from('reports').update(updateData as any).eq('id', insp.report_id).eq('tenant_id', tenantId)
        }
        reportGenerated = true
      }
    } catch (e) {
      console.error('AI report generation error:', e)
    }
  }

  // 3. Parse and write scope items if quote exists
  let parsedCount = 0
  if (insp.quote_id && scopeRooms && scopeRooms.length > 0) {
    const validRooms = scopeRooms.filter(r => r.items && r.items.some(i => i.trim()))
    if (validRooms.length > 0) {
      try {
        const parsedItems = await parseScopeWithAI(validRooms, { insurer, lossType }, tenantId, service)

        if (parsedItems.length > 0) {
          // Get current max sort order
          const { data: maxSort } = await service
            .from('scope_items')
            .select('sort_order')
            .eq('quote_id', insp.quote_id)
            .eq('tenant_id', tenantId)
            .order('sort_order', { ascending: false })
            .limit(1)
            .maybeSingle()

          let sortOrder = (maxSort?.sort_order ?? 0) + 1

          const inserts = parsedItems.map(item => ({
            tenant_id: tenantId,
            quote_id: insp.quote_id as string,
            room: item.room || null,
            trade: item.trade || null,
            keyword: item.keyword || null,
            item_description: item.item_description || null,
            qty: item.qty ?? null,
            unit: item.unit || null,
            is_custom: true,
            approval_status: 'pending',
            sort_order: sortOrder++,
          }))

          const { error: insertErr } = await service.from('scope_items').insert(inserts)
          if (!insertErr) parsedCount = inserts.length
        }
      } catch (e) {
        console.error('Scope parse error:', e)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    submittedAt: now,
    scopeItemsCreated: parsedCount,
  })
}
