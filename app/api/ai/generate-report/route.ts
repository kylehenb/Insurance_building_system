import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import { getBrainContext } from '@/lib/brain/getBrainContext'
import { formatBrainContext } from '@/lib/brain/formatBrainContext'
import { upsertReportTemplate } from '@/app/api/report-templates/route'

export const dynamic = 'force-dynamic'

const EXAMPLE_SELECT =
  'report_type, loss_type, incident_description, cause_of_damage, resulting_damage, conclusion, pre_existing_conditions, type_specific_fields'

interface ReportRow {
  report_type: string
  loss_type: string | null
  incident_description: string | null
  cause_of_damage: string | null
  resulting_damage: string | null
  conclusion: string | null
  pre_existing_conditions: string | null
  type_specific_fields: Record<string, unknown> | null
}

async function fetchExamples(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  reportType: string,
  damageTemplate: string,
  insurer: string | null | undefined
): Promise<ReportRow[]> {
  // If insurer is provided, attempt insurer-scoped examples first.
  // Use them exclusively when we have 2+; otherwise fall back to cross-insurer.
  if (insurer?.trim()) {
    const { data: jobRows } = await supabase
      .from('jobs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('insurer', insurer.trim())

    const jobIds = (jobRows ?? []).map(j => j.id as string)

    if (jobIds.length > 0) {
      const { data: insurerRows } = await supabase
        .from('reports')
        .select(EXAMPLE_SELECT)
        .eq('tenant_id', tenantId)
        .eq('damage_template', damageTemplate)
        .eq('report_type', reportType)
        .eq('status', 'complete')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false })
        .limit(5)

      const insurerExamples = (insurerRows ?? []) as ReportRow[]
      if (insurerExamples.length >= 2) {
        return insurerExamples
      }
    }
  }

  // Cross-insurer fallback: no insurer provided, or < 2 insurer-specific found
  const { data } = await supabase
    .from('reports')
    .select(EXAMPLE_SELECT)
    .eq('tenant_id', tenantId)
    .eq('damage_template', damageTemplate)
    .eq('report_type', reportType)
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(5)

  return (data ?? []) as ReportRow[]
}

function formatExamples(examples: ReportRow[], insurer: string | null | undefined): string {
  if (examples.length === 0) {
    return 'No past reports exist for this damage scenario yet — generate based on the field dump and report type guidelines only.'
  }

  const scopeNote = insurer?.trim()
    ? `(insurer: ${insurer.trim()}, most recent first)`
    : '(cross-insurer, most recent first)'

  const lines: string[] = [
    `PAST REPORTS FOR THIS DAMAGE SCENARIO ${scopeNote} — use as style and content reference:`,
    '',
  ]

  examples.forEach((ex, i) => {
    lines.push(`Example ${i + 1}:`)
    lines.push(`- Report Type: ${ex.report_type}`)
    if (ex.loss_type) lines.push(`- Loss Type: ${ex.loss_type}`)
    if (ex.incident_description) lines.push(`- Incident Description: ${ex.incident_description}`)
    if (ex.cause_of_damage) lines.push(`- Cause of Damage: ${ex.cause_of_damage}`)
    if (ex.resulting_damage) lines.push(`- Resulting Damage: ${ex.resulting_damage}`)
    if (ex.pre_existing_conditions) lines.push(`- Pre-existing Conditions: ${ex.pre_existing_conditions}`)
    if (ex.conclusion) lines.push(`- Conclusion: ${ex.conclusion}`)
    if (ex.type_specific_fields && typeof ex.type_specific_fields === 'object') {
      const populated = Object.entries(ex.type_specific_fields).filter(
        ([, v]) => v !== null && v !== '' && v !== undefined
      )
      if (populated.length > 0) {
        lines.push(`- Type-specific Fields: ${populated.map(([k, v]) => `${k}: ${v}`).join(' | ')}`)
      }
    }
    lines.push('')
  })

  lines.push(
    'Use the above examples to match the writing style, level of detail, and field structure expected for this damage scenario. Do not copy content — generate fresh content for this specific job.'
  )

  return lines.join('\n')
}

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
      damageTemplate,
      damageTemplateSaved,
      insurer,
    } = body as {
      rawReportDump: string
      reportType: string
      tenantId: string
      damageTemplate?: string | null
      damageTemplateSaved?: boolean
      insurer?: string | null
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

    const templateName = damageTemplate?.trim() ?? null

    // Fetch prompt, brain context, and (if template given) insurer-scoped examples in parallel
    const [promptResult, brainEntries, examples] = await Promise.all([
      supabase
        .from('prompts')
        .select('system_prompt')
        .eq('tenant_id', tenantId)
        .eq('key', promptKey)
        .single(),
      getBrainContext({ tenantId, promptKey }),
      templateName
        ? fetchExamples(supabase, tenantId, reportType, templateName, insurer)
        : Promise.resolve([] as ReportRow[]),
    ])

    const basePrompt =
      promptResult.data?.system_prompt ||
      'You are an expert building insurance assessor. Generate a professional, detailed report based on the inspection notes provided.'

    const brainBlock = formatBrainContext(brainEntries)
    const examplesBlock = formatExamples(examples, insurer)

    const systemPrompt = [basePrompt, brainBlock, examplesBlock].filter(Boolean).join('\n\n')

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
  "loss_type": "string",
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
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response format from Claude' }, { status: 500 })
    }

    let reportData: Record<string, string>
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      reportData = JSON.parse(jsonMatch[0])
    } catch {
      console.error('Failed to parse Claude response:', content.text)
      return NextResponse.json(
        { error: 'Failed to parse AI response', details: content.text },
        { status: 500 }
      )
    }

    // Auto-create template row if applicable (dedup-safe; templates are cross-insurer)
    if (damageTemplateSaved !== false && templateName) {
      void upsertReportTemplate(templateName, reportType, tenantId, supabase)
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
