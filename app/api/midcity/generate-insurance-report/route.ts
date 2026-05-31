import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

// ── AAI Limited ───────────────────────────────────────────────────────────
const AAI_SYSTEM = `You are an expert building inspector at Insurance Repair Co Pty Ltd in Perth, Australia. Write formal, factual insurance building assessment reports for AAI Limited / Suncorp Group insurers (AAMI, GIO, Bingle, Apia, Shannons). Your style must be cold, clinical and professional - no first person language. Never use phrases like "I observed", "it appears", "I believe", or "I noted". Never speculate beyond what the evidence supports. Do not use em dashes - use hyphens or alternative punctuation instead.

Additional style rules:
- All narrative fields use third person, clinical, professional language
- All Yes/No fields must contain exactly "Yes" or "No" (capitalised, no punctuation)
- Bullet lists use "- " prefix (hyphen-space), not em dashes, not dots
- No speculation beyond observed evidence
- Australian Standard references inline where applicable
- If information is not available from the notes, use "" for that field - do not fabricate

Respond only with a valid JSON object. No preamble, no markdown code fences, no explanation - just the raw JSON.`

const AAI_SCHEMA = `{
  "claim_number": "claim number",
  "brand": "insurer brand e.g. AAMI Insurance, GIO, Suncorp",
  "insured_address": "full property address",
  "builder_reference_number": "builder reference number",
  "report_date": "today's date DD/MM/YYYY",
  "type_of_report": "e.g. Building Assessment Report",
  "date_of_loss": "DD/MM/YYYY",
  "lodgement_description": "one-line summary of what was lodged by the insured",
  "claimed_loss_cause": "e.g. Storm, Escape of Liquid, Impact",
  "client_name": "insured full name",
  "assessment_completed_by": "Kyle Bindon",
  "suncorp_assessor": "Suncorp assessor name if applicable, else empty string",
  "assessment_type": "Desktop | Site Attendance | Drive-by",
  "site_attendance": "date and time of site attendance",
  "significant_defects": "No or narrative description of significant maintenance / structural defects / property condition concerns",
  "defects_details": "details of observations if significant_defects is not No, else empty string",
  "safety_concerns": "No or narrative description of safety concerns or hazards",
  "safety_concerns_details": "details if safety_concerns is not No, else empty string",
  "areas_damaged": "clinical paragraph describing all areas of the property that have been damaged",
  "how_damage_occurred": "clinical paragraph explaining proximate cause and causal link between proximate cause and damage. No first person. Include relevant Australian Standard references where applicable.",
  "specialist_report_obtained": "Yes or No",
  "specialist_report_summary": "summary of specialist report findings if applicable, else empty string",
  "damage_long_term_or_single": "Single event | Long term / gradual | narrative",
  "wear_tear_gradual": "Yes or No",
  "visible_evidence_wear_tear": "visible evidence of wear/tear/gradual deterioration/gradual leak if wear_tear_gradual is Yes, else empty string",
  "repairs_could_have_prevented": "repairs or preventative measures that could have prevented the loss if wear_tear_gradual is Yes, else empty string",
  "customer_knew_inevitable": "Yes or No - empty string if wear_tear_gradual is No",
  "customer_knowledge_evidence": "evidence to substantiate if customer_knew_inevitable is Yes, else empty string",
  "customer_conversation": "what the insured reported; third person only; facts only",
  "general_observations": "other key facts observed during assessment; clinical format",
  "makesafe_restoration_actioned": "Yes or No",
  "makesafe_works_details": "details of makesafe or restoration works carried out if actioned, else empty string",
  "floor_plan_supplied": "Yes or No",
  "specialist_report_required": "Yes or No",
  "which_specialist_required": "which specialist is required and why if applicable, else empty string",
  "non_warrantable_repairs": "Yes or No",
  "non_warrantable_details": "details with reference to Building Laws and Regulations if Yes, else empty string",
  "pre_existing_required": "pre-existing issues REQUIRED to be addressed before repairs; None identified. if none",
  "pre_existing_recommended": "pre-existing issues RECOMMENDED to be addressed; None identified. if none",
  "material_matching_issues": "Yes or No with brief detail if Yes",
  "within_authority_to_proceed": "Yes - progressing to repairs or explanation if not",
  "claim_referred_to_insurer": "Yes or No",
  "referral_reason": "reason for referral if Yes, else empty string",
  "estimated_repair_timeframe": "overall estimated repair timeframe e.g. 4-6 weeks",
  "temp_accommodation_required": "Yes or No",
  "temp_accommodation_details": "details if Yes - what repairs require it, why, and duration; else empty string",
  "potential_recovery_identified": "Yes or No",
  "potential_recovery_details": "details of potential recovery if Yes, else empty string"
}`

