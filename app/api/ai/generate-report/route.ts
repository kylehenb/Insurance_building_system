import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  try {
    const body = await req.json()
    const { rawReportDump, reportType, tenantId } = body

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

    // Determine the prompt key based on report type
    let promptKey: string
    switch (reportType.toLowerCase()) {
      case 'bar':
        promptKey = 'report_bar'
        break
      case 'make_safe':
        promptKey = 'report_make_safe'
        break
      case 'roof':
        promptKey = 'report_roof'
        break
      case 'specialist':
        promptKey = 'report_specialist'
        break
      default:
        promptKey = 'report_bar'
    }

    // Get the prompt from the prompts table
    const { data: promptData } = await supabase
      .from('prompts')
      .select('system_prompt')
      .eq('tenant_id', tenantId)
      .eq('key', promptKey)
      .single()

    const systemPrompt = promptData?.system_prompt || 
      'You are an expert building insurance assessor. Generate a professional, detailed report based on the inspection notes provided.'

    // Build the user message with field-specific instructions
    let userMessage = `Generate a structured report based on the following raw inspection notes.

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
      messages: [
        { role: 'user', content: userMessage }
      ],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response format from Claude' }, { status: 500 })
    }

    // Parse the JSON response
    let reportData: Record<string, string>
    try {
      // Extract JSON from the response (Claude might wrap it in markdown)
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      reportData = JSON.parse(jsonMatch[0])
    } catch (e) {
      console.error('Failed to parse Claude response:', content.text)
      return NextResponse.json({ 
        error: 'Failed to parse AI response',
        details: content.text 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      reportData,
    })
  } catch (error) {
    console.error('Error generating report:', error)
    return NextResponse.json({ 
      error: 'Failed to generate report',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
