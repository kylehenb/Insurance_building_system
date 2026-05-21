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
  let systemPrompt = `You are a building insurance scope parser. Parse the following field inspection scope notes into structured scope items.

Insurer: {insurer}
Loss Type: {loss_type}

Scope Notes:
{scope_notes}

Return ONLY a valid JSON array with no additional text. Each object must have these exact keys:
- room: room name (string)
- trade: trade type e.g. "Plastering", "Carpentry", "Painting", "Tiling" (string)
- keyword: short item keyword (string)
- item_description: full description of work required (string)
- qty: quantity as a number, or null if not quantifiable
- unit: unit of measure e.g. "m2", "lm", "item", "hr" (string)

Example: [{"room":"Living Room","trade":"Plastering","keyword":"ceiling","item_description":"Replaster damaged ceiling","qty":12,"unit":"m2"}]`
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

  // Resolve quote_id — inspection may not have it set (e.g. non-lodge flow), fall back to job's active quote
  let resolvedQuoteId: string | null = insp.quote_id ?? null
  if (!resolvedQuoteId && insp.job_id) {
    const { data: activeQuote } = await service
      .from('quotes')
      .select('id')
      .eq('job_id', insp.job_id)
      .eq('tenant_id', tenantId)
      .eq('is_active_version', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    resolvedQuoteId = activeQuote?.id ?? null
  }

  // Resolve report_id — fall back to the job's latest BAR/storm_wind report
  let resolvedReportId: string | null = insp.report_id ?? null
  if (!resolvedReportId && insp.job_id) {
    const { data: activeReport } = await service
      .from('reports')
      .select('id')
      .eq('job_id', insp.job_id)
      .eq('tenant_id', tenantId)
      .in('report_type', ['BAR', 'storm_wind'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    resolvedReportId = activeReport?.id ?? null
  }

  const {
    personMet,
    safetyData,
    scopeRooms,
    rawReportDump,
    propDesc,
    photoContext,
    insurer,
    lossType,
    roofRawNotes,
    roofPhotoContext,
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
    roofRawNotes?: string
    roofPhotoContext?: string
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

  // 2. Update inspection record — keep field_draft as the submitted snapshot (cleared just before this by the client)
  await service.from('inspections').update({
    status: 'submitted',
    form_submitted_at: now,
    safety_confirmed_at: safetyData ? now : null,
    person_met: personMet ?? null,
    raw_report_notes: rawReportDump ?? null,
  }).eq('id', inspectionId).eq('tenant_id', tenantId)

  // 2.5. Generate AI report if inspection has a report and raw_report_notes exists
  let reportGenerated = false
  if (resolvedReportId) {
    try {
      // Always save basic fields to the report when they are available
      await service.from('reports').update({
        ...(rawReportDump ? { raw_report_notes: rawReportDump } : {}),
        person_met: personMet ?? null,
        attendance_date: now.split('T')[0],
        ...(propDesc?.trim() ? { property_description: propDesc.trim() } : {}),
      }).eq('id', resolvedReportId).eq('tenant_id', tenantId)

      // Only run AI generation if there are raw report notes to work from
      if (rawReportDump && rawReportDump.trim()) {
        // Fetch BAR prompt from DB (fall back to a sensible default)
        let barSystemPrompt = 'You are an expert building insurance assessor writing professional BAR reports.'
        try {
          const { data: pd } = await service
            .from('prompts')
            .select('system_prompt')
            .eq('tenant_id', tenantId)
            .eq('key', 'report_bar')
            .single()
          if (pd?.system_prompt) barSystemPrompt = pd.system_prompt
        } catch { /* use default */ }

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        const barMsg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          system: barSystemPrompt,
          messages: [{
            role: 'user',
            content: `Generate a structured BAR report from the following inspection notes.

Raw Report Notes:
${rawReportDump}

Property Description (inspector's notes):
${propDesc || ''}

Person Met on Site: ${personMet || ''}

Return ONLY a JSON object with these exact keys (empty string if unknown):
{
  "property_description": "",
  "incident_description": "",
  "cause_of_damage": "",
  "how_damage_occurred": "",
  "resulting_damage": "",
  "pre_existing_conditions": "",
  "maintenance_notes": "",
  "conclusion": ""
}`,
          }],
        })

        const barText = barMsg.content[0]?.type === 'text' ? barMsg.content[0].text : '{}'
        const barMatch = barText.match(/\{[\s\S]*\}/)
        if (barMatch) {
          const ai = JSON.parse(barMatch[0]) as Record<string, string>
          const updateData: Record<string, unknown> = {
            // Inspector's typed property description takes priority; AI fills if blank
            property_description: propDesc?.trim() || ai.property_description || null,
            incident_description: ai.incident_description || null,
            cause_of_damage: ai.cause_of_damage || null,
            how_damage_occurred: ai.how_damage_occurred || null,
            resulting_damage: ai.resulting_damage || null,
            pre_existing_conditions: ai.pre_existing_conditions || null,
            maintenance_notes: ai.maintenance_notes || null,
            conclusion: ai.conclusion || null,
          }
          await service.from('reports').update(updateData as any).eq('id', resolvedReportId).eq('tenant_id', tenantId)
          reportGenerated = true
        }
      }
    } catch (e) {
      console.error('AI report generation error:', e)
    }
  }

  // 2.6. Generate roof report if roofRawNotes exists
  let roofReportGenerated = false
  if (roofRawNotes && roofRawNotes.trim()) {
    try {
      // Check if a roof report already exists for this inspection
      const { data: existingRoofReport } = await service
        .from('reports')
        .select('id')
        .eq('inspection_id', inspectionId)
        .eq('report_type', 'roof')
        .eq('tenant_id', tenantId)
        .maybeSingle()

      let roofReportId: string | null = null

      if (existingRoofReport) {
        // Use existing roof report
        roofReportId = existingRoofReport.id
      } else {
        // Create new roof report
        const { data: newRoofReport } = await service
          .from('reports')
          .insert({
            tenant_id: tenantId,
            job_id: insp.job_id,
            inspection_id: inspectionId,
            report_type: 'roof',
            status: 'draft',
            raw_report_notes: roofRawNotes,
            attendance_date: now.split('T')[0],
            attendance_time: now.split('T')[1]?.split('.')[0] || null,
            assessor_name: userRow.name,
          })
          .select('id')
          .single()

        if (newRoofReport) {
          roofReportId = newRoofReport.id
        }
      }

      if (roofReportId) {
        // Update the roof report with raw notes
        await service.from('reports').update({
          raw_report_notes: roofRawNotes,
        }).eq('id', roofReportId).eq('tenant_id', tenantId)

        // Call AI generate report endpoint for roof report
        const aiRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/api/ai/generate-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawReportDump: roofRawNotes,
            reportType: 'roof',
            tenantId,
          }),
        })
        if (aiRes.ok) {
          const aiData = await aiRes.json()
          // Update the roof report with AI-generated content using type_specific_fields
          const updateData: Record<string, unknown> = {
            type_specific_fields: {},
          }
          if (aiData.reportData) {
            const tsFields: Record<string, unknown> = {}
            if (aiData.reportData.roof_type) tsFields.roof_type = aiData.reportData.roof_type
            if (aiData.reportData.roof_general_condition) tsFields.roof_general_condition = aiData.reportData.roof_general_condition
            if (aiData.reportData.pitch_degrees) tsFields.pitch_degrees = aiData.reportData.pitch_degrees
            if (aiData.reportData.number_of_penetrations) tsFields.number_of_penetrations = aiData.reportData.number_of_penetrations
            if (aiData.reportData.number_of_storeys) tsFields.number_of_storeys = aiData.reportData.number_of_storeys
            if (aiData.reportData.ridge_hip_condition) tsFields.ridge_hip_condition = aiData.reportData.ridge_hip_condition
            if (aiData.reportData.gutter_condition) tsFields.gutter_condition = aiData.reportData.gutter_condition
            if (aiData.reportData.gutter_overflows) tsFields.gutter_overflows = aiData.reportData.gutter_overflows
            if (aiData.reportData.roof_insulation) tsFields.roof_insulation = aiData.reportData.roof_insulation
            if (aiData.reportData.specific_cause_of_damage) tsFields.specific_cause_of_damage = aiData.reportData.specific_cause_of_damage
            if (aiData.reportData.internal_damage) tsFields.internal_damage = aiData.reportData.internal_damage
            if (aiData.reportData.roof_damage) tsFields.roof_damage = aiData.reportData.roof_damage
            if (aiData.reportData.damage_caused_by_maintenance) tsFields.damage_caused_by_maintenance = aiData.reportData.damage_caused_by_maintenance
            if (aiData.reportData.non_claim_maintenance_issues) tsFields.non_claim_maintenance_issues = aiData.reportData.non_claim_maintenance_issues
            if (aiData.reportData.maintenance_repairs_required) tsFields.maintenance_repairs_required = aiData.reportData.maintenance_repairs_required
            if (aiData.reportData.conditions_preventing_repairs) tsFields.conditions_preventing_repairs = aiData.reportData.conditions_preventing_repairs
            if (aiData.reportData.prior_repairs) tsFields.prior_repairs = aiData.reportData.prior_repairs
            if (aiData.reportData.conclusion) tsFields.conclusion = aiData.reportData.conclusion

            updateData.type_specific_fields = tsFields
          }

          if (Object.keys(updateData).length > 0) {
            await service.from('reports').update(updateData as any).eq('id', roofReportId).eq('tenant_id', tenantId)
          }
          roofReportGenerated = true
        }
      }
    } catch (e) {
      console.error('Roof report generation error:', e)
    }
  }

  // 3. Parse and write scope items if quote exists
  let parsedCount = 0
  if (resolvedQuoteId && scopeRooms && scopeRooms.length > 0) {
    const validRooms = scopeRooms.filter(r => r.items && r.items.some(i => i.trim()))
    if (validRooms.length > 0) {
      try {
        const parsedItems = await parseScopeWithAI(validRooms, { insurer, lossType }, tenantId, service)

        if (parsedItems.length > 0) {
          // Get current max sort order
          const { data: maxSort } = await service
            .from('scope_items')
            .select('sort_order')
            .eq('quote_id', resolvedQuoteId)
            .eq('tenant_id', tenantId)
            .order('sort_order', { ascending: false })
            .limit(1)
            .maybeSingle()

          let sortOrder = (maxSort?.sort_order ?? 0) + 1

          const inserts = parsedItems.map(item => ({
            tenant_id: tenantId,
            quote_id: resolvedQuoteId as string,
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
