import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const AAI_SCHEMA = `{
  "claim_number": "claim number",
  "brand": "insurer brand e.g. AAMI Insurance",
  "insured_address": "full property address",
  "builder_reference_number": "builder reference number",
  "report_date": "DD/MM/YYYY",
  "type_of_report": "e.g. Building Assessment Report",
  "date_of_loss": "DD/MM/YYYY",
  "lodgement_description": "brief description of what was lodged by the insured",
  "claimed_loss_cause": "stated cause of loss from insured",
  "client_name": "insured full name",
  "assessment_completed_by": "assessor full name",
  "suncorp_assessor": "Suncorp assessor name if applicable, otherwise empty string",
  "assessment_type": "e.g. Building Assessment",
  "site_attendance": "date and time of site attendance e.g. 31/05/2026 at 10:00 AM",
  "significant_defects": "Yes|No",
  "defects_details": "details of any significant maintenance or structural defects observed",
  "safety_concerns": "No|Yes|Other",
  "safety_concerns_details": "details of any safety concerns or hazards observed",
  "areas_damaged": "detailed description of all areas of the property that have been damaged",
  "how_damage_occurred": "detailed explanation of how damage occurred, proximate cause and causal link between the proximate cause and the damage",
  "specialist_report_obtained": "Yes|No",
  "specialist_report_summary": "summary of specialist report findings if applicable",
  "damage_long_term_or_single": "Long Term|Single Event",
  "wear_tear_gradual": "Yes|No",
  "visible_evidence_wear_tear": "what was observed and visible evidence of wear/tear/gradual deterioration/gradual leak",
  "repairs_could_have_prevented": "repairs or preventative measures that if completed before the event could have prevented the loss",
  "customer_knew_inevitable": "Yes|No",
  "customer_knowledge_evidence": "evidence to substantiate how customer would or should reasonably have known",
  "customer_conversation": "summary of conversation with customer during assessment",
  "general_observations": "other key facts observed during assessment",
  "makesafe_restoration_actioned": "Yes|No",
  "makesafe_works_details": "details of makesafe or restoration works carried out",
  "floor_plan_supplied": "Yes|No",
  "specialist_report_required": "Yes|No",
  "which_specialist_required": "which specialist is required and why",
  "non_warrantable_repairs": "Yes|No",
  "non_warrantable_details": "details of non-warrantable repairs with reference to Building Laws and Regulations",
  "pre_existing_required": "non-claim related pre-existing issues REQUIRED to be addressed before repairs",
  "pre_existing_recommended": "non-claim related pre-existing issues RECOMMENDED to be addressed",
  "material_matching_issues": "any issues regarding matching of materials that may impact the repair",
  "within_authority_to_proceed": "Yes|No",
  "claim_referred_to_insurer": "Yes|No",
  "referral_reason": "reason for referral to insurer",
  "estimated_repair_timeframe": "overall estimated repair timeframe e.g. 6 weeks",
  "temp_accommodation_required": "Yes|No",
  "temp_accommodation_details": "details about temporary accommodation requirements if applicable",
  "potential_recovery_identified": "Yes|No",
  "potential_recovery_details": "details of potential recovery if applicable"
}`

