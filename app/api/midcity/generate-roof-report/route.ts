import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { trackAi } from '@/lib/health/ai-usage'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { toDotPoints } from '@/lib/reports/dot-points'

export const dynamic = 'force-dynamic'

// The cause of damage is the paragraph the builder's assessor copies into their
// own report, so it's short dot points, never a long paragraph
const CAUSE_FORMAT = `CAUSE OF DAMAGE FORMAT (specificCause) — this is the most important field. The builder's assessor copies it straight into their own report, so it must be short and scannable:
- Line 1: one short lead sentence stating the conclusion. Examples: "Stormwater entry through a failed box gutter joint above the living room." / "Multiple causes of stormwater entry were identified:" / "In my opinion, the ceiling damage has not been caused by issues relating to the roof cover."
- Then dot points, each on its own line starting with "• ". One fact per point: an entry point, a defect, or the evidence for it (staining, water tracking, the hose test result). One sentence per point, ideally under 25 words.
- Give each separate problem (a defect or water entry point at one location) a letter in brackets at the start of its point: (A), (B), (C)… in the order written. A point that adds evidence for the same problem starts with that problem's letter again. A point that isn't about one problem (e.g. "No other breaches were found") has no letter. When the damage isn't caused by the roof, there are no problems and no letters. The letters match the photos of each problem, so keep to one letter per location.
- Never a single long paragraph. No "(1)", "1." or dashes — only "• ".
- Keep to the inspector's facts and their order. Don't add causes or evidence that aren't in the notes, and don't pad with general statements.
- Leave out the client's statement and maintenance items here — they have their own fields.
- Use numerals ("2 broken tiles"), not number words.

Example:
Stormwater entry through the roof cover at the enclosed patio from 3 defects:
• (A) Roof tiles do not overlap far enough into the gutter, depositing stormwater behind the back lip of the gutter.
• (B) Incorrect falls on the gutters cause pooling and overflow.
• (B) Water staining on the fascia below the low point of the gutter.
• (C) Approximately 17 broken roof tiles allow stormwater entry.
• No other breaches were found in the roof cover.`

export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const {
      rawNotes,
      inspectorName,
      address,
      insuredName,
      claimNumber,
      insurer,
      scheduledDate,
      lossType,
      attendanceDateFormatted,
      timeAttendedFormatted,
    } = await req.json()

    if (!rawNotes?.trim()) {
      return NextResponse.json({ error: 'rawNotes is required' }, { status: 400 })
    }

    const contextLines = [
      inspectorName ? `Inspector name: ${inspectorName}` : null,
      address ? `Property address: ${address}` : null,
      insuredName ? `Insured name: ${insuredName}` : null,
      claimNumber ? `Claim number: ${claimNumber}` : null,
      insurer ? `Insurer: ${insurer}` : null,
      scheduledDate ? `Scheduled inspection date: ${scheduledDate}` : null,
      lossType ? `Loss / claim type: ${lossType}` : null,
      attendanceDateFormatted ? `Date of attendance (use exactly for attendanceDate): ${attendanceDateFormatted}` : null,
      timeAttendedFormatted ? `Time attended (use exactly for timeAttended): ${timeAttendedFormatted}` : null,
    ].filter(Boolean).join('\n')

    const message = await trackAi({ feature: 'midcity-roof-report', provider: 'anthropic', model: 'claude-sonnet-4-6', tenantId: me.tenantId }, () => anthropic.messages.create({
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
- scopeOfAssessment: "Carry out roof inspection and provide a roof report relating to the claim" (only override if explicitly different)

${CAUSE_FORMAT}`,
      messages: [{
        role: 'user',
        content: `Extract structured data from these raw roof inspection notes and return ONLY valid JSON (no markdown fences, no explanation):

Raw Notes:
${rawNotes}${contextLines ? `\n\nAdditional Context:\n${contextLines}` : ''}

FOCUS GUIDANCE — COMBINED DICTATION:
These notes cover a full site inspection and may include building assessment (BAR) details, make safe works, and general site observations. For this Roof Report, extract and prioritise:
- Roof-specific technical details: type, pitch, penetrations, insulation type, solar PV/HWS, skylights (watertight, flashing notes), gutters (compliance, overflow), downpipes (compliance, size, corrosion), batten/truss compliance
- Cause of damage as it relates to the roof: storm entry points, impact locations, displaced tiles, flashing failures, ponding due to pitch, etc.
- Roof conditions: pre-existing roof deterioration, maintenance items, prior roof repairs, building code violations relating to the roof
- Who was met on site and what they stated (may appear anywhere in the notes)
- Property details: approximate age, wall construction, number of storeys, property type and condition (often in a general site description at the start of notes)
- Attendance date and time: use the values from Additional Context ("Date of attendance" and "Time attended") if provided — these are the authoritative values and must be used exactly as given
General building damage details (wet carpet, damaged walls, ceilings) should appear only as evidence of roof failure, not as standalone observations.
Verbal cues like "roof section", "roof report", "starting roof" indicate content especially relevant to this report.

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
  "specificCause": "lead line, then one '• ' dot point per line — see CAUSE OF DAMAGE FORMAT",
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
    }))

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

    if (typeof reportData.specificCause === 'string') reportData.specificCause = toDotPoints(reportData.specificCause)

    return NextResponse.json({ ok: true, reportData })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate report', details: String(error) }, { status: 500 })
  }
}