// ── Auto & General ────────────────────────────────────────────────────────
const AUTO_GENERAL_SYSTEM = `You are an expert building inspector at Insurance Repair Co Pty Ltd in Perth, Australia. Write formal, factual insurance building assessment reports for Auto & General Insurance Company Limited. Your style must be cold, clinical and professional - no first person language. Never use phrases like "I observed", "it appears", "I believe", or "I noted". Never speculate beyond what the evidence supports. Do not use em dashes - use hyphens or alternative punctuation instead.

Additional style rules:
- All narrative fields use third person, clinical, professional language
- All Yes/No fields must contain exactly "Yes" or "No" or "N/A" where applicable (capitalised, no punctuation)
- Bullet lists use "- " prefix (hyphen-space), not em dashes, not dots
- No speculation beyond observed evidence
- Australian Standard references inline where applicable
- If information is not available from the notes, use "" for that field - do not fabricate

Respond only with a valid JSON object. No preamble, no markdown code fences, no explanation - just the raw JSON.`

const AUTO_GENERAL_SCHEMA = `{
  "insurer_brand": "Auto & General",
  "claim_number": "claim number",
  "date_of_loss": "DD/MM/YYYY",
  "customer_name": "customer full name",
  "loss_address": "full property address",
  "attendance_date": "DD/MM/YYYY",
  "time_attended": "e.g. 10:00 AM",
  "assessor_name": "Kyle Bindon",
  "assessor_contact_number": "IRC mobile number if known, else empty string",
  "assessor_met_with": "name of person met on site",
  "amount_of_time_on_site": "e.g. 45 minutes",
  "year_property_built": "year or approximate era e.g. Circa 1985",
  "wall_construction_type": "e.g. Brick veneer, Double brick, Weatherboard",
  "roof_type": "e.g. Colorbond metal, Concrete tile, Terracotta tile",
  "number_of_storeys": "e.g. Single storey",
  "under_construction": "Yes or No",
  "construction_removal_detail": "Yes or No",
  "construction_details": "details if applicable, else empty string",
  "heritage_listed": "Yes or No",
  "unoccupied_180_days": "Yes or No",
  "customer_discussion": "clinical paragraph summary of what the insured reported and what was found on inspection. Third person. Facts only.",
  "claim_type": "e.g. Escape of Liquid, Storm, Impact, Fire",
  "source_room": "e.g. Kitchen, Bathroom, Roof",
  "specific_cause": "e.g. Burst flexi hose under kitchen sink",
  "cause_details": "clinical paragraph. Proximate cause and causal link explained. No first person. Australian Standard references inline where applicable.",
  "resulting_damage_description": "bullet list of observed damage. Format: - [Room] - [type of damage] [measurement if known]. No cause or opinion - observations only.",
  "damage_duration": "how long damage appears to have been occurring e.g. Recent, 1-2 weeks",
  "asbestos_present": "Yes or No",
  "electrical_damaged": "Yes or No",
  "mould_present": "Yes or No",
  "restoration_required": "Yes or No",
  "restoration_works_overview": "overview of restoration works if Yes, else empty string",
  "restoration_time_estimate": "estimated time e.g. 3-5 days",
  "contents_claimed": "Yes or No",
  "property_conditions_contributed": "Yes or No",
  "conditions_duration": "how long conditions have been occurring if Yes, else empty string",
  "conditions_details": "details of contributing property conditions if Yes, else empty string",
  "damage_without_conditions": "Yes or No",
  "damage_without_conditions_details": "explanation if Yes, else empty string",
  "customer_aware_conditions": "Yes or No",
  "customer_aware_details": "details if Yes, else empty string",
  "other_property_issues": "Yes or No",
  "other_property_issues_details": "details of other property condition issues if Yes, else empty string",
  "maintenance_repairs_required": "Yes or No",
  "urgent_maintenance": "urgent maintenance items if Yes, else empty string",
  "other_maintenance": "recommended maintenance items if applicable, else empty string",
  "conditions_prevent_repairs": "Yes or No",
  "conditions_prevent_details": "details if Yes, else empty string",
  "emergency_temp_accommodation": "Yes or No",
  "emergency_temp_timeframe": "approximate timeframe if Yes, else empty string",
  "temp_accommodation_during_repairs": "Yes or No",
  "temp_accommodation_timeframe": "approximate timeframe if Yes, else empty string",
  "temp_accommodation_notes": "any special requirements",
  "property_not_good_condition": "Yes or No",
  "property_not_structurally_sound": "Yes or No",
  "property_not_well_maintained": "Yes or No",
  "property_not_water_tight": "Yes or No",
  "business_use_airbnb": "Yes or No",
  "underwriting_further_detail": "any additional underwriting notes",
  "damage_failed_appliance": "Yes or No",
  "appliance_less_than_10_years": "Yes or No or N/A",
  "appliance_salvageable": "Yes or No or N/A",
  "technician_attended": "Yes or No",
  "property_under_10_years": "Yes or No",
  "builders_trade_details": "builder or trade details if applicable, else empty string",
  "third_party_impact": "Yes or No",
  "third_party_details": "third party details if Yes, else empty string",
  "any_further_details": "any further details or other relevant information",
  "next_steps_home_assessor": "Kyle Bindon action item",
  "next_steps_claims": "what claims needs to do",
  "next_steps_builder": "what IRC/builder needs to do",
  "next_steps_specialist": "blank if none required",
  "next_steps_customer": "any customer action items",
  "report_completed_by": "Kyle Bindon",
  "individual_experience_qualification": "e.g. Licensed Builder BC105884, Insurance Repair Co Pty Ltd",
  "performed_under_licence": "BC105884"
}`