const AUTO_GENERAL_SCHEMA = `{
  "insurer_brand": "Auto & General",
  "claim_number": "claim number",
  "date_of_loss": "DD/MM/YYYY",
  "customer_name": "customer full name",
  "loss_address": "full property address",
  "attendance_date": "DD/MM/YYYY",
  "time_attended": "e.g. 10:00 AM",
  "assessor_name": "assessor full name",
  "assessor_contact_number": "assessor phone number",
  "assessor_met_with": "name of person met on site",
  "amount_of_time_on_site": "e.g. 1 hour",
  "year_property_built": "e.g. 1985",
  "wall_construction_type": "e.g. Brick Veneer, Double Brick, Weatherboard",
  "roof_type": "e.g. Tiled, Colorbond",
  "number_of_storeys": "e.g. 1",
  "under_construction": "Yes|No",
  "construction_removal_detail": "Yes|No",
  "construction_details": "details if property under construction or renovation",
  "heritage_listed": "Yes|No",
  "unoccupied_180_days": "Yes|No",
  "customer_discussion": "detailed account of customer discussion and inspection findings",
  "claim_type": "e.g. Water Damage, Storm, Impact",
  "source_room": "e.g. Kitchen, Bathroom, Roof",
  "specific_cause": "specific cause of damage e.g. burst flexi hose, storm, tree impact",
  "cause_details": "detailed explanation of damage cause",
  "resulting_damage_description": "detailed description of all resulting damage observed",
  "damage_duration": "how long damage appears to have been occurring e.g. Recent, 1-2 weeks",
  "asbestos_present": "Yes|No",
  "electrical_damaged": "Yes|No",
  "mould_present": "Yes|No",
  "restoration_required": "Yes|No",
  "restoration_works_overview": "overview of restoration works required",
  "restoration_time_estimate": "estimated time to complete restoration e.g. 3-5 days",
  "contents_claimed": "Yes|No",
  "property_conditions_contributed": "Yes|No",
  "conditions_duration": "how long conditions have been occurring",
  "conditions_details": "details of property conditions that contributed to damage",
  "damage_without_conditions": "Yes|No",
  "damage_without_conditions_details": "explanation if yes",
  "customer_aware_conditions": "Yes|No",
  "customer_aware_details": "details if customer was aware of conditions",
  "other_property_issues": "Yes|No",
  "other_property_issues_details": "details of other property condition issues including structural integrity, water tightness",
  "maintenance_repairs_required": "Yes|No",
  "urgent_maintenance": "urgent maintenance items required",
  "other_maintenance": "other recommended maintenance items",
  "conditions_prevent_repairs": "Yes|No",
  "conditions_prevent_details": "details if conditions prevent warrantable repairs",
  "emergency_temp_accommodation": "Yes|No",
  "emergency_temp_timeframe": "approximate timeframe for emergency accommodation",
  "temp_accommodation_during_repairs": "Yes|No",
  "temp_accommodation_timeframe": "approximate timeframe for accommodation during repairs",
  "temp_accommodation_notes": "notes and special requirements for accommodation",
  "property_not_good_condition": "Yes|No",
  "property_not_structurally_sound": "Yes|No",
  "property_not_well_maintained": "Yes|No",
  "property_not_water_tight": "Yes|No",
  "business_use_airbnb": "Yes|No",
  "underwriting_further_detail": "further underwriting details or other relevant information",
  "damage_failed_appliance": "Yes|No",
  "appliance_less_than_10_years": "Yes|No",
  "appliance_salvageable": "Yes|No",
  "technician_attended": "Yes|No",
  "property_under_10_years": "Yes|No",
  "builders_trade_details": "builder or trade details if applicable",
  "third_party_impact": "Yes|No",
  "third_party_details": "third party details if damage caused by third party",
  "any_further_details": "any further details or other relevant information",
  "next_steps_home_assessor": "next steps for home assessor",
  "next_steps_claims": "next steps for claims team",
  "next_steps_builder": "next steps for builder",
  "next_steps_specialist": "next steps for specialist",
  "next_steps_customer": "next steps for customer",
  "report_completed_by": "assessor full name",
  "individual_experience_qualification": "e.g. Registered Builder BP103432",
  "performed_under_licence": "e.g. BC12132"
}`

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
  "property_condition": "Good|Fair|Poor",
  "heritage_listed": "Yes|No",
  "client_stated": "what the client stated about the loss",
  "areas_affected": "all areas of the property affected",
  "cause_of_loss": "detailed cause of loss",
  "damage_description": "detailed description of all damage observed",
  "pre_existing_damage": "pre-existing damage or conditions unrelated to the claim",
  "damage_long_term_or_single": "Long Term|Single Event",
  "property_conditions_contributed": "Yes|No",
  "conditions_details": "details of property conditions that contributed to damage",
  "customer_aware_conditions": "Yes|No",
  "maintenance_required": "maintenance items required or recommended",
  "specialist_required": "Yes|No",
  "specialist_details": "specialist type required and reason",
  "make_safe_required": "Yes|No",
  "make_safe_details": "make safe works details",
  "claim_assessment": "overall assessment of the claim",
  "authority_to_proceed": "Yes|No",
  "referral_required": "Yes|No",
  "referral_reason": "reason for referral if applicable",
  "estimated_timeframe": "estimated repair timeframe e.g. 4-6 weeks",
  "temp_accommodation_required": "Yes|No",
  "temp_accommodation_details": "temporary accommodation details",
  "recovery_potential": "Yes|No",
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

    let templateName: string
    let schema: string

    if (template === 'aai') {
      templateName = 'AAI Limited (AAMI Insurance / Suncorp)'
      schema = AAI_SCHEMA
    } else if (template === 'auto_general') {
      templateName = 'Auto & General'
      schema = AUTO_GENERAL_SCHEMA
    } else {
      templateName = 'IAG'
      schema = IAG_SCHEMA
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: `You are an expert Australian insurance building assessor completing a formal ${templateName} insurance assessment report. Use professional language appropriate for insurance assessment reports. For Yes/No fields use exactly "Yes" or "No". For Good/Fair/Poor fields use those exact values. If information cannot be determined from the notes or context, use an empty string "". Pre-populate fields from the provided context where applicable (assessor name, claim number, address, insured name, etc).`,
      messages: [{
        role: 'user',
        content: `Complete the following ${templateName} insurance report template using the raw field notes and context provided. Return ONLY valid JSON (no markdown fences, no explanation).

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
