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

// ── AAI JS Autofill ───────────────────────────────────────────────────────
const AAI_JS_SYSTEM = `You are an expert building inspector at Insurance Repair Co Pty Ltd in Perth, Australia. Convert building inspection field notes and context into a filled JavaScript data object for an insurance form auto-fill script. Return the complete JavaScript script with ONLY the data object values filled from the notes and context. Do not change any field names, comments, or the auto-fill engine code below the data object. Only populate values in the data = { } object. Use "" for any field not mentioned or determinable.`

const AAI_JS_TEMPLATE = `// ============================================================
// SUNCORP REPAIR ASSESSMENT REPORT — AUTO-FILL SCRIPT
// ============================================================
// INSTRUCTIONS:
//   1. Open the report form in MySysWorks
//   2. Press F12 → Console tab
//   3. Paste this entire script and press Enter
//
// EDIT ONLY THE VALUES IN THE 'data' OBJECT BELOW
// Leave a field as "" to skip it (won't overwrite existing value)
// ============================================================

const data = {

  // ── CLAIM INFORMATION ─────────────────────────────────────
  reportDate:            "",        // Format: YYYY-MM-DD
  reportType:            "",             // "Interim" or "Final"
  lodgementDescription:  "",
  claimedLossCause:      "",             // Short text e.g. "Storm", "Burst Pipe", "Fire"
  suncorpAssessor:       "",            // Geoff | Katie | Lachie | David | Peta | Dane | Alex
  assessmentType:        "",   // Dual Assessment | Desktop | Virtual Assessment
  siteAttendanceDatetime:"",  // Format: YYYY-MM-DDTHH:MM (datetime-local)

  // ── OVERALL PROPERTY OBSERVATIONS ─────────────────────────
  maintenanceConcerns:   "",                // "Yes" or "No"
  maintenanceConcernDetails: "",              // Fill if Yes above

  // ── SAFETY CONCERNS ───────────────────────────────────────
  safetyConcerns:        "",               // No | Mould | Asbestos | Electrical Hazards |
                                              // Fall / Trip Hazards | Property Security Issues |
                                              // Access Issues | Pets/ Animals | Other
  safetyConcernDetails:  "",                 // Fill if not "No"

  // ── CAUSE OF DAMAGE ───────────────────────────────────────
  // Template dropdown for areas damaged (select by text):
  areasDamagedTemplate:  "",
  // Rich text - areas damaged detail (MCE editor):
  areasDamagedDetail:    "",

  // Template dropdown for proximate cause:
  proximateCauseTemplate: "",
  // Rich text - proximate cause detail (MCE editor):
  proximateCauseDetail:   "",

  // ── SPECIALIST REPORT ─────────────────────────────────────
  specialistReportObtained: "",            // "Yes" or "No"
  specialistReportSummary:  "",              // Fill if Yes

  // ── DAMAGE TYPE ───────────────────────────────────────────
  damageTermType:        "",     // "Single Event" or "Long Term"
  wearAndTear:           "",                 // Plain text response for wear/tear question (leave "" if n/a)

  // ── WEAR & TEAR ADDITIONAL (only if applicable) ───────────
  wearTearObservations:  "",
  preventativeMeasures:  "",
  customerKnowledgeEvidence: "",

  // ── ASSESSMENT SUMMARY ────────────────────────────────────
  customerConversationTemplate: "",
  // Rich text - general observations (MCE editor):
  generalObservations:   "",

  // ── MAKESAFE / RESTORATION ────────────────────────────────
  makesafeActioned:      "",              // "Yes" or "No"
  makesafeDetails:       "",               // Fill if Yes

  // ── FLOOR PLAN ────────────────────────────────────────────
  floorPlanSupplied:     "",            // "Yes" or "No"

  // ── SPECIALIST REPORT REQUIRED ────────────────────────────
  specialistRequired:    "",             // "Yes" or "No"
  specialistDetails:     "",              // Fill if Yes

  // ── REPAIR DETAILS ────────────────────────────────────────
  nonWarrantableRepairs: "",            // "Yes" or "No"
  nonWarrantableDetails: "",
  ncrdRequired:          "",              // Non-claim issues REQUIRED before repairs
  ncrdRecommended:       "",              // Non-claim issues RECOMMENDED
  matchingIssues:        "",              // Matching of materials concerns

  // ── CLAIM CONSIDERATIONS ──────────────────────────────────
  authorityToProceed:    "",           // "Yes" or "No"
  referToInsurer:        "",            // "Yes" or "No"
  // Referral reason dropdown (only used if referToInsurer = "Yes"):
  referralReason:        "",              // Repair costs are above the authorised limit |
                                          // No resultant damage | Review required for policy coverage |
                                          // Unable to warrant repairs | Liability Purposes |
                                          // Obtain - Customer COD Proof | Under Applicable Excess |
                                          // Refer to Assessor | Multiple COD identified on site |
                                          // Maintenance / NCRD Outstanding - REQUIRED prior to commencing
  // Rich text - referral reason detail (MCE editor):
  referralReasonDetail:  "",
  repairTimeframe:       "",     // Plain text
  tempAccommodation:     "",            // "Yes" or "No"
  tempAccommodationDetails: "",           // Fill if Yes
  recoveryIdentified:    "",              // "" (leave blank) or "Yes"
  recoveryDetails:       "",              // Fill if Yes

};


// ============================================================
// AUTO-FILL ENGINE — DO NOT EDIT BELOW THIS LINE
// ============================================================
(function() {

  // ── FIND THE REPORT FORM CONTAINER ──────────────────────
  // The container ID ends with a session number that changes each page load.
  // We find it dynamically by prefix.
  const container = document.querySelector('[id^="job_question_list_"]');
  if (!container) {
    console.error('❌ Report form container not found. Make sure the form is open.');
    return;
  }

  // Get all form fields in DOM order (this is the reliable index-based map)
  const fields = container.querySelectorAll('input:not([type=hidden]), select, textarea');

  // ── HELPER: set a native input value and trigger React/KO events ──
  function setVal(el, value) {
    if (!el) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(el.constructor.prototype || window.HTMLInputElement.prototype, 'value')?.set
                      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── HELPER: click a radio button by ko_unique name + value ──
  function setRadio(koName, value) {
    const radio = container.querySelector(\`input[type="radio"][name="\${koName}"][value="\${value}"]\`);
    if (radio) {
      radio.click();
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn(\`⚠️ Radio not found: name="\${koName}" value="\${value}"\`);
    }
  }

  // ── HELPER: set a <select> by option text (since many have empty values) ──
  function setSelectByText(selectEl, text) {
    if (!selectEl || !text) return;
    for (const opt of selectEl.options) {
      if (opt.text.trim() === text) {
        selectEl.value = opt.value;
        // Also set selectedIndex for KO compatibility
        selectEl.selectedIndex = opt.index;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
    console.warn(\`⚠️ Option "\${text}" not found in select\`);
  }

  // ── HELPER: set TinyMCE rich text editor ──
  function setMCE(editorId, html) {
    if (!html) return;
    if (typeof tinymce !== 'undefined') {
      // Try dynamic ID (changes per session) — find by known static prefix
      const allEditors = tinymce.editors;
      const prefix = editorId.split('_').slice(0, 2).join('_'); // e.g. "mceEditor_422"
      const editor = allEditors.find(e => e.id.startsWith(prefix));
      if (editor) {
        editor.setContent(html);
        editor.save(); // sync back to textarea
        return;
      }
    }
    // Fallback: set textarea directly
    const ta = container.querySelector(\`textarea[id^="\${editorId.split('_').slice(0,2).join('_')}"]\`);
    if (ta) setVal(ta, html);
    else console.warn(\`⚠️ MCE editor not found: \${editorId}\`);
  }

  // ── FIELD MAP (index within #job_question_list_*) ────────
  // [0]  INPUT date        → Report Date
  // [1]  RADIO ko_unique_1 → Type of Report: Interim
  // [2]  RADIO ko_unique_2 → Type of Report: Final
  // [3]  TEXTAREA          → Lodgement Description
  // [4]  INPUT text        → Claimed Loss Cause
  // [5]  SELECT [0]        → Suncorp Assessor
  // [6]  SELECT [1]        → Assessment Type
  // [7]  INPUT datetime-local → Site Attendance date/time
  // [8]  RADIO ko_unique_3 → Maintenance concerns: Yes
  // [9]  RADIO ko_unique_4 → Maintenance concerns: No
  // [10] TEXTAREA          → If Yes, maintenance concern details
  // [11] SELECT [2]        → Safety concerns dropdown
  // [12] TEXTAREA          → Safety concern details
  // [13] SELECT [3]        → Areas damaged template
  // [14] TEXTAREA (MCE)    → Areas damaged detail  [mceEditor_422_*]
  // [15] SELECT [4]        → Proximate cause template
  // [16] TEXTAREA (MCE)    → Proximate cause detail [mceEditor_423_*]
  // [17] RADIO ko_unique_5 → Specialist report: Yes
  // [18] RADIO ko_unique_6 → Specialist report: No
  // [19] TEXTAREA          → Specialist report summary
  // [20] SELECT [5]        → Single Event / Long Term
  // [21] TEXTAREA          → Wear/tear response
  // [22] TEXTAREA          → Wear/tear observations
  // [23] TEXTAREA          → Preventative measures
  // [24] TEXTAREA          → Customer knowledge (inevitable?)
  // [25] TEXTAREA          → Evidence customer should have known
  // [26] SELECT [6]        → Customer conversation template
  // [27] TEXTAREA (MCE)    → General observations [mceEditor_435_*]
  // [28] TEXTAREA          → General observations (plain textarea mirror)
  // [29] RADIO ko_unique_7 → Makesafe actioned: Yes
  // [30] RADIO ko_unique_8 → Makesafe actioned: No
  // [31] TEXTAREA          → Makesafe works carried out
  // [32] RADIO ko_unique_9 → Floor plan supplied: Yes
  // [33] RADIO ko_unique_10 → Floor plan supplied: No
  // [34] RADIO ko_unique_11 → Specialist required: Yes
  // [35] RADIO ko_unique_12 → Specialist required: No
  // [36] TEXTAREA          → Specialist required details
  // [37] RADIO ko_unique_13 → Non-warrantable repairs: Yes
  // [38] RADIO ko_unique_14 → Non-warrantable repairs: No
  // [39] TEXTAREA          → Non-warrantable repairs detail
  // [40] TEXTAREA          → NCRD Required
  // [41] TEXTAREA          → NCRD Recommended
  // [42] TEXTAREA          → Matching materials issues
  // [43] RADIO ko_unique_15 → Authority to proceed: Yes
  // [44] RADIO ko_unique_16 → Authority to proceed: No
  // [45] RADIO ko_unique_17 → Refer to insurer: Yes
  // [46] RADIO ko_unique_18 → Refer to insurer: No
  // [47] SELECT [7]        → Referral reason dropdown
  // [48] TEXTAREA (MCE)    → Referral reason detail [mceEditor_453_*]
  // [49] INPUT text        → Repair timeframe
  // [50] RADIO ko_unique_19 → Temp accommodation: Yes
  // [51] RADIO ko_unique_20 → Temp accommodation: No
  // [52] TEXTAREA          → Temp accommodation details
  // [53] SELECT [8]        → Recovery identified (Yes or blank)
  // [54] TEXTAREA          → Recovery details

  const f = fields; // shorthand

  // ── FILL FIELDS ──────────────────────────────────────────

  // Report Date
  if (data.reportDate) setVal(f[0], data.reportDate);

  // Report Type radio
  if (data.reportType === 'Interim')  setRadio('ko_unique_1', 'Interim');
  if (data.reportType === 'Final')    setRadio('ko_unique_2', 'Final');

  // Lodgement Description
  if (data.lodgementDescription) setVal(f[3], data.lodgementDescription);

  // Claimed Loss Cause
  if (data.claimedLossCause) setVal(f[4], data.claimedLossCause);

  // Suncorp Assessor
  setSelectByText(f[5], data.suncorpAssessor);

  // Assessment Type
  setSelectByText(f[6], data.assessmentType);

  // Site Attendance datetime-local
  if (data.siteAttendanceDatetime) setVal(f[7], data.siteAttendanceDatetime);

  // Maintenance concerns
  if (data.maintenanceConcerns === 'Yes') setRadio('ko_unique_3', 'Yes');
  if (data.maintenanceConcerns === 'No')  setRadio('ko_unique_4', 'No');
  if (data.maintenanceConcernDetails)     setVal(f[10], data.maintenanceConcernDetails);

  // Safety concerns
  setSelectByText(f[11], data.safetyConcerns);
  if (data.safetyConcernDetails) setVal(f[12], data.safetyConcernDetails);

  // Areas damaged
  setSelectByText(f[13], data.areasDamagedTemplate);
  setMCE('mceEditor_422', data.areasDamagedDetail);

  // Proximate cause
  setSelectByText(f[15], data.proximateCauseTemplate);
  setMCE('mceEditor_423', data.proximateCauseDetail);

  // Specialist report obtained
  if (data.specialistReportObtained === 'Yes') setRadio('ko_unique_5', 'Yes');
  if (data.specialistReportObtained === 'No')  setRadio('ko_unique_6', 'No');
  if (data.specialistReportSummary)            setVal(f[19], data.specialistReportSummary);

  // Single event / long term
  setSelectByText(f[20], data.damageTermType);
  if (data.wearAndTear)              setVal(f[21], data.wearAndTear);
  if (data.wearTearObservations)     setVal(f[22], data.wearTearObservations);
  if (data.preventativeMeasures)     setVal(f[23], data.preventativeMeasures);
  if (data.customerKnowledgeEvidence) setVal(f[25], data.customerKnowledgeEvidence);

  // Customer conversation + general observations
  setSelectByText(f[26], data.customerConversationTemplate);
  setMCE('mceEditor_435', data.generalObservations);

  // Makesafe
  if (data.makesafeActioned === 'Yes') setRadio('ko_unique_7', 'Yes');
  if (data.makesafeActioned === 'No')  setRadio('ko_unique_8', 'No');
  if (data.makesafeDetails)            setVal(f[31], data.makesafeDetails);

  // Floor plan
  if (data.floorPlanSupplied === 'Yes') setRadio('ko_unique_9',  'Yes');
  if (data.floorPlanSupplied === 'No')  setRadio('ko_unique_10', 'No');

  // Specialist required
  if (data.specialistRequired === 'Yes') setRadio('ko_unique_11', 'Yes');
  if (data.specialistRequired === 'No')  setRadio('ko_unique_12', 'No');
  if (data.specialistDetails)            setVal(f[36], data.specialistDetails);

  // Non-warrantable repairs
  if (data.nonWarrantableRepairs === 'Yes') setRadio('ko_unique_13', 'Yes');
  if (data.nonWarrantableRepairs === 'No')  setRadio('ko_unique_14', 'No');
  if (data.nonWarrantableDetails)           setVal(f[39], data.nonWarrantableDetails);
  if (data.ncrdRequired)                    setVal(f[40], data.ncrdRequired);
  if (data.ncrdRecommended)                 setVal(f[41], data.ncrdRecommended);
  if (data.matchingIssues)                  setVal(f[42], data.matchingIssues);

  // Claim considerations
  if (data.authorityToProceed === 'Yes') setRadio('ko_unique_15', 'Yes');
  if (data.authorityToProceed === 'No')  setRadio('ko_unique_16', 'No');
  if (data.referToInsurer === 'Yes')     setRadio('ko_unique_17', 'Yes');
  if (data.referToInsurer === 'No')      setRadio('ko_unique_18', 'No');
  setSelectByText(f[47], data.referralReason);
  setMCE('mceEditor_453', data.referralReasonDetail);
  if (data.repairTimeframe)              setVal(f[49], data.repairTimeframe);

  // Temp accommodation
  if (data.tempAccommodation === 'Yes') setRadio('ko_unique_19', 'Yes');
  if (data.tempAccommodation === 'No')  setRadio('ko_unique_20', 'No');
  if (data.tempAccommodationDetails)    setVal(f[52], data.tempAccommodationDetails);

  // Recovery
  setSelectByText(f[53], data.recoveryIdentified === 'Yes' ? 'Yes' : '--- Select ---');
  if (data.recoveryDetails) setVal(f[54], data.recoveryDetails);

  console.log('✅ Auto-fill complete! Review the form, then click Save or Complete.');

})();`

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

    let javascript: string | undefined
    if (template === 'aai') {
      const jsMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: AAI_JS_SYSTEM,
        messages: [{
          role: 'user',
          content: `Convert this building report dictation into the data = { } JavaScript object below. Use the exact field names shown. Only change the values — do not rename any keys. Leave fields as "" if not mentioned.

MY DICTATION:
[${rawNotes}]

Context:
[${contextLines}]

TEMPLATE TO FILL:
[${AAI_JS_TEMPLATE}]`,
        }],
      })
      const jsContent = jsMessage.content[0]
      if (jsContent.type === 'text') {
        javascript = jsContent.text
      }
    }

    return NextResponse.json({ ok: true, fields, ...(javascript !== undefined && { javascript }) })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate report', details: String(error) }, { status: 500 })
  }
}
