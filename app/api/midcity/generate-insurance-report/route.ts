import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

// ── AAI JS Autofill ───────────────────────────────────────────────────────
const AAI_JS_SYSTEM = `You are an expert building inspector in Perth, Australia. Write formal, factual insurance building assessment reports. Your style must be cold, clinical and professional - no first person language except where the format explicitly requires it. Never use phrases like "I observed", "it appears", "I believe", or "I noted". Never speculate beyond what the evidence supports. Do not include any em dashes - use hyphens or alternative punctuation instead.

Return only the complete filled JavaScript script. No preamble, no markdown code fences, no explanation - just the raw JavaScript.`

const AAI_JS_TEMPLATE = `// ============================================================
// SUNCORP REPAIR ASSESSMENT REPORT — AUTO-FILL SCRIPT
// ============================================================
// INSTRUCTIONS:
//   1. Open the report form in MySysWorks
//   2. Press F12 → Console tab
//   3. Paste this entire script and press Enter
// ============================================================

(function() {

var data = {

  // ── CLAIM INFORMATION ─────────────────────────────────────
  reportDate:            "",        // Format: YYYY-MM-DD
  reportType:            "Final",             // always use "Final"
  claimedLossCause:      "",             // Short text e.g. "Storm", "Burst Pipe", "Fire"

  // ── OVERALL PROPERTY OBSERVATIONS ─────────────────────────
  maintenanceConcerns:   "No",                // always fill with "No"
  maintenanceConcernDetails: "N/A",              // Always fill with "N/A"

  // ── SAFETY CONCERNS ───────────────────────────────────────
  safetyConcerns:        "No",               // always fill with "No"
  safetyConcernDetails:  "N/A",                 // Always fill with "N/A"

  // ── CAUSE OF DAMAGE ───────────────────────────────────────
  // Rich text - areas damaged detail (MCE editor):
  areasDamagedDetail:    "",       // Always start with "I observed the following resulting damage during my inspection:" and then enter a bullet list of observed damage. Each line: "• [Room] - [type of damage] [measurement if known]". Use a sub-bullet (-) only if scope needs clarifying. One line per item. If multiple items in a room or similar items across multiple rooms, group them: "• [Room] - [damage 1], [damage 2]" or "• [Room 1], [Room 3] - [damage]". No cause or opinion - observations only.

  // Rich text - proximate cause detail (MCE editor):
  proximateCauseDetail:   "",          // Bullet point analysis of the cause. First bullet: "• Primary cause - [type]". Sub-bullets are one-line evidence observations. Include Australian Standard references inline. No first person. Each secondary cause gets its own "• Primary cause" line. Keep sub bullets to a minimum (1 or 2 sub bullets per primary cause) and have them help explain the primary bullet point, not just repeat it in different wording.

  // ── SPECIALIST REPORT ─────────────────────────────────────
  specialistReportObtained: "No",            // "Yes" or "No", If there are details of a roof report in the dictation then answer should be "Yes"
  specialistReportSummary:  "",              // Fill if Yes

  // ── DAMAGE TYPE ───────────────────────────────────────────
  damageTermType:        "Single Event",     // "Single Event" or "Long Term"
  wearAndTear:           "",                 // "No" if (damageTermType = "Single Event") or "Yes" if (damageTermType = "Long Term")

  // ── WEAR & TEAR ADDITIONAL (only if applicable) ───────────
  wearTearObservations:  "",   // "N/A" if (damageTermType = "Single Event"), or plain text answering (What did you observe and what visible evidence is there that the damage was caused by wear, tear, gradual deterioration or a gradual leak?) if (damageTermType = "Long Term")
  preventativeMeasures:  "",    // "N/A" if (damageTermType = "Single Event"), or plain text answering (What repairs and/or preventative measures, if completed before the event could have prevented the loss/damage) if (damageTermType = "Long Term")
  customerKnowledgeEvidence: "",    // "N/A" if (damageTermType = "Single Event"), or plain text answering (In respect to damage identified in previous question, did the customer know or should the customer have reasonably known that the damage was inevitable and/or that the proximate cause of damage was occurring?) if (damageTermType = "Long Term")

  // ── ASSESSMENT SUMMARY ────────────────────────────────────
  customerConversationTemplate: "Storm - Client Discussion",
  customerConversationDetail: "",   // Plain text outlining what the customer or homeowner or insured is claiming or what they have said
  // Rich text - general observations (MCE editor):
  generalObservations:   "",   // Leave blank unless specific additional notes or notable observations impact the report or claim.

  // ── MAKESAFE / RESTORATION ────────────────────────────────
  makesafeActioned:      "No",              // "Yes" or "No", use "No" as default or if unsure
  makesafeDetails:       "N/A",               // Plain text if (makesafeActioned = "Yes"), if (makesafeActioned = "No") then fill with "N/A"

  // ── FLOOR PLAN ────────────────────────────────────────────
  floorPlanSupplied:     "No",            // "Yes" or "No", use "No" as default or if unsure

  // ── SPECIALIST REPORT REQUIRED ────────────────────────────
  specialistRequired:    "No",             // "Yes" or "No", use "No" as default or if unsure
  specialistDetails:     "N/A",              // plain text if (specialistRequired = "Yes"), if (specialistRequired = "No") then fill with "N/A"

  // ── REPAIR DETAILS ────────────────────────────────────────
  nonWarrantableRepairs: "No",            // "Yes" or "No", use "No" as default or if unsure
  nonWarrantableDetails: "N/A",    // plain text answering "If Yes, explain in detail and include reference to Building Laws and Regulations where applicable" if (nonWarrantableRepairs = "Yes") or "N/A" if (nonWarrantableRepairs = "No")
  ncrdRequired:          "None",              // Non-claim issues REQUIRED before repairs in "•" point form. Use "None" if none are required, not applicable or if unsure.
  ncrdRecommended:       "None",              // Non-claim issues RECOMMENDED in "•" point form. Use "None" if none are required, not applicable or if unsure.
  matchingIssues:        "None",              // Matching of materials concerns, Use "None" if none are required, not applicable or if unsure.

  // ── CLAIM CONSIDERATIONS ──────────────────────────────────
  authorityToProceed:    "Yes",           // "Yes" or "No"
  referToInsurer:        "No",            // "Yes" or "No"
  // Referral reason dropdown (only used if referToInsurer = "Yes"):
  referralReason:        "",              // Repair costs are above the authorised limit |
                                          // No resultant damage | Review required for policy coverage |
                                          // Unable to warrant repairs | Liability Purposes |
                                          // Obtain - Customer COD Proof | Under Applicable Excess |
                                          // Refer to Assessor | Multiple COD identified on site |
                                          // Maintenance / NCRD Outstanding - REQUIRED prior to commencing
  // Rich text - referral reason detail (MCE editor):
  referralReasonDetail:  "",
  repairTimeframe:       "4-6 weeks",     // Plain text
  tempAccommodation:     "No",            // "Yes" or "No", use "No" as default or if unsure
  tempAccommodationDetails: "N/A",           // Plain text if Yes, use "N/A" as default or if unsure
  recoveryIdentified:    "",              // "" (leave blank) or "Yes"
  recoveryDetails:       "N/A",              // use "N/A" as default or if unsure

};

// ============================================================
// AUTO-FILL ENGINE — DO NOT EDIT BELOW THIS LINE
// ============================================================

  var container = document.querySelector('[id^="job_question_list_"]');
  if (!container) { console.error('Report form container not found.'); return; }

  var f = container.querySelectorAll('input:not([type=hidden]), select, textarea');

  function setVal(el, value) {
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setRadio(koName, value) {
    var radio = container.querySelector('input[type="radio"][name="' + koName + '"][value="' + value + '"]');
    if (!radio) return;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelectByText(selectEl, text) {
    if (!selectEl || !text) return;
    for (var i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].text.trim() === text) {
        selectEl.value = selectEl.options[i].value;
        selectEl.selectedIndex = i;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  }

  function setMCE(editorId, html) {
    if (!html) return;
    var prefix = editorId.split('_').slice(0, 2).join('_');
    if (typeof tinymce !== 'undefined') {
      var eds = tinymce.editors;
      if (Array.isArray(eds)) {
        for (var i = 0; i < eds.length; i++) {
          if (eds[i] && eds[i].id && eds[i].id.indexOf(prefix) === 0) { eds[i].setContent(html); eds[i].save(); return; }
        }
      } else {
        for (var id in eds) {
          if (eds.hasOwnProperty(id) && id.indexOf(prefix) === 0) { eds[id].setContent(html); eds[id].save(); return; }
        }
      }
    }
    var ta = container.querySelector('textarea[id^="' + prefix + '"]');
    if (ta) setVal(ta, html);
  }

  if (data.reportDate)               setVal(f[0],  data.reportDate);
  if (data.reportType === 'Interim') setRadio('ko_unique_1', 'Interim');
  if (data.reportType === 'Final')   setRadio('ko_unique_2', 'Final');
  if (data.lodgementDescription)     setVal(f[3],  data.lodgementDescription);
  if (data.claimedLossCause)         setVal(f[4],  data.claimedLossCause);
  setRadio('ko_unique_4', 'No');
  setVal(f[10], 'N/A');
  setSelectByText(f[11], 'No');
  setVal(f[12], 'N/A');
  setMCE('mceEditor_422', data.areasDamagedDetail);
  setMCE('mceEditor_423', data.proximateCauseDetail);
  if (data.specialistReportObtained === 'Yes') setRadio('ko_unique_5', 'Yes');
  if (data.specialistReportObtained === 'No')  setRadio('ko_unique_6', 'No');
  if (data.specialistReportSummary)        setVal(f[19], data.specialistReportSummary);
  setSelectByText(f[20], data.damageTermType);
  if (data.wearAndTear)                    setVal(f[21], data.wearAndTear);
  if (data.wearTearObservations)           setVal(f[22], data.wearTearObservations);
  if (data.preventativeMeasures)           setVal(f[23], data.preventativeMeasures);
  if (data.customerKnowledgeEvidence)      setVal(f[25], data.customerKnowledgeEvidence);
  setSelectByText(f[26], data.customerConversationTemplate);
  setMCE('mceEditor_435', data.generalObservations);
  if (data.makesafeActioned === 'Yes') setRadio('ko_unique_7', 'Yes');
  if (data.makesafeActioned === 'No')  setRadio('ko_unique_8', 'No');
  if (data.makesafeDetails)            setVal(f[31], data.makesafeDetails);
  if (data.floorPlanSupplied === 'Yes') setRadio('ko_unique_9',  'Yes');
  if (data.floorPlanSupplied === 'No')  setRadio('ko_unique_10', 'No');
  if (data.specialistRequired === 'Yes') setRadio('ko_unique_11', 'Yes');
  if (data.specialistRequired === 'No')  setRadio('ko_unique_12', 'No');
  if (data.specialistDetails)            setVal(f[36], data.specialistDetails);
  if (data.nonWarrantableRepairs === 'Yes') setRadio('ko_unique_13', 'Yes');
  if (data.nonWarrantableRepairs === 'No')  setRadio('ko_unique_14', 'No');
  if (data.nonWarrantableDetails)        setVal(f[39], data.nonWarrantableDetails);
  if (data.ncrdRequired)                 setVal(f[40], data.ncrdRequired);
  if (data.ncrdRecommended)              setVal(f[41], data.ncrdRecommended);
  if (data.matchingIssues)               setVal(f[42], data.matchingIssues);
  if (data.authorityToProceed === 'Yes') setRadio('ko_unique_15', 'Yes');
  if (data.authorityToProceed === 'No')  setRadio('ko_unique_16', 'No');
  if (data.referToInsurer === 'Yes')     setRadio('ko_unique_17', 'Yes');
  if (data.referToInsurer === 'No')      setRadio('ko_unique_18', 'No');
  setSelectByText(f[47], data.referralReason);
  setMCE('mceEditor_453', data.referralReasonDetail);
  if (data.repairTimeframe)              setVal(f[49], data.repairTimeframe);
  if (data.tempAccommodation === 'Yes') setRadio('ko_unique_19', 'Yes');
  if (data.tempAccommodation === 'No')  setRadio('ko_unique_20', 'No');
  if (data.tempAccommodationDetails)    setVal(f[52], data.tempAccommodationDetails);
  if (data.recoveryIdentified === 'Yes') setSelectByText(f[53], 'Yes');
  setVal(f[54], 'N/A');

  console.log('Auto-fill complete! Review the form, then click Save or Complete.');

})();`