// ── IAG (unchanged) ───────────────────────────────────────────────────────
const IAG_SYSTEM = `You are an expert Australian insurance building assessor completing a formal IAG insurance assessment report. Use professional language appropriate for insurance assessment reports. For Yes/No fields use exactly "Yes" or "No". For Good/Fair/Poor fields use those exact values. If information cannot be determined from the notes or context, use an empty string "". Pre-populate fields from the provided context where applicable.

Respond only with a valid JSON object. No preamble, no markdown code fences, no explanation - just the raw JSON.`

const IAG_SCHEMA = `{
  "claim_number": "claim number",
  "insurer": "insurer name",
  "date_of_loss": "DD/MM/YYYY",
  "customer_name": "customer full name",
  "loss_address": "full property address",
  "loss_type": "e.g. Water Damage, Storm, Impact",
  "attendance_date": "DD/MM/YYYY",
  "time_attended": "e.g. 10:00 AM",
  "assessor_name": "assessor full name",
  "assessor_met_with": "name of person met on site",
  "time_on_site": "e.g. 1 hour",
  "property_age": "approximate age e.g. Circa 1985",
  "wall_construction": "e.g. Brick Veneer, Double Brick",
  "roof_type": "e.g. Tiled, Colorbond",
  "number_of_storeys": "e.g. 1",
  "property_condition": "Good or Fair or Poor",
  "heritage_listed": "Yes or No",
  "client_stated": "what the client stated about the loss",
  "areas_affected": "all areas of the property affected",
  "cause_of_loss": "detailed cause of loss",
  "damage_description": "detailed description of all damage observed",
  "pre_existing_damage": "pre-existing damage or conditions unrelated to the claim",
  "damage_long_term_or_single": "Long Term or Single Event",
  "property_conditions_contributed": "Yes or No",
  "conditions_details": "details of property conditions that contributed to damage",
  "customer_aware_conditions": "Yes or No",
  "maintenance_required": "maintenance items required or recommended",
  "specialist_required": "Yes or No",
  "specialist_details": "specialist type required and reason",
  "make_safe_required": "Yes or No",
  "make_safe_details": "make safe works details",
  "claim_assessment": "overall assessment of the claim",
  "authority_to_proceed": "Yes or No",
  "referral_required": "Yes or No",
  "referral_reason": "reason for referral if applicable",
  "estimated_timeframe": "estimated repair timeframe e.g. 4-6 weeks",
  "temp_accommodation_required": "Yes or No",
  "temp_accommodation_details": "temporary accommodation details",
  "recovery_potential": "Yes or No",
  "recovery_details": "recovery details if applicable",
  "assessor_comments": "overall comments and recommendations",
  "assessor_name_signoff": "assessor full name",
  "licence_number": "licence number e.g. BC12132"
}`

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const {
      rawNotes,
      template,
      claimNumber,
      insuredName,
      address,
      insurer,
      dateOfLoss,
      inspector,
      scheduledDate,
      lossType,
      personMet,
      propDesc,
      scopeRoomsSummary,
    } = await req.json()

    if (!rawNotes?.trim()) {
      return NextResponse.json({ error: 'rawNotes is required' }, { status: 400 })
    }

    if (!template || !['aai', 'auto_general', 'iag'].includes(template)) {
      return NextResponse.json({ error: 'Valid template is required (aai, auto_general, iag)' }, { status: 400 })
    }

    const contextLines = [
      inspector ? `Assessor name: ${inspector}` : null,
      personMet ? `Person met on site: ${personMet}` : null,
      propDesc ? `Property description: ${propDesc}` : null,
      address ? `Property address: ${address}` : null,
      insuredName ? `Insured name: ${insuredName}` : null,
      claimNumber ? `Claim number: ${claimNumber}` : null,
      insurer ? `Insurer: ${insurer}` : null,
      scheduledDate ? `Date of inspection: ${scheduledDate}` : null,
      dateOfLoss ? `Date of loss: ${dateOfLoss}` : null,
      lossType ? `Loss / claim type: ${lossType}` : null,
      scopeRoomsSummary ? `Rooms / scope:\n${scopeRoomsSummary}` : null,
    ].filter(Boolean).join('\n')

    let systemPrompt: string
    let schema: string

    if (template === 'aai') {
      systemPrompt = AAI_SYSTEM
      schema = AAI_SCHEMA
    } else if (template === 'auto_general') {
      systemPrompt = AUTO_GENERAL_SYSTEM
      schema = AUTO_GENERAL_SCHEMA
    } else {
      systemPrompt = IAG_SYSTEM
      schema = IAG_SCHEMA
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Complete the following insurance report template using the raw field notes and context provided. Return ONLY valid JSON.

Raw Field Notes:
${rawNotes}

Context:
${contextLines}

JSON structure to complete:
${schema}`,
      }],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response format' }, { status: 500 })
    }

    let fields: Record<string, string>
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      fields = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', details: content.text }, { status: 500 })
    }

    return NextResponse.json({ ok: true, fields })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate report', details: String(error) }, { status: 500 })
  }
}
