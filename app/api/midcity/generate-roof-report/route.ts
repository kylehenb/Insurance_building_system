import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const {
      rawNotes,
      inspectorName,
      personMet,
      relation,
      propDesc,
      address,
      insuredName,
      claimNumber,
      insurer,
      scheduledDate,
      lossType,
    } = await req.json()

    if (!rawNotes?.trim()) {
      return NextResponse.json({ error: 'rawNotes is required' }, { status: 400 })
    }

    const contextLines = [
      inspectorName ? `Inspector name: ${inspectorName}` : null,
      personMet ? `Person met on site: ${personMet}` : null,
      relation ? `Relation to property: ${relation}` : null,
      propDesc ? `Property description: ${propDesc}` : null,
      address ? `Property address: ${address}` : null,
      insuredName ? `Insured name: ${insuredName}` : null,
      claimNumber ? `Claim number: ${claimNumber}` : null,
      insurer ? `Insurer: ${insurer}` : null,
      scheduledDate ? `Date of inspection: ${scheduledDate}` : null,
      lossType ? `Loss / claim type: ${lossType}` : null,
    ].filter(Boolean).join('\n')

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are an expert roof plumber and insurance building assessor in Australia. Extract and structure information from raw roof inspection notes into a JSON report. Use professional roofing industry terminology. For Yes/No fields use exactly "Yes" or "No". For Yes/No/N/A fields use "Yes", "No", or "N/A". For condition fields use "Good", "Fair", or "Poor". If a value cannot be determined from the notes, use an empty string "".

When "Additional Context" is provided, use it to fill fields not explicitly mentioned in the raw notes:
- Use "Person met on site" for rooferMetWith
- Use "Date of inspection" for attendanceDate (format as DD.MM.YYYY)
- Use "Loss / claim type" for claimType
- Use "Property description" to infer propertyAge, wallConstruction, propertyType, numberOfStoreys

FIXED DEFAULTS — use these exact values unless the raw notes explicitly state something different:
- rooferName: "Kyle Bindon"
- rooferQualification: "Roof Plumber, Registered Builder BP103432"
- timeOnSite: "30 mins" (only override if raw notes state a specific different duration)
- scopeOfAssessment: "Carry out roof inspection and provide a roof report relating to the claim" (only override if explicitly different)`,
      messages: [{
        role: 'user',
        content: `Extract structured data from these raw roof inspection notes and return ONLY valid JSON (no markdown fences, no explanation):

Raw Notes:
${rawNotes}${contextLines ? `\n\nAdditional Context:\n${contextLines}` : ''}

JSON structure to fill:
{
  "attendanceDate": "DD.MM.YYYY",
  "timeAttended": "HH:MM timezone e.g. 11:00 AWST",
  "rooferName": "inspector full name",
  "rooferQualification": "e.g. Roof Plumber, Registered Builder BC103561",
  "rooferMetWith": "who was present on site e.g. Mrs De Silva",
  "timeOnSite": "e.g. 30 mins",
  "scopeOfAssessment": "brief scope statement",
  "propertyAge": "e.g. 50+ Years",
  "wallConstruction": "e.g. Double brick",
  "propertyType": "e.g. Residential",
  "propertyCondition": "Good|Fair|Poor",
  "numberOfStoreys": "number as string e.g. 1",
  "roofType": "e.g. Terracotta Tile, Colorbond",
  "roofGeneralCondition": "Good|Fair|Poor",
  "roofPitch": "degrees e.g. 18",
  "numberOfPenetrations": "number as string",
  "roofInsulationType": "e.g. None, Sarking, Anticon, Air-cell",
  "solarPV": "Yes|No",
  "roofMountedSolarHWS": "Yes|No",
  "numberOfSkylights": "number as string",
  "skylightFlashingsWatertight": "Yes|No",
  "skylightFlashingsNotes": "details if not watertight",
  "guttersCompliant": "Yes|No",
  "guttersNotes": "details if non-compliant e.g. No overflow provisions",
  "downpipesCompliant": "Yes|No",
  "corrosionIronizedWater": "Yes|No",
  "downpipeSize": "dimensions e.g. 95x45mm / 75mm round",
  "roofStructureTiedDown": "Yes|No|N/A",
  "battenSizeCompliant": "Yes|No|N/A",
  "trussRafterCompliant": "Yes|No|N/A",
  "claimType": "e.g. Storm, Accidental damage, Flood",
  "specificCause": "detailed description of cause and water entry points",
  "clientDiscussion": "what the insured/client stated",
  "propertyConditionsContributed": "Yes|No",
  "propertyConditionsDetails": "list of contributing conditions",
  "damageWithoutConditions": "Yes|No",
  "damageWithoutConditionsDetails": "explanation if yes",
  "customerAwareOfConditions": "Yes|No",
  "customerAwareDetails": "explanation if yes",
  "otherPropertyConditionIssues": "Yes|No",
  "otherPropertyConditionDetails": "details if yes",
  "maintenanceRepairsRequired": "Yes|No",
  "requiredMaintenanceDetails": "urgent/required maintenance items",
  "recommendedMaintenanceDetails": "recommended/other maintenance items",
  "conditionsPreventRepairs": "Yes|No",
  "conditionsPreventRepairsDetails": "explanation if yes",
  "previousRepairs": "Yes|No",
  "previousRepairsDetails": "details if yes",
  "buildingCodeViolations": "Yes|No",
  "buildingCodeViolationsDetails": "details if yes",
  "accessConcerns": "Yes|No",
  "healthSafetyConcerns": "Yes|No",
  "makeSafeCompleted": "Yes|No",
  "makeSafeCompletedDetails": "details of works completed if yes",
  "makeSafeRequired": "Yes|No"
}`,
      }],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response format' }, { status: 500 })
    }

    let reportData: Record<string, string>
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      reportData = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', details: content.text }, { status: 500 })
    }

    return NextResponse.json({ ok: true, reportData })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate report', details: String(error) }, { status: 500 })
  }
}