// ── IAG JS Autofill ───────────────────────────────────────────────────────
const IAG_JS_SYSTEM = `You are an expert building inspector in Perth, Australia. Write formal, factual insurance building assessment reports. Your style must be cold, clinical and professional - no first person language except where the format explicitly requires it. Never use phrases like "I observed", "it appears", "I believe", or "I noted". Never speculate beyond what the evidence supports. Do not include any em dashes - use hyphens or alternative punctuation instead.

Return only the complete filled JavaScript script. No preamble, no markdown code fences, no explanation - just the raw JavaScript.`

const IAG_JS_TEMPLATE = `// ============================================================
// IAG ASSESSMENT REPORT — AUTO-FILL SCRIPT
// ============================================================
// INSTRUCTIONS:
//   1. Open the IAG Assessment Report form in MySysWorks
//   2. Press F12 → Console tab
//   3. Paste this entire script and press Enter
// ============================================================

(function() {

var data = {

  // ── BASIC INFORMATION ─────────────────────────────────────
  incidentType:          "",        // Select from: Accidental Loss or Damage | Age, Wear and Tear |
                                    // Animal | Burglary | Cracking | Earthquake | Electric Motor Fusion |
                                    // Escape of Liquids | Explosion | Fire or Smoke | Flood |
                                    // Glass Breakage | Home Warranty Defects | Home Warranty Uncompleted Works |
                                    // Impact by Animals | Impact by Falling Trees | Impact or Collision by Vehicle |
                                    // Impact or Collision by Watercraft | Lightning or Thunderbolt | Maintenance |
                                    // Malicious Act or Vandalism | Mould | Other | Pets or Vermin | Rectification |
                                    // Riot, Civil Commotion or Public Disturbance | Storm or Rainwater |
                                    // Theft and / or Damage by Thieves | Tsunami | WA Bushfires 01-02-2021 |
                                    // WA Cyclone Seroja

  makeSafeRequired:      "No",      // "Yes" or "No"
  makeSafeConducted:     "No",      // "Yes" or "No"
  makeSafeType:          "",        // Plain text description of make safe type if makeSafeRequired = "Yes", else ""
  makeSafeDate:          "",        // Date format YYYY-MM-DD if makeSafeRequired = "Yes", else ""

  specialistReportObtained: "No",   // "Yes" or "No". If there are details of a roof report in the dictation answer should be "Yes"
  specialistType:        "",        // Plain text e.g. "Roofer" if specialistReportObtained = "Yes", else ""
  droneUtilised:         "N/A",     // "Yes", "No", or "N/A"

  // ── PROPERTY DETAILS ──────────────────────────────────────
  buildingAge:           "",        // Select nearest: 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |
                                    // 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | 100 +
  condition:             "",        // Select from: Average | Dilapidated | Excellent | Fair | Good |
                                    // Poor | Poorly Maintained | Ruin | Un-inhabitable | Unsound | Well Maintained
  roofType:              "",        // Select from: Aluminium Sheet | Asbestos | Cement Tiled |
                                    // Corrugated Compressed Fibre | Corrugated Fibro | Decromastic Tiled |
                                    // Metal Corrugated | Metal Deck | Other | Shingle | Slate Tiled |
                                    // Terracotta Tiled | Tile / Metal | Zincalume
  wallType:              "",        // Select from: Brick | Brick Veneer | Compressed Fibre | Concrete Panel |
                                    // Double Brick | Metal Sheet | Other | Rammed Earth | Rendered |
                                    // Solid Board | Steel Framed and Cladded | Stone |
                                    // Timber Framed and Cladded | Weatherboard
  storeys:               "",        // Select: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 +
  foundation:            "",        // Select from: Brick | Cement | Concrete Floating Slab |
                                    // Concrete Monolithic Slab | Concrete Supported Slab | Other | Sand |
                                    // Steel Poles | Timber on Brick Stumps | Timber on Concrete Stumps |
                                    // Timber on Steel Stumps | Timber on Timber Stumps | Timber Poles
  fenceType:             "None",    // Select from: Hardie Fence | Asbestos Super 6 (pre-1990) | Super 6 |
                                    // Pickett | Colorbond | Brushwood | Farm Fence | Wire Fence |
                                    // Wrought Iron Fencing | Brick | Other - specify in conclusion
                                    // Use "None" if not applicable or unknown
  fenceAge:              "",        // Select nearest age or "" if fenceType = "None"
  tempFenceRequired:     "No",      // "Yes" or "No"
  detachedGarage:        "No",      // "Yes" or "No"
  sheds:                 "No",      // "Yes" or "No"
  swimmingPool:          "No",      // "Yes" or "No"
  detachedGrannyFlat:    "No",      // "Yes" or "No"

  // ── CLIENT DISCUSSIONS ────────────────────────────────────
  clientDiscussionTemplate: "Storm - Client Discussion",
                                    // Select from: Storm - Client Discussion |
                                    // Fence Template - Client Discussion |
                                    // EOL (Burst Pipe) - Client Discussion |
                                    // Vehicle IMPACT - Client Discussion |
                                    // EOL (WaterProof Failure) - Client Discussion |
                                    // FIRE - Client Discussion |
                                    // Tree IMPACT - Client Discussion |
                                    // Adhesive Failure - Client Discussion |
                                    // RetainingWall - Client Discussion |
                                    // Balcony Ingress - Client Discussion |
                                    // EnviromentalMOULD - Client Discussion |
                                    // Impact - Garage Door

  // Rich text - client discussion (MCE editor):
  clientDiscussionDetail: "",       // Plain text outlining what the customer/homeowner/insured is claiming or has said

  // ── RESULTANT DAMAGE ──────────────────────────────────────
  tarpInstalled:         "No",      // "Yes" or "No" - was a tarp installed to protect roof damage?
  mainDamageType:        "",        // Select from: Ceiling | Door | External Areas | Fencing | Fire |
                                    // Flooring | Internal Areas | Roof | Water
  resultantDamageTemplate: "",      // Select from: Storm - Resultant Damage | Storm - Ceiling Replacement |
                                    // Storm - Painting Only - Ceiling | Storm - Painting only - Walls |
                                    // EOL (Burst Pipe ) - Resultant Damage | Fence Hardie Template - Resultant Damage |
                                    // Fence Asbestos Template -Resultant Damage |
                                    // Vehicle IMPACT - Resultant Damage |
                                    // EOL (WaterProof Failure) - Resultant damage | FIRE - Resultant Damge |
                                    // Tree IMPACT - Resultant Damage | Adhesive Failure - Resultant Damage |
                                    // RetainingWall - Resultant Damage | Balcony Ingress - Resultant Damage |
                                    // EnviromentalMOULD - Resultant Damage | Impact - Garage Door |
                                    // TC Alfred - Resultant Damage

  // Rich text - resultant damage detail (MCE editor):
  resultantDamageDetail:  "",       // Always start with "The following resultant damage was identified during inspection:" and then enter a bullet list of observed damage. Each line: "• [Room] - [type of damage] [measurement if known]". Use a sub-bullet (-) only if scope needs clarifying. One line per item. If multiple items in a room or similar items across multiple rooms, group them. No cause or opinion - observations only.

  listedEvent:           "Yes",     // "Yes" or "No" - was the damage caused by a listed event?
  mainRoofDamage:        "No",      // "Yes" or "No" - is the main damage to the roof?

  causeOfDamageTemplate: "",        // Select from: Storm - Roof Report Arranged COD |
                                    // Storm - Groundwater runoff | Storm - Roof Tile - COD |
                                    // Storm - Valley/Gutter Overflow-Blocked COD |
                                    // EOL (Burst Pipe) Sudden - COD | Fence Hardie Template - - COD |
                                    // Fence Asbestos Template - COD | Vehicle IMPACT - COD |
                                    // EOL (WaterProof Failure) - COD | FIRE - COD |
                                    // Tree IMPACT - COD | Adhesive Failure - COD |
                                    // RetainingWall - COD | Balcony Ingress - COD |
                                    // EnviromentalMOULD - COD | Impact - Garage Door |
                                    // TC Alfred - COD - Fencing | TC Alfred - COD - Wind Driven Rain

  // Rich text - cause of damage detail (MCE editor):
  causeOfDamageDetail:    "",       // Bullet point analysis of the cause. First bullet: "• Primary cause - [type]". Sub-bullets are one-line evidence observations. Include Australian Standard references inline. No first person. Each secondary cause gets its own "• Primary cause" line. Keep sub-bullets to a minimum (1 or 2 per primary cause) and have them help explain the primary bullet point, not just repeat it in different wording.

  // ── DEFECT ISSUES AND MAINTENANCE ────────────────────────
  defectIssues:          "None",    // Plain text describing defect-related issues directly responsible or contributing to damage. Use "None" if none.
  maintenanceDamageDesc: "None",    // Plain text describing maintenance directly relating to the damage (e.g. cracked roof tile). Use "None" if none.
  maintenanceTemplate:   "NO maintenance identified",
                                    // Select from: NO maintenance identified | Maintenance General |
                                    // Storm - Additional Downpipe | Storm - Capping/Rebedding |
                                    // Storm - Gutters / Valley | EOL (Burst Pipe ) - Maintenance |
                                    // EOL (WaterProof Failure) - Maintenance | Balcony Ingress - Maintenance

  // Rich text - maintenance details (MCE editor):
  maintenanceDetail:     "N/A",     // Plain text describing what maintenance the insured/owner must complete prior to repairs, or "N/A" if none

  maintenanceEstimate:   "",        // Dollar amount if maintenance works have a cost, else ""
  otherMaintenanceComments: "None", // Any other comments regarding maintenance NOT directly related to the event, or "None"
  insuredAwareOfRepairs: "No",      // "Yes" or "No" - is the insured aware of repairs they are responsible for?

  // ── RECOMMENDATION ────────────────────────────────────────
  recommendation:        "Accept",  // Select from: Accept |
                                    // Accept - Review: Client seeks alternate settlement method |
                                    // Accept - Review: Cannot warrant the work |
                                    // Accept - Review: Component of claim requires cash settling |
                                    // Accept - Review: Maintenance required by customer |
                                    // Accept - Review: Replacement Required |
                                    // Accept - Cash Settlement Required |
                                    // Do Not Accept - Not Covered |
                                    // Unsure - Policy Coverage |
                                    // Cancel - Under Excess |
                                    // Cancel - Client Wishes to Withdraw Claim |
                                    // Cancel - No Resultant Damage

  conclusionTemplate:    "",        // Select from: Storm - Singular Event | Storm - Hail |
                                    // Conclusion - Age,wear,tear / Deterioation |
                                    // EOL (Burst Pipe ) - Conclusion |
                                    // Fence Template - Shared Fence - Conclusion |
                                    // Fence Template - Wholly Owned |
                                    // Vehicle IMPACT - Conclusion |
                                    // EOL (WaterProof Failure) - Conclusion | FIRE - Conclusion |
                                    // Tree IMPACT - Conclusion | Adhesive Failure - Conclusion |
                                    // RetainingWall - Conclusion | Balcony Ingress - Conclusion |
                                    // EnviromentalMOULD - Conclusion | Impact - Garage Door |
                                    // TC Alfred - Conclusion- Fencing | TC Alfred - Conclusion- Wind Driven Rain

  // Rich text - conclusion/summary of findings (MCE editor):
  conclusionDetail:       "",       // Plain text summary of findings. 1 or 2 sentences maximum. Eg. "I am of the opinion that the damage being claimed to the property is consistent with water entry in a storm event." Or "I am of the opinion that the damage being claimed to the property is consistent with age and gradual deterioration over a period of time and the damage has not been caused by a singular event."

  tempAccommImmediate:   "No",      // "Yes" or "No" - is immediate temp accommodation required?
  tempAccommImmediateTimeframe: "", // Timeframe if tempAccommImmediate = "Yes", else ""
  tempRepairsRequired:   "",        // Plain text describing temporary repairs to make home liveable, or "" if N/A
  tempAccommDuringRepairs: "No",    // "Yes" or "No" - is temp accommodation required during repairs?
  tempAccommRepairsTimeframe: "",   // Timeframe if tempAccommDuringRepairs = "Yes", else ""
  worksDuringAccomm:     "",        // Plain text describing works to complete while insured in temp accommodation, or "" if N/A

  // ── SPECIAL NOTES ─────────────────────────────────────────
  specialNotesTemplate:  "",        // Select from: Shared Fence Note | Unable to Match - Flooring | or "" if none
  specialNotesDetail:    "",        // Plain text special notes, or "" if none

  // ── INTERNAL USE ONLY ─────────────────────────────────────
  sumInsuredAdequate:    "Yes",     // "Yes" or "No"
  overallConditionAcceptable: "Yes", // "Yes" or "No"
  propertySize:          "",        // Estimate in square metres, numeric only
  isHabitable:           "Yes",     // "Yes" or "No"
  mould:                 "No",      // "Yes" or "No"
  otherHazards:          "",        // Plain text if any hazards on site, else ""
  asbestosOnSite:        "No",      // "Yes" or "No"
  incidentConfirmed:     "Yes",     // "Yes" or "No"
  claimRecommendation:   "Accept",  // "Accept" or "Reject"
  unableToWarrantReason: "",        // Plain text if claimRecommendation = "Reject" or recommendation includes "Cannot warrant", else ""
  iagRepRequired:        "No",      // "Yes" or "No" - is risk assessment by IAG representative required?
  clientWilling:         "Yes",     // "Yes" or "No" - is the client willing to proceed?
  insuredAdvised:        "Yes",     // "Yes" or "No" - has the insured been advised of next steps?
  furtherInformation:    "",        // Any further information the insurance company needs to know (property for sale, previous claim, police report, etc.), or "" if none

};

// ============================================================
// AUTO-FILL ENGINE — DO NOT EDIT BELOW THIS LINE
// ============================================================

  var container = document.querySelector('[id^="job_question_list_"]');
  if (!container) { console.error('Report form container not found.'); return; }

  var f = container.querySelectorAll('input:not([type=hidden]), select, textarea');

  function setVal(el, value) {
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setRadio(el) {
    if (!el) return;
    el.click();
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelectByText(selectEl, text) {
    if (!selectEl || !text) return;
    for (var i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].text.trim() === text) {
        selectEl.value = selectEl.options[i].value;
        selectEl.selectedIndex = i;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  }

  function setMCE(index, html) {
    if (!html) return;
    if (typeof tinymce !== 'undefined') {
      var eds = tinymce.editors;
      var edArr = Array.isArray(eds) ? eds : Object.values(eds);
      if (edArr[index]) {
        edArr[index].setContent(html);
        edArr[index].save();
        return;
      }
    }
    var tas = container.querySelectorAll('textarea');
    if (tas[index]) setVal(tas[index], html);
  }

  // ── BASIC INFORMATION ─────────────────────────────────────
  setSelectByText(f[0], data.incidentType);
  if (data.makeSafeRequired === 'Yes') setRadio(f[1]); else setRadio(f[2]);
  if (data.makeSafeConducted === 'Yes') setRadio(f[3]); else setRadio(f[4]);
  if (data.makeSafeType)  setVal(f[5], data.makeSafeType);
  if (data.makeSafeDate)  setVal(f[6], data.makeSafeDate);
  if (data.specialistReportObtained === 'Yes') setRadio(f[7]); else setRadio(f[8]);
  if (data.specialistType) setVal(f[9], data.specialistType);
  if (data.droneUtilised === 'Yes')  setRadio(f[10]);
  if (data.droneUtilised === 'No')   setRadio(f[11]);
  if (data.droneUtilised === 'N/A')  setRadio(f[12]);

  // ── PROPERTY DETAILS ──────────────────────────────────────
  setSelectByText(f[13], data.buildingAge);
  setSelectByText(f[14], data.condition);
  setSelectByText(f[15], data.roofType);
  setSelectByText(f[16], data.wallType);
  setSelectByText(f[17], data.storeys);
  setSelectByText(f[18], data.foundation);
  if (data.fenceType && data.fenceType !== 'None') setSelectByText(f[19], data.fenceType);
  if (data.fenceAge)   setSelectByText(f[20], data.fenceAge);
  if (data.tempFenceRequired === 'Yes') setRadio(f[21]); else setRadio(f[22]);
  if (data.detachedGarage === 'Yes')    setRadio(f[23]); else setRadio(f[24]);
  if (data.sheds === 'Yes')             setRadio(f[25]); else setRadio(f[26]);
  if (data.swimmingPool === 'Yes')      setRadio(f[27]); else setRadio(f[28]);
  if (data.detachedGrannyFlat === 'Yes') setRadio(f[29]); else setRadio(f[30]);

  // ── CLIENT DISCUSSIONS ────────────────────────────────────
  setSelectByText(f[31], data.clientDiscussionTemplate);
  setMCE(0, data.clientDiscussionDetail);

  // ── RESULTANT DAMAGE ──────────────────────────────────────
  if (data.tarpInstalled === 'Yes') setRadio(f[33]); else setRadio(f[34]);
  setSelectByText(f[35], data.mainDamageType);
  setSelectByText(f[36], data.resultantDamageTemplate);
  setMCE(1, data.resultantDamageDetail);
  if (data.listedEvent === 'Yes') setRadio(f[38]); else setRadio(f[39]);
  if (data.mainRoofDamage === 'Yes') setRadio(f[40]); else setRadio(f[41]);
  setSelectByText(f[42], data.causeOfDamageTemplate);
  setMCE(2, data.causeOfDamageDetail);

  // ── DEFECT ISSUES AND MAINTENANCE ────────────────────────
  if (data.defectIssues)          setVal(f[44], data.defectIssues);
  if (data.maintenanceDamageDesc) setVal(f[45], data.maintenanceDamageDesc);
  setSelectByText(f[46], data.maintenanceTemplate);
  setMCE(3, data.maintenanceDetail);
  if (data.maintenanceEstimate)   setVal(f[48], data.maintenanceEstimate);
  if (data.otherMaintenanceComments) setVal(f[49], data.otherMaintenanceComments);
  if (data.insuredAwareOfRepairs === 'Yes') setRadio(f[50]); else setRadio(f[51]);

  // ── RECOMMENDATION ────────────────────────────────────────
  setSelectByText(f[52], data.recommendation);
  setSelectByText(f[53], data.conclusionTemplate);
  setMCE(4, data.conclusionDetail);
  if (data.tempAccommImmediate === 'Yes') setRadio(f[55]); else setRadio(f[56]);
  if (data.tempAccommImmediateTimeframe) setVal(f[57], data.tempAccommImmediateTimeframe);
  if (data.tempRepairsRequired)           setVal(f[58], data.tempRepairsRequired);
  if (data.tempAccommDuringRepairs === 'Yes') setRadio(f[59]); else setRadio(f[60]);
  if (data.tempAccommRepairsTimeframe)    setVal(f[61], data.tempAccommRepairsTimeframe);
  if (data.worksDuringAccomm)             setVal(f[62], data.worksDuringAccomm);

  // ── SPECIAL NOTES ─────────────────────────────────────────
  if (data.specialNotesTemplate) setSelectByText(f[63], data.specialNotesTemplate);
  setMCE(5, data.specialNotesDetail);

  // ── INTERNAL USE ONLY ─────────────────────────────────────
  if (data.sumInsuredAdequate === 'Yes')       setRadio(f[65]); else setRadio(f[66]);
  if (data.overallConditionAcceptable === 'Yes') setRadio(f[67]); else setRadio(f[68]);
  if (data.propertySize)                       setVal(f[69], data.propertySize);
  if (data.isHabitable === 'Yes')              setRadio(f[70]); else setRadio(f[71]);
  if (data.mould === 'Yes')                    setRadio(f[72]); else setRadio(f[73]);
  if (data.otherHazards)                       setVal(f[74], data.otherHazards);
  if (data.asbestosOnSite === 'Yes')           setRadio(f[75]); else setRadio(f[76]);
  if (data.incidentConfirmed === 'Yes')        setRadio(f[77]); else setRadio(f[78]);
  if (data.claimRecommendation === 'Accept')   setRadio(f[79]); else setRadio(f[80]);
  if (data.unableToWarrantReason)              setVal(f[81], data.unableToWarrantReason);
  if (data.iagRepRequired === 'Yes')           setRadio(f[82]); else setRadio(f[83]);
  if (data.clientWilling === 'Yes')            setRadio(f[84]); else setRadio(f[85]);
  if (data.insuredAdvised === 'Yes')           setRadio(f[86]); else setRadio(f[87]);
  if (data.furtherInformation)                 setVal(f[88], data.furtherInformation);

  console.log('IAG Auto-fill complete! Review the form, then click Save or Complete.');

})();`

