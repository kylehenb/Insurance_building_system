import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import { getBrainContext } from '@/lib/brain/getBrainContext'
import { formatBrainContext } from '@/lib/brain/formatBrainContext'
import { getSimilarReportsBlock } from '@/lib/reports/similar-reports'
import { getResponseText } from '@/lib/ai/response-text'
import { LOSS_TYPES_PROMPT_LIST, normaliseLossType } from '@/lib/loss-types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  try {
    const body = await req.json()
    const {
      rawReportDump,
      reportType,
      tenantId,
      reportId,
    } = body as {
      rawReportDump: string
      reportType: string
      tenantId: string
      reportId?: string | null
    }

    if (!rawReportDump) {
      return NextResponse.json({ error: 'rawReportDump is required' }, { status: 400 })
    }
    if (!reportType) {
      return NextResponse.json({ error: 'reportType is required' }, { status: 400 })
    }
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    let promptKey: string
    switch (reportType.toLowerCase()) {
      case 'bar':        promptKey = 'report_bar';      break
      case 'make_safe':  promptKey = 'report_make_safe'; break
      case 'roof':       promptKey = 'report_roof';      break
      case 'specialist': promptKey = 'report_specialist'; break
      default:           promptKey = 'report_bar'
    }

    // Loss type and insurer of the report being written, to sharpen the similar-report lookup
    let lossType: string | null = null
    let insurer: string | null = null
    if (reportId) {
      const { data: reportRow } = await supabase
        .from('reports')
        .select('loss_type, jobs(insurer)')
        .eq('id', reportId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      lossType = reportRow?.loss_type ?? null
      insurer = (reportRow?.jobs as { insurer: string | null } | null)?.insurer ?? null
    }

    // Fetch prompt, brain context, and the closest past locked reports in parallel
    const [promptResult, brainEntries, similarReports] = await Promise.all([
      supabase
        .from('prompts')
        .select('system_prompt')
        .eq('tenant_id', tenantId)
        .eq('key', promptKey)
        .single(),
      getBrainContext({ tenantId, promptKey }),
      getSimilarReportsBlock({
        service: supabase, tenantId, reportType, notes: rawReportDump, lossType, insurer, excludeReportId: reportId,
      }),
    ])

    const basePrompt =
      promptResult.data?.system_prompt ||
      'You are an expert building insurance assessor. Generate a professional, detailed report based on the inspection notes provided.'

    const brainBlock = formatBrainContext(brainEntries)
    const systemPrompt = [basePrompt, brainBlock, similarReports].filter(Boolean).join('\n\n')

    // Fire and forget — increment times_applied for injected brain entries
    if (brainEntries.length > 0) {
      void Promise.all(
        brainEntries.map(entry =>
          supabase
            .from('brain_entries')
            .update({ times_applied: entry.times_applied + 1 })
            .eq('id', entry.id)
            .eq('tenant_id', tenantId)
        )
      )
    }

    const userMessage = `Generate a structured report based on the following raw inspection notes.

Raw Report Dump:
${rawReportDump}

Return ONLY a JSON object with the following structure based on the report type:

For BAR reports:
{
  "attendance_date": "YYYY-MM-DD",
  "attendance_time": "HH:MM",
  "person_met": "string",
  "assessor_name": "string",
  "property_address": "string",
  "insured_name": "string",
  "claim_number": "string",
  "loss_type": "exactly one of: ${LOSS_TYPES_PROMPT_LIST} — or empty string if unclear",
  "incident_description": "string",
  "cause_of_damage": "string",
  "how_damage_occurred": "string",
  "resulting_damage": "string",
  "pre_existing_conditions": "string",
  "maintenance_notes": "string",
  "conclusion": "string"
}

For Make Safe reports:
{
  "attendance_date": "YYYY-MM-DD",
  "attendance_time": "HH:MM",
  "assessor_name": "string",
  "person_met": "string",
  "property_address": "string",
  "insured_name": "string",
  "claim_number": "string",
  "immediate_hazards": "string",
  "works_carried_out": "string",
  "further_works_required": "string",
  "safe_to_occupy": "Yes|No|Conditional",
  "occupancy_conditions": "string",
  "fee_schedule": "string"
}

For Roof reports:
{
  "roof_type": "string or array of strings",
  "roof_general_condition": "Good|Fair|Poor",
  "pitch_degrees": "number",
  "number_of_penetrations": "number",
  "number_of_storeys": "string",
  "ridge_hip_condition": "string",
  "gutter_condition": "string",
  "gutter_overflows": "string",
  "roof_insulation": "string or array of strings",
  "specific_cause_of_damage": "string",
  "internal_damage": "string",
  "roof_damage": "string",
  "damage_caused_by_maintenance": "string",
  "non_claim_maintenance_issues": "string",
  "maintenance_repairs_required": "string",
  "conditions_preventing_repairs": "string",
  "prior_repairs": "string",
  "conclusion": "string"
}

Guidelines:
- Extract all available information from the raw notes
- If a field cannot be determined from the notes, set it to an empty string
- Use professional insurance industry terminology
- Keep descriptions clear and concise
- For dates/times, use the exact format shown
- For safe_to_occupy, use only: Yes, No, or Conditional
`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = getResponseText(message)

    let reportData: Record<string, string>
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      reportData = JSON.parse(jsonMatch[0])
    } catch {
      console.error('Failed to parse Claude response:', text)
      return NextResponse.json(
        { error: 'Failed to parse AI response', details: text },
        { status: 500 }
      )
    }

    // Loss type comes from the fixed list. Keep the one already on the report (set from the
    // job when it was lodged); otherwise accept the AI's pick only if it is on the list.
    if ('loss_type' in reportData) {
      const lossTypeValue = lossType ?? normaliseLossType(reportData.loss_type)
      if (lossTypeValue) reportData.loss_type = lossTypeValue
      else delete reportData.loss_type
    }

    return NextResponse.json({ success: true, reportData })
  } catch (error) {
    console.error('Error generating report:', error)
    return NextResponse.json(
      { error: 'Failed to generate report', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