// ── A&G JS Autofill ───────────────────────────────────────────────────────
const AUTO_GENERAL_JS_SYSTEM = `You are an expert building inspector in Perth, Australia. Write formal, factual insurance building assessment reports. Your style must be cold, clinical and professional - no first person language except where the format explicitly requires it. Never use phrases like "I observed", "it appears", "I believe", or "I noted". Never speculate beyond what the evidence supports. Do not include any em dashes - use hyphens or alternative punctuation instead.

Return only the complete filled JavaScript script. No preamble, no markdown code fences, no explanation - just the raw JavaScript.`

const AUTO_GENERAL_JS_TEMPLATE = `// ============================================================
// A&G BUILDER SITE REPORT — AUTO-FILL SCRIPT
// ============================================================
// INSTRUCTIONS:
//   1. Open the A&G Builder Site Report form in MySysWorks
//   2. Press F12 → Console tab
//   3. Paste this entire script and press Enter
// ============================================================

(function() {

var data = {

  // ── ASSESSMENT REPORT DETAILS ─────────────────────────────
  attendanceDate:        "",        // Format: YYYY-MM-DD (from siteAttendanceDatetime)
  timeAttended:          "",        // Format: HH:MMam/pm e.g. "9:30am" (from siteAttendanceDatetime)
  assessorContactNumber: "",        // Assessor phone number from context
  assessorMetWith:       "",        // First name of insured e.g. "Gary"
  timeOnSite:            "",        // Approximate time on site e.g. "45 mins", "1 hour"

  // ── PROPERTY DETAILS ──────────────────────────────────────
  yearBuilt:             "",        // Year as a number e.g. "1995"
  wallConstruction:      "",        // Select from: Asbestos | Besser Block/Cement | Brick Veneer |
                                    // Double Brick | Fibro | Hebel | Non-Asbestos Fibro | Other |
                                    // Other Cladding | Stone | Timber/Weatherboard
  roofType:              "",        // Select from: Asbestos | Cement Tiles | Clay/Terracotta Tiles |
                                    // Colorbond | Metal Other | Other | Slate
  storeys:               "",        // Select: 1 | 2 | 3
  underConstruction:     "No",      // Select: Yes | No | N/A
  constructionRoofWalls: "No",      // Select: Yes | No | N/A - is work involving removal of roof/external walls?
  constructionDetails:   "",        // Plain text if underConstruction = "Yes", else ""
  heritageListed:        "No",      // Select: Yes | No | N/A
  unoccupied180Days:     "No",      // Select: Yes | No | N/A

  // ── CUSTOMER DISCUSSION AND INSPECTION FINDINGS ───────────
  customerDiscussionTemplate: "Storm - Client Discussion",
                                    // Select from: Storm - Client Discussion |
                                    // EOL (Burst Pipe) - Client Discussion |
                                    // Fence Template - Client Discussion |
                                    // Vehicle IMPACT - Client Discussion |
                                    // EOL (WaterProof Failure) - Client Discussion |
                                    // FIRE - Client Discussion |
                                    // Tree IMPACT - Client Discussion |
                                    // Adhesive Failure - Client Discussion |
                                    // RetainingWall - Client Discussion |
                                    // Balcony Ingress - Client Discussion |
                                    // EnviromentalMOULD - Client Discussion |
                                    // Impact - Garage Door

  // Rich text - customer discussion and inspection findings (MCE editor 0):
  customerDiscussionDetail: "",     // FIRST PERSON narrative. Begin: "I met with the Insured - [name] as arranged. The Insured stated that [what insured said about the event and damage]. Upon inspection, [what was found on site]." Include what the insured said AND key site observations. This is the combined Statement of Objectivity.

  // ── CAUSE OF DAMAGE ───────────────────────────────────────
  claimType:             "",        // Select from: Accidental Damage | Escape of Liquid | Storm(wind) |
                                    // Hail | Rainwater Runoff | Flood | Lighting | Earth Movement |
                                    // Impact | Fire Damage | Bushfire | Explosion | Earthquake |
                                    // Glass | Theft Damage | Malicious Damage/Vadalism |
                                    // Tenant Malicious Damage | Motor Burnout | Third Party Property |
                                    // Liability (Third Party) | Personal Effects | Riot/Civil Commotion |
                                    // Theft | Tenant Theft | Other
  sourceRoom:            "",        // Plain text location/source e.g. "Western boundary fence", "Lounge room ceiling"
  specificCause:         "",        // Select from: Storm - Roof Report Arranged COD |
                                    // Storm - Groundwater runoff | Storm - Roof Tile - COD |
                                    // Storm - Valley/Gutter Overflow-Blocked COD |
                                    // EOL (Burst Pipe) Sudden - COD |
                                    // Fence Hardie Template - - COD |
                                    // Vehicle IMPACT - COD |
                                    // EOL (WaterProof Failure) - COD |
                                    // FIRE - COD | Tree IMPACT - COD |
                                    // Adhesive Failure - COD | RetainingWall - COD |
                                    // Balcony Ingress - COD | EnviromentalMOULD - COD |
                                    // Impact - Garage Door | Fence Asbestos Template - COD

  // Rich text - cause of damage detail (MCE editor 1):
  causeOfDamageDetail:   "",        // Bullet point analysis of the cause. First bullet: "• Primary cause - [type]". Sub-bullets are one-line evidence observations. Include Australian Standard references inline. No first person. Each secondary cause gets its own "• Primary cause" line. Keep sub-bullets to a minimum (1 or 2 per primary cause) - they should help explain the primary bullet, not just repeat it in different wording.

  // ── RESULTING DAMAGE ──────────────────────────────────────
  resultantDamageTemplate: "",      // Select from: Storm - Resultant Damage | Storm - Ceiling Replacement |
                                    // Storm - Painting Only - Ceiling | Storm - Painting only - Walls |
                                    // EOL (Burst Pipe ) - Resultant Damage |
                                    // Fence Hardie Template - Resultant Damage |
                                    // Vehicle IMPACT - Resultant Damage |
                                    // EOL (WaterProof Failure) - Resultant damage |
                                    // FIRE - Resultant Damge | Tree IMPACT - Resultant Damage |
                                    // Adhesive Failure - Resultant Damage |
                                    // RetainingWall - Resultant Damage |
                                    // Balcony Ingress - Resultant Damage |
                                    // EnviromentalMOULD - Resultant Damage |
                                    // Impact - Garage Door |
                                    // Fence Asbestos Template -Resultant Damage

  // Rich text - resulting damage description (MCE editor 2):
  resultantDamageDetail:  "",       // Always start with "The following resultant damage was identified during inspection:" and then a bullet list. Each line: "• [Room] - [type of damage] [measurement if known]". Use a sub-bullet (-) only if scope needs clarifying. One line per item. Group similar items across rooms where applicable. No cause or opinion - observations only.

  damageDuration:        "",        // Plain text e.g. "Single event", "Multiple Years". How long the claim-related damage appears to have been occurring.
  asbestosPresent:       "No",      // Select: Yes | No | N/A
  electricalDamaged:     "No",      // Select: Yes | No | N/A
  mouldPresent:          "No",      // Select: Yes | No | N/A
  restorationRequired:   "No",      // Select: Yes | No | N/A
  restorationOverview:   "",        // Plain text overview if restorationRequired = "Yes", else ""
  restorationTimeframe:  "N/A",     // Plain text timeframe if restorationRequired = "Yes", else "N/A"
  contentsItemsClaimed:  "No",      // Select: Yes | No | N/A

  // ── PROPERTY CONDITIONS ───────────────────────────────────
  propertyConditionsContributed: "No", // Select: Yes | No | N/A
  conditionsDuration:    "",        // Plain text how long conditions have been occurring, or ""
  conditionsDetails:     "",        // Plain text details if propertyConditionsContributed = "Yes", else ""
  damageWouldStillOccur: "No",      // Select: Yes | No | N/A - would damage still have occurred if property was in good condition?
  damageWouldOccurDetails: "",      // Plain text if damageWouldStillOccur = "Yes", else ""
  customerAwareConditions: "No",    // Select: Yes | No | N/A
  customerAwareDetails:  "",        // Plain text if customerAwareConditions = "Yes", else ""
  otherPropertyIssues:   "No",      // Select: Yes | No | N/A
  otherIssuesDetails:    "",        // Plain text if otherPropertyIssues = "Yes", else ""
  maintenanceRequired:   "No",      // Select: Yes | No | N/A
  urgentMaintenance:     "",        // Plain text urgent maintenance items, or ""
  otherMaintenance:      "",        // Plain text other maintenance items, or ""
  warrantableRepairsPrevented: "No", // Select: Yes - Maintenance to be completed prior | No | N/A | Yes - Unable to warrant
  maintenanceTemplate:   "A&G - Maintenance", // Select from: A&G - Maintenance |
                                    // Following the completion of the required maintenance works, Midcity group can proceed with the resultant repairs provided in the scope of works.

  // ── TEMPORARY ACCOMMODATION ───────────────────────────────
  emergencyAccomm:       "No",      // Select: Yes, required until repairs are completed |
                                    // Yes, required until Make Safe is completed | No
  emergencyTimeframe:    "",        // Plain text timeframe if emergencyAccomm = "Yes", else ""
  accommDuringRepairs:   "No",      // Select: Yes | No | N/A
  repairsTimeframe:      "",        // Plain text timeframe if accommDuringRepairs = "Yes", else ""
  accommNotes:           "",        // Plain text notes / special requirements, or ""

  // ── UNDERWRITING RISK ASSESSMENT ─────────────────────────
  propertyNotGoodCondition:  "No",  // Select: Yes | No | N/A
  propertyNotStructurallySound: "No", // Select: Yes | No | N/A
  propertyNotWellMaintained: "No",  // Select: Yes | No | N/A
  propertyNotWaterTight:     "No",  // Select: Yes | No | N/A
  businessUse:               "No",  // Select: Yes | No | N/A
  underwritingFurtherDetail: "",    // Plain text further detail, or ""

  // ── RECOVERIES ASSESSMENT ────────────────────────────────
  failedAppliance:       "No",      // Select: Yes | No | N/A
  applianceUnder10Years: "No",      // Select: Yes | No | N/A
  applianceSalvageable:  "No",      // Select from: Yes, the assessor has retrieved the item |
                                    // Yes, the item is onsite and can be collected |
                                    // Yes, the item is offsite and can be collected |
                                    // No, the item has been disposed of
                                    // Use "No, the item has been disposed of" as default if failedAppliance = "No"
  technicianAttended:    "No",      // Select: Yes | No | N/A
  propertyUnder10Years:  "No",      // Select: Yes | No | N/A
  builderTradeDetails:   "",        // Plain text if propertyUnder10Years = "Yes", else ""
  thirdPartyImpact:      "No",      // Select: Yes | No | N/A
  recoveriesFurtherDetails: "",     // Plain text any further details, or ""

  // ── ADDITIONAL INFORMATION / NEXT STEPS ──────────────────
  nextSteps:             "Await Further Instructions",
                                    // Select from: Await Further Instructions
  homeAssessor:          "HA to be appointed for claim review",
                                    // Select from: HA to be appointed for claim review
  claims:                "Review Report and determine policy coverage",
                                    // Select from: Review Report and determine policy coverage
  builder:               "Await Further Instructions",
                                    // Select from: Await Further Instructions
  specialist:            "N/A",     // Select from: N/A |
                                    // Engineer - Attend site to provide causation report & SOW for repair methodology
  customer:              "Await A&G Review",
                                    // Select from: Complete Maintenance Repairs | Await A&G Review

  // ── STATEMENT OF OBJECTIVITY ─────────────────────────────
  qualification:         "Building Supervisor",
                                    // Select from: Building Supervisor | Other | Plumber | Electrician
  licence:               "WA Lic. BC12132",
                                    // Select from: WA Lic. BC12132 | VIC Lic. CDB-U 65461 / CCB-U 57405 |
                                    // NSW Lic. 197071C | QLD Lic. 1202589

};

// ============================================================
// AUTO-FILL ENGINE — DO NOT EDIT BELOW THIS LINE
// ============================================================

  var container = document.querySelector('[id^="job_question_list_"]');
  if (!container) { console.error('Report form container not found.'); return; }

  var f = container.querySelectorAll('input:not([type=hidden]), select, textarea');

  function setVal(el, value) {
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelectByText(selectEl, text) {
    if (!selectEl || !text) return;
    for (var i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].text.trim() === text) {
        selectEl.value = selectEl.options[i].value;
        selectEl.selectedIndex = i;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  }

  function setMCE(index, html) {
    if (!html) return;
    if (typeof tinymce !== 'undefined') {
      var eds = tinymce.editors;
      var edArr = Array.isArray(eds) ? eds : Object.values(eds);
      if (edArr[index]) {
        edArr[index].setContent(html);
        edArr[index].save();
        return;
      }
    }
    var tas = container.querySelectorAll('textarea');
    if (tas[index]) setVal(tas[index], html);
  }

  // ── ASSESSMENT REPORT DETAILS ─────────────────────────────
  if (data.attendanceDate)        setVal(f[0],  data.attendanceDate);
  if (data.timeAttended)          setVal(f[1],  data.timeAttended);
  if (data.assessorContactNumber) setVal(f[2],  data.assessorContactNumber);
  if (data.assessorMetWith)       setVal(f[3],  data.assessorMetWith);
  if (data.timeOnSite)            setVal(f[4],  data.timeOnSite);

  // ── PROPERTY DETAILS ──────────────────────────────────────
  if (data.yearBuilt)             setVal(f[5],  data.yearBuilt);
  setSelectByText(f[6],  data.wallConstruction);
  setSelectByText(f[7],  data.roofType);
  setSelectByText(f[8],  data.storeys);
  setSelectByText(f[9],  data.underConstruction);
  setSelectByText(f[10], data.constructionRoofWalls);
  if (data.constructionDetails)   setVal(f[11], data.constructionDetails);
  setSelectByText(f[12], data.heritageListed);
  setSelectByText(f[13], data.unoccupied180Days);

  // ── CUSTOMER DISCUSSION ───────────────────────────────────
  setSelectByText(f[14], data.customerDiscussionTemplate);
  setMCE(0, data.customerDiscussionDetail);

  // ── CAUSE OF DAMAGE ───────────────────────────────────────
  setSelectByText(f[16], data.claimType);
  if (data.sourceRoom)            setVal(f[17], data.sourceRoom);
  setSelectByText(f[18], data.specificCause);
  setMCE(1, data.causeOfDamageDetail);

  // ── RESULTING DAMAGE ──────────────────────────────────────
  setSelectByText(f[20], data.resultantDamageTemplate);
  setMCE(2, data.resultantDamageDetail);
  if (data.damageDuration)        setVal(f[22], data.damageDuration);
  setSelectByText(f[23], data.asbestosPresent);
  setSelectByText(f[24], data.electricalDamaged);
  setSelectByText(f[25], data.mouldPresent);
  setSelectByText(f[26], data.restorationRequired);
  if (data.restorationOverview)   setVal(f[27], data.restorationOverview);
  if (data.restorationTimeframe)  setVal(f[28], data.restorationTimeframe);
  setSelectByText(f[29], data.contentsItemsClaimed);

  // ── PROPERTY CONDITIONS ───────────────────────────────────
  setSelectByText(f[30], data.propertyConditionsContributed);
  if (data.conditionsDuration)    setVal(f[31], data.conditionsDuration);
  if (data.conditionsDetails)     setVal(f[32], data.conditionsDetails);
  setSelectByText(f[33], data.damageWouldStillOccur);
  if (data.damageWouldOccurDetails)  setVal(f[34], data.damageWouldOccurDetails);
  setSelectByText(f[35], data.customerAwareConditions);
  if (data.customerAwareDetails)  setVal(f[36], data.customerAwareDetails);
  setSelectByText(f[37], data.otherPropertyIssues);
  if (data.otherIssuesDetails)    setVal(f[38], data.otherIssuesDetails);
  setSelectByText(f[39], data.maintenanceRequired);
  if (data.urgentMaintenance)     setVal(f[40], data.urgentMaintenance);
  if (data.otherMaintenance)      setVal(f[41], data.otherMaintenance);
  setSelectByText(f[42], data.warrantableRepairsPrevented);
  setSelectByText(f[43], data.maintenanceTemplate);

  // ── TEMPORARY ACCOMMODATION ───────────────────────────────
  setSelectByText(f[44], data.emergencyAccomm);
  if (data.emergencyTimeframe)    setVal(f[45], data.emergencyTimeframe);
  setSelectByText(f[46], data.accommDuringRepairs);
  if (data.repairsTimeframe)      setVal(f[47], data.repairsTimeframe);
  if (data.accommNotes)           setVal(f[48], data.accommNotes);

  // ── UNDERWRITING RISK ASSESSMENT ─────────────────────────
  setSelectByText(f[49], data.propertyNotGoodCondition);
  setSelectByText(f[50], data.propertyNotStructurallySound);
  setSelectByText(f[51], data.propertyNotWellMaintained);
  setSelectByText(f[52], data.propertyNotWaterTight);
  setSelectByText(f[53], data.businessUse);
  if (data.underwritingFurtherDetail) setVal(f[54], data.underwritingFurtherDetail);

  // ── RECOVERIES ASSESSMENT ─────────────────────────────────
  setSelectByText(f[55], data.failedAppliance);
  setSelectByText(f[56], data.applianceUnder10Years);
  setSelectByText(f[57], data.applianceSalvageable);
  setSelectByText(f[58], data.technicianAttended);
  setSelectByText(f[59], data.propertyUnder10Years);
  if (data.builderTradeDetails)   setVal(f[60], data.builderTradeDetails);
  setSelectByText(f[61], data.thirdPartyImpact);
  if (data.recoveriesFurtherDetails) setVal(f[62], data.recoveriesFurtherDetails);

  // ── ADDITIONAL INFORMATION / NEXT STEPS ──────────────────
  setSelectByText(f[63], data.nextSteps);
  setSelectByText(f[64], data.homeAssessor);
  setSelectByText(f[65], data.claims);
  setSelectByText(f[66], data.builder);
  setSelectByText(f[67], data.specialist);
  setSelectByText(f[68], data.customer);

  // ── STATEMENT OF OBJECTIVITY ─────────────────────────────
  setSelectByText(f[69], data.qualification);
  setSelectByText(f[70], data.licence);

  console.log('A&G Auto-fill complete! Review the form, then click Save or Complete.');

})();`

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
      scopeRoomsSummary,
      reportDateFormatted,
      siteAttendanceDatetimeFormatted,
    } = await req.json()

    if (!rawNotes?.trim()) {
      return NextResponse.json({ error: 'rawNotes is required' }, { status: 400 })
    }

    if (!template || !['aai', 'auto_general', 'iag'].includes(template)) {
      return NextResponse.json({ error: 'Valid template is required (aai, auto_general, iag)' }, { status: 400 })
    }

    const contextLines = [
      inspector ? `Assessor name: ${inspector}` : null,
      address ? `Property address: ${address}` : null,
      insuredName ? `Insured name: ${insuredName}` : null,
      claimNumber ? `Claim number: ${claimNumber}` : null,
      insurer ? `Insurer: ${insurer}` : null,
      scheduledDate ? `Scheduled inspection date: ${scheduledDate}` : null,
      dateOfLoss ? `Date of loss: ${dateOfLoss}` : null,
      lossType ? `Loss / claim type: ${lossType}` : null,
      scopeRoomsSummary ? `Rooms / scope:\n${scopeRoomsSummary}` : null,
      reportDateFormatted ? `Report date (use exactly for reportDate, format YYYY-MM-DD): ${reportDateFormatted}` : null,
      siteAttendanceDatetimeFormatted ? `Site attendance datetime (use exactly for siteAttendanceDatetime, format YYYY-MM-DDTHH:MM): ${siteAttendanceDatetimeFormatted}` : null,
    ].filter(Boolean).join('\n')

    // ── AAI: JS autofill ─────────────────────────────────────────────────
    if (template === 'aai') {
      const jsMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: AAI_JS_SYSTEM,
        messages: [{
          role: 'user',
          content: `Convert the dictation and context below into the data = { } JavaScript object. Use the exact field names shown. Only change the values - do not rename any keys. Attempt to fill all fields. If there is not enough information to fill a particular field then or it is not applicable, the answer should be "N/A", "No" or "None"

MY DICTATION:
[${rawNotes}]

Context:
[${contextLines}]

FOCUS GUIDANCE — COMBINED DICTATION:
These notes cover a full site inspection and may include roof report details, make safe works, and general site observations. For this Building Assessment Report:
- INCLUDE: Customer/client discussion and what the insured stated, cause of loss and causal chain, damaged areas and extent, property conditions and pre-existing defects, wear and tear evidence, claim considerations (authority to proceed, referrals, specialist needs, temp accommodation, recovery potential).
- The Roof Report is a supporting document for this BAR — you may reference roof findings where they are causally relevant to the claimed damage. For example, if the roof is underpitched and that contributed to water ingress, include that in the cause analysis. If a damaged roof allowed water entry causing internal damage, reference it.
- Do NOT include roof technical specifications as standalone observations — pitch degrees, batten/truss compliance ratings, gutter overflow details, downpipe dimensions, skylight flashing condition — these belong in the Roof Report only. Only reference these if they directly explain the cause or extent of the claimed building damage.
- Use the "Report date" value from Context for reportDate, and "Site attendance datetime" for siteAttendanceDatetime — both must be used exactly as provided.
- Verbal cues like "BAR section", "building report", "starting BAR" indicate content especially relevant to this report.

TEMPLATE TO FILL:
[${AAI_JS_TEMPLATE}]`,
        }],
      })
      const jsContent = jsMessage.content[0]
      if (jsContent.type !== 'text') {
        return NextResponse.json({ error: 'Unexpected response format' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, javascript: jsContent.text })
    }

    // ── IAG: JS autofill ─────────────────────────────────────────────────
    if (template === 'iag') {
      const jsMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: IAG_JS_SYSTEM,
        messages: [{
          role: 'user',
          content: `Convert the dictation and context below into the data = { } JavaScript object. Use the exact field names shown. Only change the values - do not rename any keys. Attempt to fill all fields. If there is not enough information to fill a particular field, or it is not applicable, the answer should be "N/A", "No" or "None" as appropriate.

MY DICTATION:
[${rawNotes}]

Context:
[${contextLines}]

FOCUS GUIDANCE — COMBINED DICTATION:
These notes cover a full site inspection and may include roof report details, make safe works, and general site observations. For this IAG Building Assessment Report:
- INCLUDE: Customer/client discussion and what the insured stated, cause of loss and causal chain, damaged areas and extent, property conditions and pre-existing defects, wear and tear evidence, claim considerations (referrals, specialist needs, temp accommodation, recovery potential).
- The Roof Report is a supporting document for this report - you may reference roof findings where they are causally relevant to the claimed damage. If the roof allowed water entry causing internal damage, reference it. Only reference roof technical specifications if they directly explain the cause or extent of the claimed building damage.
- Verbal cues like "IAG section", "building report", "starting IAG" indicate content especially relevant to this report.

TEMPLATE TO FILL:
[${IAG_JS_TEMPLATE}]`,
        }],
      })
      const jsContent = jsMessage.content[0]
      if (jsContent.type !== 'text') {
        return NextResponse.json({ error: 'Unexpected response format' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, javascript: jsContent.text })
    }

    // ── A&G: JS autofill ─────────────────────────────────────────────────
    const jsMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: AUTO_GENERAL_JS_SYSTEM,
      messages: [{
        role: 'user',
        content: `Convert the dictation and context below into the data = { } JavaScript object. Use the exact field names shown. Only change the values - do not rename any keys. Attempt to fill all fields. If there is not enough information to fill a particular field, or it is not applicable, the answer should be "N/A", "No" or "None" as appropriate.

MY DICTATION:
[${rawNotes}]

Context:
[${contextLines}]

FOCUS GUIDANCE — COMBINED DICTATION:
These notes cover a full site inspection and may include roof report details, make safe works, and general site observations. For this A&G Builder Site Report:
- INCLUDE: Customer/client discussion and what the insured stated, cause of loss and causal chain, damaged areas and extent, property conditions and pre-existing defects, wear and tear evidence, claim considerations (temp accommodation, recovery potential, maintenance).
- The Roof Report is a supporting document for this report - you may reference roof findings where they are causally relevant to the claimed damage. Only reference roof technical specifications if they directly explain the cause or extent of the claimed building damage.
- Verbal cues like "A&G section", "builder site report", "starting A&G" indicate content especially relevant to this report.
- The "siteAttendanceDatetime" value should be used for the attendanceDate (YYYY-MM-DD) and timeAttended fields.
- The "Statement of Objectivity" field (customerDiscussionDetail) should be written in the FIRST PERSON. This is the one exception to the no-first-person rule. Begin with "I met with the Insured - [insuredName] as arranged. The Insured stated that..." and then describe what the insured said and what was observed on site. This is a combined narrative of client discussion AND inspection findings.

TEMPLATE TO FILL:
[${AUTO_GENERAL_JS_TEMPLATE}]`,
      }],
    })
    const jsContent = jsMessage.content[0]
    if (jsContent.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response format' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, javascript: jsContent.text })

  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate report', details: String(error) }, { status: 500 })
  }
}
