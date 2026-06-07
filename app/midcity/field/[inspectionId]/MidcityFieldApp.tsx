'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RoofReportPreview } from './RoofReportPreview'
import TemplateSelectorField from '@/components/reports/TemplateSelectorField'

interface InitialData {
  inspectionId: string
  inspectionRef: string | null
  status: string
  scheduledDate: string | null
  scheduledTime: string | null
  jobId: string | null
  jobNumber: string | null
  address: string | null
  insuredName: string | null
  insurer: string | null
  lossType: string | null
  dateOfLoss: string | null
  claimNumber: string | null
  quoteId: string | null
  quoteRef: string | null
  reportId: string | null
  reportRef: string | null
  inspector: string | null
  inspectorId: string
  tenantId: string
  personMet: string | null
  fieldDraft: Record<string, unknown> | null
  safetyConfirmedAt: string | null
  formSubmittedAt: string | null
}

interface ScopeItem { id: string; text: string }
interface ScopeRoom { id: string; name: string; l: string; w: string; h: string; items: ScopeItem[] }
interface PhotoEntry { id: string; photoId: string | null; file: File | null; previewUrl: string; label: string; processing: boolean; uploading: boolean }

interface RoofReportData {
  // Claim Details
  claimDetails: string
  // Assessment Report Details
  attendanceDate: string; timeAttended: string; rooferName: string
  rooferQualification: string; rooferMetWith: string; timeOnSite: string; scopeOfAssessment: string
  // Property Details
  propertyAge: string; wallConstruction: string; propertyType: string
  propertyCondition: string; numberOfStoreys: string
  // Roof Details
  roofType: string; roofGeneralCondition: string; roofPitch: string
  numberOfPenetrations: string; roofInsulationType: string
  solarPV: string; roofMountedSolarHWS: string; numberOfSkylights: string
  skylightFlashingsWatertight: string; skylightFlashingsNotes: string
  guttersCompliant: string; guttersNotes: string
  downpipesCompliant: string; corrosionIronizedWater: string; downpipeSize: string
  roofStructureTiedDown: string; battenSizeCompliant: string; trussRafterCompliant: string
  // Cause of Damage
  claimType: string; specificCause: string
  // Client Discussion
  clientDiscussion: string
  // Roof Conditions
  propertyConditionsContributed: string; propertyConditionsDetails: string
  damageWithoutConditions: string; damageWithoutConditionsDetails: string
  customerAwareOfConditions: string; customerAwareDetails: string
  otherPropertyConditionIssues: string; otherPropertyConditionDetails: string
  maintenanceRepairsRequired: string; requiredMaintenanceDetails: string; recommendedMaintenanceDetails: string
  conditionsPreventRepairs: string; conditionsPreventRepairsDetails: string
  previousRepairs: string; previousRepairsDetails: string
  buildingCodeViolations: string; buildingCodeViolationsDetails: string
  // Access and Safety
  accessConcerns: string; healthSafetyConcerns: string
  // Additional Information
  makeSafeCompleted: string; makeSafeCompletedDetails: string; makeSafeRequired: string
}

function emptyRoofReport(): RoofReportData {
  return {
    claimDetails: '',
    attendanceDate: '', timeAttended: '', rooferName: '', rooferQualification: '',
    rooferMetWith: '', timeOnSite: '30 mins', scopeOfAssessment: 'Carry out roof inspection and provide a roof report relating to the claim',
    propertyAge: '', wallConstruction: '', propertyType: '', propertyCondition: '', numberOfStoreys: '',
    roofType: '', roofGeneralCondition: '', roofPitch: '', numberOfPenetrations: '',
    roofInsulationType: '', solarPV: '', roofMountedSolarHWS: '', numberOfSkylights: '',
    skylightFlashingsWatertight: '', skylightFlashingsNotes: '',
    guttersCompliant: '', guttersNotes: '',
    downpipesCompliant: '', corrosionIronizedWater: '', downpipeSize: '',
    roofStructureTiedDown: '', battenSizeCompliant: '', trussRafterCompliant: '',
    claimType: '', specificCause: '',
    clientDiscussion: '',
    propertyConditionsContributed: '', propertyConditionsDetails: '',
    damageWithoutConditions: '', damageWithoutConditionsDetails: '',
    customerAwareOfConditions: '', customerAwareDetails: '',
    otherPropertyConditionIssues: '', otherPropertyConditionDetails: '',
    maintenanceRepairsRequired: '', requiredMaintenanceDetails: '', recommendedMaintenanceDetails: '',
    conditionsPreventRepairs: '', conditionsPreventRepairsDetails: '',
    previousRepairs: '', previousRepairsDetails: '',
    buildingCodeViolations: '', buildingCodeViolationsDetails: '',
    accessConcerns: '', healthSafetyConcerns: '',
    makeSafeCompleted: '', makeSafeCompletedDetails: '', makeSafeRequired: '',
  }
}

type InsuranceTemplate = 'aai' | 'auto_general' | 'iag'
type FieldDef = { key: string; label: string; section: string; multiline?: boolean }

const AAI_FIELDS: FieldDef[] = [
  { key: 'claim_number', label: 'Claim Number', section: 'Claim Information' },
  { key: 'brand', label: 'Brand', section: 'Claim Information' },
  { key: 'insured_address', label: 'Insured Address', section: 'Claim Information' },
  { key: 'builder_reference_number', label: 'Builder Reference Number', section: 'Claim Information' },
  { key: 'report_date', label: 'Report Date', section: 'Claim Information' },
  { key: 'type_of_report', label: 'Type of Report', section: 'Claim Information' },
  { key: 'date_of_loss', label: 'Date of Loss', section: 'Claim Information' },
  { key: 'lodgement_description', label: 'Lodgement Description', section: 'Claim Information', multiline: true },
  { key: 'claimed_loss_cause', label: 'Claimed Loss Cause', section: 'Claim Information', multiline: true },
  { key: 'client_name', label: 'Client Name / Insured Representative', section: 'Assessment Details' },
  { key: 'assessment_completed_by', label: 'Assessment Completed By', section: 'Assessment Details' },
  { key: 'suncorp_assessor', label: 'Suncorp Assessor (if applicable)', section: 'Assessment Details' },
  { key: 'assessment_type', label: 'Assessment Type', section: 'Assessment Details' },
  { key: 'site_attendance', label: 'Site Attendance Date and Time', section: 'Assessment Details' },
  { key: 'significant_defects', label: 'Significant Maintenance / Structural Defects / Property Condition Concerns?', section: 'Overall Property Observations' },
  { key: 'defects_details', label: 'Details of Observations', section: 'Overall Property Observations', multiline: true },
  { key: 'safety_concerns', label: 'Safety Concerns or Hazards?', section: 'Overall Property Observations' },
  { key: 'safety_concerns_details', label: 'Safety Concerns Details', section: 'Overall Property Observations', multiline: true },
  { key: 'areas_damaged', label: 'Areas of Property Damaged', section: 'Cause of Damage', multiline: true },
  { key: 'how_damage_occurred', label: 'How Damage Occurred (Proximate Cause and Causal Link)', section: 'Cause of Damage', multiline: true },
  { key: 'specialist_report_obtained', label: 'Has a Specialist Report Been Obtained?', section: 'Cause of Damage' },
  { key: 'specialist_report_summary', label: 'Specialist Report Summary', section: 'Cause of Damage', multiline: true },
  { key: 'damage_long_term_or_single', label: 'Is the Damage Long Term or Single Event?', section: 'Cause of Damage' },
  { key: 'wear_tear_gradual', label: 'Was Damage Caused by Wear, Tear, Gradual Deterioration, or Gradual Leak?', section: 'Cause of Damage' },
  { key: 'visible_evidence_wear_tear', label: 'Visible Evidence of Wear, Tear, Gradual Deterioration or Gradual Leak', section: 'Cause of Damage — Additional Information', multiline: true },
  { key: 'repairs_could_have_prevented', label: 'Repairs / Preventative Measures That Could Have Prevented Loss', section: 'Cause of Damage — Additional Information', multiline: true },
  { key: 'customer_knew_inevitable', label: 'Did Customer Know or Should Have Reasonably Known Damage Was Inevitable?', section: 'Cause of Damage — Additional Information' },
  { key: 'customer_knowledge_evidence', label: 'Evidence to Substantiate Customer Knowledge', section: 'Cause of Damage — Additional Information', multiline: true },
  { key: 'customer_conversation', label: 'Customer Conversation', section: 'Assessment Summary', multiline: true },
  { key: 'general_observations', label: 'General Observations', section: 'Assessment Summary', multiline: true },
  { key: 'makesafe_restoration_actioned', label: 'Has a Makesafe or Restoration Job Been Actioned?', section: 'Assessment Summary' },
  { key: 'makesafe_works_details', label: 'Makesafe / Restoration Works Carried Out', section: 'Assessment Summary', multiline: true },
  { key: 'floor_plan_supplied', label: 'Is the Floor Plan / Mud Map Supplied?', section: 'Assessment Summary' },
  { key: 'specialist_report_required', label: 'Any Other Specialist Report Required?', section: 'Assessment Summary' },
  { key: 'which_specialist_required', label: 'Which Specialist Is Required and Why', section: 'Assessment Summary', multiline: true },
  { key: 'non_warrantable_repairs', label: 'Are There Any Non-Warrantable Repairs?', section: 'Repair Details' },
  { key: 'non_warrantable_details', label: 'Non-Warrantable Repair Details (Building Laws / Regulations Reference)', section: 'Repair Details', multiline: true },
  { key: 'pre_existing_required', label: 'Pre-Existing Issues REQUIRED to Be Addressed Before Repairs', section: 'Repair Details', multiline: true },
  { key: 'pre_existing_recommended', label: 'Pre-Existing Issues RECOMMENDED to Be Addressed', section: 'Repair Details', multiline: true },
  { key: 'material_matching_issues', label: 'Issues Regarding Matching of Materials', section: 'Repair Details', multiline: true },
  { key: 'within_authority_to_proceed', label: 'Is the Claim Within Authority to Proceed and Progressing to Repairs?', section: 'Claim Considerations' },
  { key: 'claim_referred_to_insurer', label: 'Does the Claim Need to Be Referred to the Insurer?', section: 'Claim Considerations' },
  { key: 'referral_reason', label: 'Reason for Referral', section: 'Claim Considerations', multiline: true },
  { key: 'estimated_repair_timeframe', label: 'Overall Estimated Repair Timeframe', section: 'Claim Considerations' },
  { key: 'temp_accommodation_required', label: 'Will Temporary Accommodation Be Required?', section: 'Claim Considerations' },
  { key: 'temp_accommodation_details', label: 'Temporary Accommodation Details', section: 'Claim Considerations', multiline: true },
  { key: 'potential_recovery_identified', label: 'Has Any Potential Recovery Been Identified?', section: 'Claim Considerations' },
  { key: 'potential_recovery_details', label: 'Potential Recovery Details', section: 'Claim Considerations', multiline: true },
]

const AUTO_GENERAL_FIELDS: FieldDef[] = [
  { key: 'insurer_brand', label: 'Insurer / Brand', section: 'Claim Details' },
  { key: 'claim_number', label: 'Claim Number', section: 'Claim Details' },
  { key: 'date_of_loss', label: 'Date of Loss', section: 'Claim Details' },
  { key: 'customer_name', label: 'Customer Name', section: 'Claim Details' },
  { key: 'loss_address', label: 'Loss Address', section: 'Claim Details' },
  { key: 'attendance_date', label: 'Attendance Date', section: 'Assessment Report Details' },
  { key: 'time_attended', label: 'Time Attended', section: 'Assessment Report Details' },
  { key: 'assessor_name', label: 'Assessor Name', section: 'Assessment Report Details' },
  { key: 'assessor_contact_number', label: 'Assessor Contact Number', section: 'Assessment Report Details' },
  { key: 'assessor_met_with', label: 'Assessor Met With', section: 'Assessment Report Details' },
  { key: 'amount_of_time_on_site', label: 'Amount of Time on Site', section: 'Assessment Report Details' },
  { key: 'year_property_built', label: 'Year Property Was Built', section: 'Property Details' },
  { key: 'wall_construction_type', label: 'Wall Construction Type', section: 'Property Details' },
  { key: 'roof_type', label: 'Roof Type', section: 'Property Details' },
  { key: 'number_of_storeys', label: 'Number of Storeys', section: 'Property Details' },
  { key: 'under_construction', label: 'Is the Home Under Construction, Alteration, or Renovation Work?', section: 'Property Details' },
  { key: 'construction_removal_detail', label: 'Is This Work Relating to Removal of Roof / External Walls / Building-in Under Home / Removal or Replacement of Stumps?', section: 'Property Details' },
  { key: 'construction_details', label: 'Construction Details', section: 'Property Details', multiline: true },
  { key: 'heritage_listed', label: 'Is the Property Heritage Listed or Have a Heritage Overlay?', section: 'Property Details' },
  { key: 'unoccupied_180_days', label: 'Has the Property Been Unoccupied for More Than 180 Consecutive Days?', section: 'Property Details' },
  { key: 'customer_discussion', label: 'Customer Discussion & Inspection Findings', section: 'Customer Discussion & Inspection Findings', multiline: true },
  { key: 'claim_type', label: 'Claim Type', section: 'Cause of Damage' },
  { key: 'source_room', label: 'Source / Room', section: 'Cause of Damage' },
  { key: 'specific_cause', label: 'Specific Cause', section: 'Cause of Damage' },
  { key: 'cause_details', label: 'Details', section: 'Cause of Damage', multiline: true },
  { key: 'resulting_damage_description', label: 'Description of Resulting Damage', section: 'Resulting Damage', multiline: true },
  { key: 'damage_duration', label: 'How Long Has the Claim-Related Damage Been Occurring?', section: 'Resulting Damage' },
  { key: 'asbestos_present', label: 'Is Exposed and / or Damaged Asbestos Present?', section: 'Resulting Damage' },
  { key: 'electrical_damaged', label: 'Is the Electrical Supply or Electrical Circuit Damaged?', section: 'Resulting Damage' },
  { key: 'mould_present', label: 'Is There Any Mould Present?', section: 'Resulting Damage' },
  { key: 'restoration_required', label: 'Is Any Restoration Required?', section: 'Resulting Damage' },
  { key: 'restoration_works_overview', label: 'Overview of Restoration Works', section: 'Resulting Damage', multiline: true },
  { key: 'restoration_time_estimate', label: 'Estimated Time to Complete Restoration Works', section: 'Resulting Damage' },
  { key: 'contents_claimed', label: 'Are Contents Items (Excluding Carpet) Being Claimed?', section: 'Resulting Damage' },
  { key: 'property_conditions_contributed', label: 'Are There Any Property Conditions That Contributed to the Claim Damage?', section: 'Property Conditions' },
  { key: 'conditions_duration', label: 'How Long Have They Been Occurring?', section: 'Property Conditions' },
  { key: 'conditions_details', label: 'Conditions Details', section: 'Property Conditions', multiline: true },
  { key: 'damage_without_conditions', label: 'If Property Was in Good Condition Prior, Would Damage Still Have Occurred?', section: 'Property Conditions' },
  { key: 'damage_without_conditions_details', label: 'Details', section: 'Property Conditions', multiline: true },
  { key: 'customer_aware_conditions', label: 'Would the Customer Have Been Reasonably Aware of the Property Conditions?', section: 'Property Conditions' },
  { key: 'customer_aware_details', label: 'Details', section: 'Property Conditions', multiline: true },
  { key: 'other_property_issues', label: "Are There Any Other Issues Relating to the Property's Conditions?", section: 'Property Conditions' },
  { key: 'other_property_issues_details', label: 'Details', section: 'Property Conditions', multiline: true },
  { key: 'maintenance_repairs_required', label: 'Are There Any Maintenance Repairs Required to Reduce Risk of Additional Damage?', section: 'Property Conditions' },
  { key: 'urgent_maintenance', label: 'Urgent Maintenance', section: 'Property Conditions', multiline: true },
  { key: 'other_maintenance', label: 'Other Maintenance', section: 'Property Conditions', multiline: true },
  { key: 'conditions_prevent_repairs', label: 'Do Any Property Conditions or Maintenance Items Prevent Warrantable Claim Repairs?', section: 'Property Conditions' },
  { key: 'conditions_prevent_details', label: 'Details', section: 'Property Conditions', multiline: true },
  { key: 'emergency_temp_accommodation', label: 'Does the Customer Require Emergency Temporary Accommodation?', section: 'Temporary Accommodation' },
  { key: 'emergency_temp_timeframe', label: 'Approximate Timeframe', section: 'Temporary Accommodation' },
  { key: 'temp_accommodation_during_repairs', label: 'Does the Customer Require Temporary Accommodation During Repairs?', section: 'Temporary Accommodation' },
  { key: 'temp_accommodation_timeframe', label: 'Approximate Timeframe', section: 'Temporary Accommodation' },
  { key: 'temp_accommodation_notes', label: 'Notes / Special Requirements', section: 'Temporary Accommodation', multiline: true },
  { key: 'property_not_good_condition', label: 'Is the Property Not in Good Condition?', section: 'Underwriting Risk Assessment' },
  { key: 'property_not_structurally_sound', label: 'Is the Property Not Structurally Sound?', section: 'Underwriting Risk Assessment' },
  { key: 'property_not_well_maintained', label: 'Is the Property Not Well Maintained?', section: 'Underwriting Risk Assessment' },
  { key: 'property_not_water_tight', label: 'Is the Property Not Water Tight?', section: 'Underwriting Risk Assessment' },
  { key: 'business_use_airbnb', label: 'Is Any Part of the Home Being Used for a Business, Trade, or Profession (Including AirBNB / Short Stay)?', section: 'Underwriting Risk Assessment' },
  { key: 'underwriting_further_detail', label: 'Further Detail / Other', section: 'Underwriting Risk Assessment', multiline: true },
  { key: 'damage_failed_appliance', label: 'Is the Damage Due to a Failed Appliance / Filter / Hose?', section: 'Recoveries Assessment' },
  { key: 'appliance_less_than_10_years', label: 'Is the Failed Appliance / Filter / Hose Less Than 10 Years Old?', section: 'Recoveries Assessment' },
  { key: 'appliance_salvageable', label: 'Can the Appliance / Filter / Hose Be Salvaged for Recovery Purposes?', section: 'Recoveries Assessment' },
  { key: 'technician_attended', label: 'Has the Customer Had a Technician / Plumber / Trade Attend?', section: 'Recoveries Assessment' },
  { key: 'property_under_10_years', label: 'Is the Property / Renovation Under 10 Years Old?', section: 'Recoveries Assessment' },
  { key: 'builders_trade_details', label: 'Builders / Trade Details', section: 'Recoveries Assessment', multiline: true },
  { key: 'third_party_impact', label: 'Was the Damage Caused by a Third Party Impact?', section: 'Recoveries Assessment' },
  { key: 'third_party_details', label: 'Third Party Details', section: 'Recoveries Assessment', multiline: true },
  { key: 'any_further_details', label: 'Any Further Details / Other', section: 'Recoveries Assessment', multiline: true },
  { key: 'next_steps_home_assessor', label: 'Next Steps — Home Assessor', section: 'Additional Information / Next Steps', multiline: true },
  { key: 'next_steps_claims', label: 'Next Steps — Claims', section: 'Additional Information / Next Steps', multiline: true },
  { key: 'next_steps_builder', label: 'Next Steps — Builder', section: 'Additional Information / Next Steps', multiline: true },
  { key: 'next_steps_specialist', label: 'Next Steps — Specialist', section: 'Additional Information / Next Steps', multiline: true },
  { key: 'next_steps_customer', label: 'Next Steps — Customer', section: 'Additional Information / Next Steps', multiline: true },
  { key: 'report_completed_by', label: 'This Report Has Been Completed By', section: 'Statement of Objectivity' },
  { key: 'individual_experience_qualification', label: 'Individual Experience / Qualification', section: 'Statement of Objectivity' },
  { key: 'performed_under_licence', label: 'Performed Under Licence', section: 'Statement of Objectivity' },
]

const IAG_FIELDS: FieldDef[] = [
  { key: 'claim_number', label: 'Claim Number', section: 'Claim Details' },
  { key: 'insurer', label: 'Insurer', section: 'Claim Details' },
  { key: 'date_of_loss', label: 'Date of Loss', section: 'Claim Details' },
  { key: 'customer_name', label: 'Customer Name', section: 'Claim Details' },
  { key: 'loss_address', label: 'Loss Address', section: 'Claim Details' },
  { key: 'loss_type', label: 'Loss / Claim Type', section: 'Claim Details' },
  { key: 'attendance_date', label: 'Attendance Date', section: 'Assessment Details' },
  { key: 'time_attended', label: 'Time Attended', section: 'Assessment Details' },
  { key: 'assessor_name', label: 'Assessor Name', section: 'Assessment Details' },
  { key: 'assessor_met_with', label: 'Assessor Met With', section: 'Assessment Details' },
  { key: 'time_on_site', label: 'Time on Site', section: 'Assessment Details' },
  { key: 'property_age', label: 'Approximate Property Age', section: 'Property Details' },
  { key: 'wall_construction', label: 'Wall Construction Type', section: 'Property Details' },
  { key: 'roof_type', label: 'Roof Type', section: 'Property Details' },
  { key: 'number_of_storeys', label: 'Number of Storeys', section: 'Property Details' },
  { key: 'property_condition', label: 'Overall Property Condition', section: 'Property Details' },
  { key: 'heritage_listed', label: 'Is the Property Heritage Listed?', section: 'Property Details' },
  { key: 'client_stated', label: 'Client Stated', section: 'Inspection Findings', multiline: true },
  { key: 'areas_affected', label: 'Areas of Property Affected', section: 'Inspection Findings', multiline: true },
  { key: 'cause_of_loss', label: 'Cause of Loss', section: 'Inspection Findings', multiline: true },
  { key: 'damage_description', label: 'Description of Damage', section: 'Inspection Findings', multiline: true },
  { key: 'pre_existing_damage', label: 'Pre-Existing Damage / Conditions', section: 'Inspection Findings', multiline: true },
  { key: 'damage_long_term_or_single', label: 'Is the Damage Long Term or Single Event?', section: 'Inspection Findings' },
  { key: 'property_conditions_contributed', label: 'Did Property Conditions Contribute to the Damage?', section: 'Property Conditions' },
  { key: 'conditions_details', label: 'Property Conditions Details', section: 'Property Conditions', multiline: true },
  { key: 'customer_aware_conditions', label: 'Was the Customer Reasonably Aware of These Conditions?', section: 'Property Conditions' },
  { key: 'maintenance_required', label: 'Maintenance Required', section: 'Property Conditions', multiline: true },
  { key: 'specialist_required', label: 'Is a Specialist Report Required?', section: 'Specialist & Make Safe' },
  { key: 'specialist_details', label: 'Specialist Details', section: 'Specialist & Make Safe', multiline: true },
  { key: 'make_safe_required', label: 'Is a Make Safe Required?', section: 'Specialist & Make Safe' },
  { key: 'make_safe_details', label: 'Make Safe Details', section: 'Specialist & Make Safe', multiline: true },
  { key: 'claim_assessment', label: 'Claim Assessment', section: 'Claim Assessment', multiline: true },
  { key: 'authority_to_proceed', label: 'Authority to Proceed?', section: 'Claim Assessment' },
  { key: 'referral_required', label: 'Referral Required?', section: 'Claim Assessment' },
  { key: 'referral_reason', label: 'Referral Reason', section: 'Claim Assessment', multiline: true },
  { key: 'estimated_timeframe', label: 'Estimated Repair Timeframe', section: 'Claim Assessment' },
  { key: 'temp_accommodation_required', label: 'Temporary Accommodation Required?', section: 'Claim Assessment' },
  { key: 'temp_accommodation_details', label: 'Accommodation Details', section: 'Claim Assessment', multiline: true },
  { key: 'recovery_potential', label: 'Recovery Potential?', section: 'Claim Assessment' },
  { key: 'recovery_details', label: 'Recovery Details', section: 'Claim Assessment', multiline: true },
  { key: 'assessor_comments', label: 'Assessor Comments', section: 'Assessor Sign-off', multiline: true },
  { key: 'assessor_name_signoff', label: 'Assessor Name', section: 'Assessor Sign-off' },
  { key: 'licence_number', label: 'Licence Number', section: 'Assessor Sign-off' },
]

function getTemplateFields(t: InsuranceTemplate): FieldDef[] {
  if (t === 'aai') return AAI_FIELDS
  if (t === 'auto_general') return AUTO_GENERAL_FIELDS
  return IAG_FIELDS
}

function InsuranceTemplateRenderer({
  fields,
  values,
  onChange,
}: {
  fields: FieldDef[]
  values: Record<string, string>
  onChange: (key: string, val: string) => void
}) {
  const sections: { section: string; items: FieldDef[] }[] = []
  for (const f of fields) {
    const last = sections[sections.length - 1]
    if (last && last.section === f.section) last.items.push(f)
    else sections.push({ section: f.section, items: [f] })
  }
  return (
    <>
      {sections.map(s => (
        <div key={s.section}>
          <div className="mc-section-head">{s.section}</div>
          {s.items.map(f => (
            <div key={f.key} className="fa-fg">
              <label className="fa-fl">{f.label}</label>
              {f.multiline ? (
                <textarea
                  className="fa-ta"
                  style={{ minHeight: 70 }}
                  value={values[f.key] ?? ''}
                  onChange={e => onChange(f.key, e.target.value)}
                />
              ) : (
                <input
                  className="fa-input"
                  type="text"
                  value={values[f.key] ?? ''}
                  onChange={e => onChange(f.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

function uid() { return Math.random().toString(36).slice(2) }

async function processPhotoForUpload(file: File): Promise<File> {
  const TARGET_BYTES = 125 * 1024
  const MAX_DIM = 1600

  return new Promise(resolve => {
    const img = new Image()
    const objUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objUrl)
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w > MAX_DIM || h > MAX_DIM) {
        const scale = Math.min(MAX_DIM / w, MAX_DIM / h)
        w = Math.round(w * scale)
        h = Math.round(h * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      const compress = (quality: number) => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return }
          if (blob.size > TARGET_BYTES && quality > 0.55) { compress(Math.round((quality - 0.08) * 100) / 100); return }
          const baseName = file.name.replace(/\.(heic|heif)$/i, '')
          const jpegName = baseName.match(/\.(jpe?g)$/i) ? file.name : `${baseName}.jpg`
          resolve(new File([blob], jpegName, { type: 'image/jpeg', lastModified: Date.now() }))
        }, 'image/jpeg', quality)
      }
      compress(0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(file) }
    img.src = objUrl
  })
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MidcityFieldApp({ initialData }: { initialData: InitialData }) {
  const base = `/api/field/${initialData.inspectionId}`

  // ─── Common fields ────────────────────────────────────────────────────────
  const [personMet, setPersonMet] = useState(initialData.personMet ?? initialData.insuredName ?? '')
  const [relation, setRelation] = useState('')
  const [propDesc, setPropDesc] = useState('')

  // ─── Report enable states (pill checkboxes) ───────────────────────────────
  const [barEnabled, setBarEnabled] = useState(false)
  const [makeSafeEnabled, setMakeSafeEnabled] = useState(false)
  const [roofEnabled, setRoofEnabled] = useState(false)

  // ─── BAR fields ───────────────────────────────────────────────────────────
  const [scopeRooms, setScopeRooms] = useState<ScopeRoom[]>([])
  const [rawReportNotes, setRawReportNotes] = useState('')
  const [insuranceTemplate, setInsuranceTemplate] = useState<InsuranceTemplate | ''>('')
  const [insuranceFields, setInsuranceFields] = useState<Record<string, string>>({})
  const [insuranceFieldsOpen, setInsuranceFieldsOpen] = useState(false)

  // ─── Make Safe fields ─────────────────────────────────────────────────────
  const [msWorksCompleted, setMsWorksCompleted] = useState('')
  const [msTempFixes, setMsTempFixes] = useState('')
  const [msHours, setMsHours] = useState('')

  // ─── Roof Report fields ───────────────────────────────────────────────────
  const [roofRawNotes, setRoofRawNotes] = useState('')
  const [roofPhotos, setRoofPhotos] = useState<PhotoEntry[]>([])
  const [roofPhotoContext, setRoofPhotoContext] = useState('')
  const [roofAiLabeling, setRoofAiLabeling] = useState(false)
  const [roofAiLabelDone, setRoofAiLabelDone] = useState(false)
  const roofPhotoInputRef = useRef<HTMLInputElement>(null)

  // ─── Roof Report structured fields ───────────────────────────────────────
  const [roofReportFields, setRoofReportFields] = useState<RoofReportData>(emptyRoofReport)
  const [roofFieldsOpen, setRoofFieldsOpen] = useState(false)
  const [roofReportGenerating, setRoofReportGenerating] = useState(false)

  // ─── Damage Templates ────────────────────────────────────────────────────
  const [barDamageTemplate, setBarDamageTemplate] = useState<string | null>(null)
  const [barDamageTemplateSaved, setBarDamageTemplateSaved] = useState(true)
  const [isNewBarDamageTemplate, setIsNewBarDamageTemplate] = useState(false)
  const [msDamageTemplate, setMsDamageTemplate] = useState<string | null>(null)
  const [msDamageTemplateSaved, setMsDamageTemplateSaved] = useState(true)
  const [isNewMsDamageTemplate, setIsNewMsDamageTemplate] = useState(false)
  const [roofDamageTemplate, setRoofDamageTemplate] = useState<string | null>(null)
  const [roofDamageTemplateSaved, setRoofDamageTemplateSaved] = useState(true)
  const [isNewRoofDamageTemplate, setIsNewRoofDamageTemplate] = useState(false)

  // ─── Save / export state ─────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState('')
  const [barExporting, setBarExporting] = useState(false)
  const [makeSafeExporting, setMakeSafeExporting] = useState(false)
  const [roofExporting, setRoofExporting] = useState(false)
  const [roofPreviewOpen, setRoofPreviewOpen] = useState(false)

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFocusRoomRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingFocusRoomRef.current) return
    const roomId = pendingFocusRoomRef.current
    pendingFocusRoomRef.current = null
    setTimeout(() => {
      const inputs = document.querySelectorAll(`[data-room-id="${roomId}"] .fa-scope-input`)
      ;(inputs[inputs.length - 1] as HTMLInputElement | undefined)?.focus()
    }, 0)
  }, [scopeRooms])

  function focusNextInput(current: HTMLElement) {
    const all = Array.from(document.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([type="file"]):not([type="hidden"]), textarea:not([disabled])'
    ))
    const idx = all.indexOf(current)
    if (idx >= 0 && idx < all.length - 1) all[idx + 1].focus()
  }

  // ─── Draft Save/Restore ───────────────────────────────────────────────────
  const collectDraft = useCallback(() => ({
    personMet, relation, propDesc,
    barEnabled, makeSafeEnabled, roofEnabled,
    scopeRooms: scopeRooms.map(r => ({ ...r, items: r.items.map(i => i.text) })),
    rawReportNotes,
    insuranceTemplate, insuranceFields, insuranceFieldsOpen,
    msWorksCompleted, msTempFixes, msHours,
    roofRawNotes, roofPhotoContext,
    roofReportFields, roofFieldsOpen,
    damage_template: barDamageTemplate, damage_template_saved: barDamageTemplateSaved,
    ms_damage_template: msDamageTemplate, ms_damage_template_saved: msDamageTemplateSaved,
    roof_damage_template: roofDamageTemplate, roof_damage_template_saved: roofDamageTemplateSaved,
  }), [personMet, relation, propDesc, barEnabled, makeSafeEnabled, roofEnabled, scopeRooms, rawReportNotes, insuranceTemplate, insuranceFields, insuranceFieldsOpen, msWorksCompleted, msTempFixes, msHours, roofRawNotes, roofPhotoContext, roofReportFields, roofFieldsOpen, barDamageTemplate, barDamageTemplateSaved, msDamageTemplate, msDamageTemplateSaved, roofDamageTemplate, roofDamageTemplateSaved])

  const armDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: collectDraft() }) })
        setSaveStatus('Saved')
        setTimeout(() => setSaveStatus(''), 2000)
      } catch { setSaveStatus('Save failed') }
    }, 3000)
  }, [base, collectDraft])

  useEffect(() => {
    const flush = () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      const blob = new Blob([JSON.stringify({ draft: collectDraft() })], { type: 'application/json' })
      navigator.sendBeacon(`${base}/draft`, blob)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [base, collectDraft])

  useEffect(() => {
    const d = initialData.fieldDraft as Record<string, unknown> | null
    if (!d) return
    if (d.personMet) setPersonMet(d.personMet as string)
    if (d.relation) setRelation(d.relation as string)
    if (d.propDesc) setPropDesc(d.propDesc as string)
    if (d.barEnabled) setBarEnabled(d.barEnabled as boolean)
    if (d.makeSafeEnabled) setMakeSafeEnabled(d.makeSafeEnabled as boolean)
    if (d.roofEnabled) setRoofEnabled(d.roofEnabled as boolean)
    if (d.rawReportNotes) setRawReportNotes(d.rawReportNotes as string)
    if (d.insuranceTemplate) setInsuranceTemplate(d.insuranceTemplate as InsuranceTemplate)
    if (d.insuranceFields) setInsuranceFields(d.insuranceFields as Record<string, string>)
    if (d.insuranceFieldsOpen) setInsuranceFieldsOpen(d.insuranceFieldsOpen as boolean)
    if (d.msWorksCompleted) setMsWorksCompleted(d.msWorksCompleted as string)
    if (d.msTempFixes) setMsTempFixes(d.msTempFixes as string)
    if (d.msHours) setMsHours(d.msHours as string)
    if (d.roofRawNotes) setRoofRawNotes(d.roofRawNotes as string)
    if (d.roofPhotoContext) setRoofPhotoContext(d.roofPhotoContext as string)
    if (d.roofReportFields) setRoofReportFields(prev => ({ ...prev, ...(d.roofReportFields as RoofReportData) }))
    if (d.roofFieldsOpen) setRoofFieldsOpen(d.roofFieldsOpen as boolean)
    if (d.damage_template) setBarDamageTemplate(d.damage_template as string)
    if (typeof d.damage_template_saved === 'boolean') setBarDamageTemplateSaved(d.damage_template_saved as boolean)
    if (d.ms_damage_template) setMsDamageTemplate(d.ms_damage_template as string)
    if (typeof d.ms_damage_template_saved === 'boolean') setMsDamageTemplateSaved(d.ms_damage_template_saved as boolean)
    if (d.roof_damage_template) setRoofDamageTemplate(d.roof_damage_template as string)
    if (typeof d.roof_damage_template_saved === 'boolean') setRoofDamageTemplateSaved(d.roof_damage_template_saved as boolean)
    if (d.scopeRooms) {
      const rooms = (d.scopeRooms as Array<{ id?: string; name: string; l: string; w: string; h: string; items: string[] }>)
      setScopeRooms(rooms.map(r => ({ id: r.id ?? uid(), name: r.name, l: r.l, w: r.w, h: r.h, items: r.items.map(text => ({ id: uid(), text })) })))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Load persisted photos on mount ──────────────────────────────────────
  useEffect(() => {
    fetch(`${base}/photos`)
      .then(r => r.json())
      .then((data: { photos?: { id: string; url: string | null; label: string }[] }) => {
        if (data.photos?.length) {
          setRoofPhotos(data.photos.map(p => ({
            id: uid(),
            photoId: p.id,
            file: null,
            previewUrl: p.url ?? '',
            label: p.label,
            processing: false,
            uploading: false,
          })))
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Room helpers ─────────────────────────────────────────────────────────
  const addRoom = () => {
    setScopeRooms(prev => [...prev, { id: uid(), name: '', l: '', w: '', h: '', items: [{ id: uid(), text: '' }] }])
    armDraft()
  }

  const updateRoom = (roomId: string, key: keyof ScopeRoom, value: string) => {
    setScopeRooms(prev => prev.map(r => r.id === roomId ? { ...r, [key]: value } : r))
    armDraft()
  }

  const addScopeItem = (roomId: string) => {
    setScopeRooms(prev => prev.map(r => r.id === roomId ? { ...r, items: [...r.items, { id: uid(), text: '' }] } : r))
  }

  const updateScopeItem = (roomId: string, itemId: string, text: string) => {
    setScopeRooms(prev => prev.map(r => r.id === roomId ? { ...r, items: r.items.map(i => i.id === itemId ? { ...i, text } : i) } : r))
    armDraft()
  }

  const removeScopeItem = (roomId: string, itemId: string) => {
    setScopeRooms(prev => prev.map(r => r.id === roomId ? { ...r, items: r.items.filter(i => i.id !== itemId) } : r))
    armDraft()
  }

  const removeRoom = (roomId: string) => {
    setScopeRooms(prev => prev.filter(r => r.id !== roomId))
    armDraft()
  }

  // ─── Roof photo helpers ───────────────────────────────────────────────────
  const handleRoofPhotos = (files: FileList | null) => {
    if (!files) return
    setRoofAiLabelDone(false)
    Array.from(files).forEach(file => {
      const id = uid()
      const rawPreview = URL.createObjectURL(file)
      setRoofPhotos(prev => [...prev, { id, photoId: null, file, previewUrl: rawPreview, label: '', processing: true, uploading: false }])
      processPhotoForUpload(file).then(async processed => {
        const processedPreview = URL.createObjectURL(processed)
        setRoofPhotos(prev => prev.map(p => {
          if (p.id !== id) return p
          URL.revokeObjectURL(p.previewUrl)
          return { ...p, file: processed, previewUrl: processedPreview, processing: false, uploading: true }
        }))
        try {
          const fd = new FormData()
          fd.append('file', processed)
          fd.append('isRoofPhoto', 'true')
          const res = await fetch(`${base}/photos`, { method: 'POST', body: fd })
          const data = await res.json()
          if (data.id) {
            setRoofPhotos(prev => prev.map(p => p.id !== id ? p : { ...p, photoId: data.id, previewUrl: data.url ?? p.previewUrl, file: null, uploading: false }))
            armDraft()
          } else {
            setRoofPhotos(prev => prev.map(p => p.id === id ? { ...p, uploading: false } : p))
          }
        } catch {
          setRoofPhotos(prev => prev.map(p => p.id === id ? { ...p, uploading: false } : p))
        }
      })
    })
  }

  const removeRoofPhoto = (id: string) => {
    setRoofPhotos(prev => {
      const p = prev.find(x => x.id === id)
      if (p) {
        URL.revokeObjectURL(p.previewUrl)
        if (p.photoId) {
          fetch(`${base}/photos?photoId=${p.photoId}`, { method: 'DELETE' }).catch(() => {})
        }
      }
      return prev.filter(x => x.id !== id)
    })
    armDraft()
  }

  const runRoofAILabels = async () => {
    if (!roofPhotoContext.trim()) { alert('Add a photo description first.'); return }
    if (!roofPhotos.length) { alert('No photos to label.'); return }
    if (roofPhotos.some(p => p.processing || p.uploading)) { alert('Photos are still saving — please wait a moment.'); return }
    setRoofAiLabeling(true)
    try {
      const res = await fetch(`${base}/ai-label-roof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: roofPhotoContext, photoCount: roofPhotos.length, jobContext: { lossType: initialData.lossType, insurer: 'Midcity', address: initialData.address } }),
      })
      const data = await res.json()
      if (data.ok && data.labels?.length) {
        const newLabels: string[] = data.labels
        const labeled = roofPhotos.map((p, i) => ({ ...p, label: newLabels[i] ?? p.label }))
        setRoofPhotos(labeled)
        setRoofAiLabelDone(true)
        labeled.forEach(p => {
          if (p.photoId) {
            fetch(`${base}/photos`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoId: p.photoId, label: p.label }) }).catch(() => {})
          }
        })
      }
    } catch { /* keep existing labels */ }
    setRoofAiLabeling(false)
  }

  // ─── Roof report field helper ─────────────────────────────────────────────
  const setRoofField = (key: keyof RoofReportData, value: string) => {
    setRoofReportFields(prev => ({ ...prev, [key]: value }))
    armDraft()
  }

  // ─── Generate Roof Report from raw notes ──────────────────────────────────
  const generateRoofReport = async () => {
    if (!roofRawNotes.trim()) { alert('Add raw notes first.'); return }
    setRoofReportGenerating(true)
    try {
      const res = await fetch('/api/midcity/generate-roof-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawNotes: roofRawNotes,
          inspectorName: initialData.inspector,
          personMet,
          relation,
          propDesc,
          address: initialData.address,
          insuredName: initialData.insuredName,
          claimNumber: initialData.claimNumber,
          insurer: initialData.insurer,
          scheduledDate: initialData.scheduledDate,
          lossType: initialData.lossType,
        }),
      })
      const data = await res.json()
      if (data.ok && data.reportData) {
        const rd = data.reportData as Record<string, string>
        setRoofReportFields(prev => ({
          ...prev,
          ...rd,
          rooferName: '',
          rooferQualification: '',
          timeOnSite: rd.timeOnSite || prev.timeOnSite,
          scopeOfAssessment: rd.scopeOfAssessment || prev.scopeOfAssessment,
        }))
        setRoofFieldsOpen(true)
        armDraft()
      } else {
        alert('Failed to generate report. Please try again.')
      }
    } catch {
      alert('Error generating report. Check your connection.')
    }
    setRoofReportGenerating(false)
  }

  // ─── Insurance template field helper ─────────────────────────────────────
  const setInsuranceField = (key: string, val: string) => {
    setInsuranceFields(prev => ({ ...prev, [key]: val }))
  }

  // ─── CSV export ───────────────────────────────────────────────────────────
  const exportInsuranceCSV = () => {
    if (!insuranceTemplate || !Object.keys(insuranceFields).length) return
    const templateFields = getTemplateFields(insuranceTemplate)
    const rows = templateFields.map(f => {
      const val = String(insuranceFields[f.key] ?? '')
      const escaped = `"${val.replace(/"/g, '""')}"`
      return `"${f.label}",${escaped}`
    })
    const csv = 'Field,Value\n' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${insuranceTemplate}_report_${initialData.claimNumber ?? 'claim'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Export handlers ──────────────────────────────────────────────────────
  const handleExportBAR = async () => {
    if (!insuranceTemplate) {
      alert('Please select an insurance template before exporting.')
      return
    }
    setBarExporting(true)
    try {
      const scopeRoomsSummary = scopeRooms
        .filter(r => r.name || r.items.some(i => i.text))
        .map(r => `${r.name}: ${r.items.map(i => i.text).filter(Boolean).join(', ')}`)
        .join('\n')

      const res = await fetch('/api/midcity/generate-insurance-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawNotes: rawReportNotes,
          template: insuranceTemplate,
          claimNumber: initialData.claimNumber,
          insuredName: initialData.insuredName,
          address: initialData.address,
          insurer: initialData.insurer,
          dateOfLoss: initialData.dateOfLoss,
          inspector: initialData.inspector,
          scheduledDate: initialData.scheduledDate,
          lossType: initialData.lossType,
          personMet,
          propDesc,
          scopeRoomsSummary,
        }),
      })
      const data = await res.json()
      if (data.ok && data.fields) {
        setInsuranceFields(data.fields)
        setInsuranceFieldsOpen(true)
        armDraft()
      } else {
        alert('Failed to generate template. Please try again.')
      }
    } catch {
      alert('Error generating template. Check your connection.')
    }
    setBarExporting(false)
  }

  const handleExportMakeSafe = async () => {
    setMakeSafeExporting(true)
    // TODO: wire up Make Safe export
    setMakeSafeExporting(false)
  }

  const handleExportRoof = () => {
    setRoofPreviewOpen(true)
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
    <div className="fa-root">

      {/* HEADER */}
      <div className="fa-header">
        <a href="/midcity" className="mc-home-btn">← Home</a>
        <div className="mc-hdr-body">
          <div className="mc-hdr-address">{initialData.address ?? '—'}</div>
          <div className="mc-hdr-sub">
            {[
              initialData.jobNumber,
              initialData.lossType,
              initialData.dateOfLoss ? formatDate(initialData.dateOfLoss) : null,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        {saveStatus && <div className="fa-save-indicator">{saveStatus}</div>}
      </div>

      {/* ── 01 SITE DETAILS ───────────────────────────────────────────────── */}
      <div className="fa-sc" id="sec-details">
        <div className="fa-sc-head">
          <div className="fa-sc-circle active">01</div>
          <div className="fa-sc-meta">
            <h3>Site Details</h3>
            <p>Person met · property description</p>
          </div>
          <span className="fa-badge req">Required</span>
        </div>
        <div className="fa-sc-body">
          <div style={{ padding: '16px 0' }}>
            <div className="fa-fg">
              <label className="fa-fl">Person Met On Site <span className="req">*</span></label>
              <input
                className="fa-input"
                type="text"
                value={personMet}
                onChange={e => { setPersonMet(e.target.value); armDraft() }}
                placeholder="Full name"
                enterKeyHint="next"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }}
              />
            </div>
            <div className="fa-fg">
              <label className="fa-fl">Relation to Property</label>
              <div className="fa-rg inline">
                {['Owner', 'Tenant', 'Agent', 'Other'].map(r => (
                  <button key={r} className={`fa-ro${relation === r ? ' sel' : ''}`} onClick={() => { setRelation(r); armDraft() }}>{r}</button>
                ))}
              </div>
            </div>
            <div className="fa-fg">
              <label className="fa-fl">Property Description</label>
              <textarea
                className="fa-ta"
                placeholder="e.g. Single storey brick veneer, tiled roof, circa 1985…"
                style={{ minHeight: 90 }}
                value={propDesc}
                onChange={e => { setPropDesc(e.target.value); armDraft() }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 02 REPORTS ───────────────────────────────────────────────────── */}
      <div className="fa-sc" id="sec-reports">
        <div className="fa-sc-head">
          <div className="fa-sc-circle active">02</div>
          <div className="fa-sc-meta">
            <h3>Reports</h3>
            <p>Tick to activate · complete · export</p>
          </div>
        </div>
        <div className="fa-sc-body">
          <div className="mc-pills-wrap">

            {/* ── BAR ────────────────────────────────────────────────────── */}
            <div className={`mc-pill${barEnabled ? ' enabled' : ''}`}>
              <div className="mc-pill-header" onClick={() => { setBarEnabled(p => !p); armDraft() }}>
                <div className="mc-pill-check">{barEnabled ? '✓' : ''}</div>
                <div className="mc-pill-info">
                  <div className="mc-pill-name">Building Assessment Report</div>
                  <div className="mc-pill-sub">BAR · Scope notes + damage assessment</div>
                </div>
                <div className="mc-pill-arrow">{barEnabled ? '▾' : '›'}</div>
              </div>

              {barEnabled && (
                <div className="mc-pill-body">

                  {/* Scope Notes */}
                  <div className="mc-section-head">Scope Notes</div>
                  <div style={{ paddingTop: 12 }}>
                    {scopeRooms.map(room => (
                      <div key={room.id} className="fa-room-block" data-room-id={room.id}>
                        <div className="fa-room-head">
                          <input
                            className="fa-room-name"
                            type="text"
                            placeholder="Room name"
                            value={room.name}
                            onChange={e => updateRoom(room.id, 'name', e.target.value)}
                            enterKeyHint="next"
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, marginLeft: 4 }}>
                            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>L</span>
                            <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.l} onChange={e => updateRoom(room.id, 'l', e.target.value)} enterKeyHint="next" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }} />
                            <span style={{ fontSize: 9, color: 'var(--border)' }}>×</span>
                            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>W</span>
                            <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.w} onChange={e => updateRoom(room.id, 'w', e.target.value)} enterKeyHint="next" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }} />
                            <span style={{ fontSize: 9, color: 'var(--border)' }}>×</span>
                            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8, color: 'var(--muted)' }}>H</span>
                            <input className="fa-dim-input" placeholder="-" maxLength={5} value={room.h} onChange={e => updateRoom(room.id, 'h', e.target.value)} enterKeyHint="next" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextInput(e.currentTarget) } }} />
                          </div>
                          <button style={{ background: 'none', border: 'none', color: 'var(--border)', fontSize: 16, cursor: 'pointer', padding: '0 4px', flexShrink: 0 }} onClick={() => removeRoom(room.id)}>×</button>
                        </div>
                        <div className="fa-room-body">
                          {room.items.map(item => (
                            <div key={item.id} className="fa-scope-row">
                              <input
                                className="fa-scope-input"
                                type="text"
                                placeholder="Scope item"
                                value={item.text}
                                onChange={e => updateScopeItem(room.id, item.id, e.target.value)}
                                enterKeyHint="done"
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    pendingFocusRoomRef.current = room.id
                                    addScopeItem(room.id)
                                    armDraft()
                                  }
                                }}
                              />
                              <button className="fa-scope-del" onClick={() => removeScopeItem(room.id, item.id)}>×</button>
                            </div>
                          ))}
                          <button className="fa-add-btn" onClick={() => addScopeItem(room.id)}>+ Add Item</button>
                        </div>
                      </div>
                    ))}
                    <div style={{ padding: '8px 12px 16px' }}>
                      <button onClick={addRoom} className="mc-add-room-btn">+ Add Room</button>
                    </div>
                  </div>

                  {/* Raw Report Notes */}
                  <div className="mc-section-head">Report Notes</div>
                  <div style={{ padding: '12px 16px 0' }}>
                    <TemplateSelectorField
                      reportType="BAR"
                      value={barDamageTemplate}
                      onChange={name => { setBarDamageTemplate(name); setIsNewBarDamageTemplate(false); armDraft() }}
                      onTemplateSaved={name => { setBarDamageTemplate(name); setIsNewBarDamageTemplate(true); armDraft() }}
                    />
                    {isNewBarDamageTemplate && barDamageTemplate && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 10, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={barDamageTemplateSaved}
                          onChange={e => { setBarDamageTemplateSaved(e.target.checked); armDraft() }}
                          style={{ width: 14, height: 14, accentColor: 'var(--black)' }}
                        />
                        Save as template for future jobs
                      </label>
                    )}
                  </div>
                  <div className="fa-ai-dark">
                    <div className="fa-ai-dark-head">
                      <span style={{ fontSize: 14 }}>✦</span>
                      <span className="fa-ai-dark-title">AI Report Generation</span>
                    </div>
                    <div className="fa-ai-hints">
                      {['What was damaged', 'Cause of damage', 'Pre-existing conditions', 'Any maintenance noted', 'Extent of damage', 'Structural concerns'].map(hint => (
                        <div key={hint} className="fa-ai-hint">{hint}</div>
                      ))}
                    </div>
                    <div className="fa-ai-dark-body">
                      <textarea
                        className="fa-ai-dark-ta"
                        placeholder="Describe the damage, cause, and your findings in plain language. AI will structure this into a professional report…"
                        style={{ minHeight: 130 }}
                        value={rawReportNotes}
                        onChange={e => { setRawReportNotes(e.target.value); armDraft() }}
                      />
                    </div>
                  </div>

                  {/* Insurance Template Select */}
                  <div className="fa-fg" style={{ paddingTop: 16 }}>
                    <label className="fa-fl">Insurance Template</label>
                    <select
                      className="fa-input"
                      style={{ appearance: 'auto' as never }}
                      value={insuranceTemplate}
                      onChange={e => { setInsuranceTemplate(e.target.value as InsuranceTemplate | ''); armDraft() }}
                    >
                      <option value="">Select template…</option>
                      <option value="aai">AAI Limited</option>
                      <option value="auto_general">Auto &amp; General</option>
                      <option value="iag">IAG</option>
                    </select>
                  </div>

                  {/* Export */}
                  <div className="mc-export-wrap">
                    <button
                      className="mc-export-btn"
                      onClick={handleExportBAR}
                      disabled={barExporting}
                    >
                      {barExporting ? <><span className="fa-spinner" /> Generating Template…</> : 'Export Report'}
                    </button>
                  </div>

                  {/* Generated Insurance Template Fields */}
                  {insuranceTemplate && Object.keys(insuranceFields).length > 0 && (
                    <div>
                      <div
                        className="mc-rrf-head"
                        onClick={() => setInsuranceFieldsOpen(p => !p)}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: 'var(--off)', borderTop: '1px solid var(--border)' }}
                      >
                        <span className="mc-rrf-head-label" style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text)', fontWeight: 500 }}>
                          📋 {insuranceTemplate === 'aai' ? 'AAI Limited' : insuranceTemplate === 'auto_general' ? 'Auto & General' : 'IAG'} Template Fields
                        </span>
                        <span className="mc-rrf-arrow">{insuranceFieldsOpen ? '▾' : '›'}</span>
                      </div>
                      {insuranceFieldsOpen && (
                        <div style={{ background: 'white', paddingBottom: 8 }}>
                          <InsuranceTemplateRenderer
                            fields={getTemplateFields(insuranceTemplate)}
                            values={insuranceFields}
                            onChange={(key, val) => { setInsuranceField(key, val); armDraft() }}
                          />
                          <div className="mc-export-wrap" style={{ paddingTop: 4 }}>
                            <button
                              className="mc-export-btn"
                              onClick={exportInsuranceCSV}
                              style={{ background: 'var(--green)' }}
                            >
                              Export to CSV
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── MAKE SAFE ────────────────────────────────────────────────── */}
            <div className={`mc-pill${makeSafeEnabled ? ' enabled' : ''}`}>
              <div className="mc-pill-header" onClick={() => { setMakeSafeEnabled(p => !p); armDraft() }}>
                <div className="mc-pill-check">{makeSafeEnabled ? '✓' : ''}</div>
                <div className="mc-pill-info">
                  <div className="mc-pill-name">Make Safe</div>
                  <div className="mc-pill-sub">Emergency works completed on site</div>
                </div>
                <div className="mc-pill-arrow">{makeSafeEnabled ? '▾' : '›'}</div>
              </div>

              {makeSafeEnabled && (
                <div className="mc-pill-body">
                  <div className="mc-section-head">Make Safe Fields</div>
                  <div style={{ padding: '14px 18px' }}>
                    <TemplateSelectorField
                      reportType="make_safe"
                      value={msDamageTemplate}
                      onChange={name => { setMsDamageTemplate(name); setIsNewMsDamageTemplate(false); armDraft() }}
                      onTemplateSaved={name => { setMsDamageTemplate(name); setIsNewMsDamageTemplate(true); armDraft() }}
                    />
                    {isNewMsDamageTemplate && msDamageTemplate && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 10, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={msDamageTemplateSaved}
                          onChange={e => { setMsDamageTemplateSaved(e.target.checked); armDraft() }}
                          style={{ width: 14, height: 14, accentColor: 'var(--black)' }}
                        />
                        Save as template for future jobs
                      </label>
                    )}
                    <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                      <label className="fa-fl">Works Completed On Site</label>
                      <textarea className="fa-ta" placeholder="Describe emergency make safe works carried out…" value={msWorksCompleted} onChange={e => { setMsWorksCompleted(e.target.value); armDraft() }} />
                    </div>
                    <div className="fa-fg" style={{ padding: 0, marginBottom: 14 }}>
                      <label className="fa-fl">Temporary Measures</label>
                      <textarea className="fa-ta" placeholder="Tarps, boarding, temporary repairs…" style={{ minHeight: 70 }} value={msTempFixes} onChange={e => { setMsTempFixes(e.target.value); armDraft() }} />
                    </div>
                    <div className="fa-fg" style={{ padding: 0, marginBottom: 0 }}>
                      <label className="fa-fl">Hours on Site</label>
                      <input className="fa-input" type="text" placeholder="e.g. 2.5 hrs" value={msHours} onChange={e => { setMsHours(e.target.value); armDraft() }} />
                    </div>
                  </div>

                  {/* Export */}
                  <div className="mc-export-wrap">
                    <button
                      className="mc-export-btn"
                      onClick={handleExportMakeSafe}
                      disabled={makeSafeExporting}
                    >
                      {makeSafeExporting ? <><span className="fa-spinner" /> Exporting…</> : 'Export Report'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── ROOF REPORT ──────────────────────────────────────────────── */}
            <div className={`mc-pill${roofEnabled ? ' enabled' : ''}`} style={{ marginBottom: 8 }}>
              <div className="mc-pill-header" onClick={() => { setRoofEnabled(p => !p); armDraft() }}>
                <div className="mc-pill-check">{roofEnabled ? '✓' : ''}</div>
                <div className="mc-pill-info">
                  <div className="mc-pill-name">Roof Report</div>
                  <div className="mc-pill-sub">Roof-specific inspection and assessment</div>
                </div>
                <div className="mc-pill-arrow">{roofEnabled ? '▾' : '›'}</div>
              </div>

              {roofEnabled && (
                <div className="mc-pill-body">
                  <div className="mc-section-head">Roof Report</div>
                  <div style={{ padding: '12px 16px 0' }}>
                    <TemplateSelectorField
                      reportType="roof"
                      value={roofDamageTemplate}
                      onChange={name => { setRoofDamageTemplate(name); setIsNewRoofDamageTemplate(false); armDraft() }}
                      onTemplateSaved={name => { setRoofDamageTemplate(name); setIsNewRoofDamageTemplate(true); armDraft() }}
                    />
                    {isNewRoofDamageTemplate && roofDamageTemplate && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 10, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={roofDamageTemplateSaved}
                          onChange={e => { setRoofDamageTemplateSaved(e.target.checked); armDraft() }}
                          style={{ width: 14, height: 14, accentColor: 'var(--black)' }}
                        />
                        Save as template for future jobs
                      </label>
                    )}
                  </div>

                  {/* Raw Notes */}
                  <div className="fa-ai-dark">
                    <div className="fa-ai-dark-head">
                      <span style={{ fontSize: 14 }}>✦</span>
                      <span className="fa-ai-dark-title">Roof Report Raw Notes</span>
                    </div>
                    <div className="fa-ai-hints">
                      {['Roof type', 'Roof condition', 'Roof pitch', 'Penetrations', 'Insulation', 'Solar PV', 'Solar HWS', 'Skylights', 'Gutters', 'Downpipes', 'Batten size', 'Claim type', 'Damage cause', 'Entry points', 'Client stated', 'Conditions contributed', 'Insured aware', 'Maintenance items', 'Prior repairs', 'Code violations', 'Make safe'].map(hint => (
                        <div key={hint} className="fa-ai-hint">{hint}</div>
                      ))}
                    </div>
                    <div className="fa-ai-dark-body">
                      <textarea
                        className="fa-ai-dark-ta"
                        placeholder="Dictate roof inspection details covering all fields above. AI will generate the full roof report…"
                        style={{ minHeight: 130 }}
                        value={roofRawNotes}
                        onChange={e => { setRoofRawNotes(e.target.value); armDraft() }}
                      />
                      <button
                        className={`fa-ai-label-btn${roofReportGenerating ? '' : ''}`}
                        onClick={generateRoofReport}
                        disabled={roofReportGenerating}
                        style={{ marginTop: 10 }}
                      >
                        {roofReportGenerating
                          ? <><span className="fa-spinner" /> Generating Report…</>
                          : '✦ Generate Roof Report'}
                      </button>
                    </div>
                  </div>

                  {/* ── ROOF REPORT FIELDS ACCORDION ── */}
                  <div className="mc-rrf-accordion">
                    <div className="mc-rrf-head" onClick={() => setRoofFieldsOpen(p => !p)}>
                      <span className="mc-rrf-head-label">📋 Roof Report Fields</span>
                      <span className="mc-rrf-arrow">{roofFieldsOpen ? '▾' : '›'}</span>
                    </div>
                    {roofFieldsOpen && (
                      <div className="mc-rrf-body">

                        {/* ── Claim Details ── */}
                        <div className="mc-rrf-sub">Claim Details</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Customer Name, Loss Address, Insurer, Claim Number</label>
                          <input className="fa-input" type="text" placeholder="e.g. Mr & Mrs Smith · 123 Example St · IAG · Claim #123456" value={roofReportFields.claimDetails} onChange={e => setRoofField('claimDetails', e.target.value)} />
                        </div>

                        {/* ── Assessment Report Details ── */}
                        <div className="mc-rrf-sub">Assessment Report Details</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Attendance Date</label>
                          <input className="fa-input" type="text" placeholder="DD.MM.YYYY" value={roofReportFields.attendanceDate} onChange={e => setRoofField('attendanceDate', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Time Attended</label>
                          <input className="fa-input" type="text" placeholder="e.g. 11:00 AWST" value={roofReportFields.timeAttended} onChange={e => setRoofField('timeAttended', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Roofer Met With</label>
                          <input className="fa-input" type="text" placeholder="e.g. Mrs De Silva" value={roofReportFields.rooferMetWith} onChange={e => setRoofField('rooferMetWith', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Time on Site</label>
                          <input className="fa-input" type="text" placeholder="e.g. 30 mins" value={roofReportFields.timeOnSite} onChange={e => setRoofField('timeOnSite', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Scope of Assessment</label>
                          <textarea className="fa-ta" style={{ minHeight: 70 }} placeholder="e.g. Carry out a roof inspection and provide a roof report relating to the claim." value={roofReportFields.scopeOfAssessment} onChange={e => setRoofField('scopeOfAssessment', e.target.value)} />
                        </div>

                        {/* ── Property Details ── */}
                        <div className="mc-rrf-sub">Property Details</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Approximate Age of Property</label>
                          <input className="fa-input" type="text" placeholder="e.g. 50+ Years" value={roofReportFields.propertyAge} onChange={e => setRoofField('propertyAge', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Wall Construction Type</label>
                          <input className="fa-input" type="text" placeholder="e.g. Double brick, Brick veneer" value={roofReportFields.wallConstruction} onChange={e => setRoofField('wallConstruction', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Property Type</label>
                          <input className="fa-input" type="text" placeholder="e.g. Residential, Commercial" value={roofReportFields.propertyType} onChange={e => setRoofField('propertyType', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Property Condition</label>
                          <div className="fa-rg inline">
                            {(['Good', 'Fair', 'Poor'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.propertyCondition === o ? ' sel' : ''}`} onClick={() => setRoofField('propertyCondition', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Number of Storeys</label>
                          <input className="fa-input" type="text" placeholder="e.g. 1" value={roofReportFields.numberOfStoreys} onChange={e => setRoofField('numberOfStoreys', e.target.value)} />
                        </div>

                        {/* ── Roof Details ── */}
                        <div className="mc-rrf-sub">Roof Details</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Roof Type</label>
                          <input className="fa-input" type="text" placeholder="e.g. Terracotta Tile, Colorbond" value={roofReportFields.roofType} onChange={e => setRoofField('roofType', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">General Condition of Roof</label>
                          <div className="fa-rg inline">
                            {(['Good', 'Fair', 'Poor'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.roofGeneralCondition === o ? ' sel' : ''}`} onClick={() => setRoofField('roofGeneralCondition', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Roof Pitch (degrees)</label>
                          <input className="fa-input" type="text" placeholder="e.g. 18" value={roofReportFields.roofPitch} onChange={e => setRoofField('roofPitch', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Number of Penetrations</label>
                          <input className="fa-input" type="text" placeholder="e.g. 6" value={roofReportFields.numberOfPenetrations} onChange={e => setRoofField('numberOfPenetrations', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Roof Insulation Type</label>
                          <input className="fa-input" type="text" placeholder="e.g. None, Sarking, Anticon, Air-cell" value={roofReportFields.roofInsulationType} onChange={e => setRoofField('roofInsulationType', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Solar PV</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.solarPV === o ? ' sel' : ''}`} onClick={() => setRoofField('solarPV', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Roof Mounted Solar HWS</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.roofMountedSolarHWS === o ? ' sel' : ''}`} onClick={() => setRoofField('roofMountedSolarHWS', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Number of Skylights</label>
                          <input className="fa-input" type="text" placeholder="e.g. 2" value={roofReportFields.numberOfSkylights} onChange={e => setRoofField('numberOfSkylights', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Skylight Flashings — Watertight &amp; Flashed Correctly?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.skylightFlashingsWatertight === o ? ' sel' : ''}`} onClick={() => setRoofField('skylightFlashingsWatertight', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Skylight Flashing Notes</label>
                          <textarea className="fa-ta" style={{ minHeight: 60 }} placeholder="e.g. Leak through 1 x skylight dome" value={roofReportFields.skylightFlashingsNotes} onChange={e => setRoofField('skylightFlashingsNotes', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Gutters Compliant with Current Building Codes?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.guttersCompliant === o ? ' sel' : ''}`} onClick={() => setRoofField('guttersCompliant', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Gutter Notes</label>
                          <textarea className="fa-ta" style={{ minHeight: 60 }} placeholder="e.g. No overflow provisions" value={roofReportFields.guttersNotes} onChange={e => setRoofField('guttersNotes', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Number of Downpipes Compliant?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.downpipesCompliant === o ? ' sel' : ''}`} onClick={() => setRoofField('downpipesCompliant', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Corrosion Due to Ironized Water?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.corrosionIronizedWater === o ? ' sel' : ''}`} onClick={() => setRoofField('corrosionIronizedWater', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Downpipe Size</label>
                          <input className="fa-input" type="text" placeholder="e.g. 95x45mm / 75mm round" value={roofReportFields.downpipeSize} onChange={e => setRoofField('downpipeSize', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Roof Structure Tied Down / Compliant?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No', 'N/A'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.roofStructureTiedDown === o ? ' sel' : ''}`} onClick={() => setRoofField('roofStructureTiedDown', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Batten Size &amp; Spacing Compliant?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No', 'N/A'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.battenSizeCompliant === o ? ' sel' : ''}`} onClick={() => setRoofField('battenSizeCompliant', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Truss/Rafter Size &amp; Spacing Compliant?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No', 'N/A'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.trussRafterCompliant === o ? ' sel' : ''}`} onClick={() => setRoofField('trussRafterCompliant', o)}>{o}</button>
                            ))}
                          </div>
                        </div>

                        {/* ── Cause of Damage ── */}
                        <div className="mc-rrf-sub">Cause of Damage</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Claim Type</label>
                          <input className="fa-input" type="text" placeholder="e.g. Storm, Accidental damage, Flood" value={roofReportFields.claimType} onChange={e => setRoofField('claimType', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Specific Cause</label>
                          <textarea className="fa-ta" style={{ minHeight: 100 }} placeholder="Describe the specific cause and water entry points…" value={roofReportFields.specificCause} onChange={e => setRoofField('specificCause', e.target.value)} />
                        </div>

                        {/* ── Client Discussion ── */}
                        <div className="mc-rrf-sub">Client Discussion</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Client Stated</label>
                          <textarea className="fa-ta" style={{ minHeight: 70 }} placeholder="What did the insured/client state about the loss…" value={roofReportFields.clientDiscussion} onChange={e => setRoofField('clientDiscussion', e.target.value)} />
                        </div>

                        {/* ── Roof Conditions ── */}
                        <div className="mc-rrf-sub">Roof Conditions</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Property Conditions Contributed to Claim Damage?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.propertyConditionsContributed === o ? ' sel' : ''}`} onClick={() => setRoofField('propertyConditionsContributed', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Contributing Conditions Details</label>
                          <textarea className="fa-ta" style={{ minHeight: 80 }} placeholder="List contributing property conditions…" value={roofReportFields.propertyConditionsDetails} onChange={e => setRoofField('propertyConditionsDetails', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">If in Good Condition Prior, Would Damage Still Have Occurred?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.damageWithoutConditions === o ? ' sel' : ''}`} onClick={() => setRoofField('damageWithoutConditions', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Would Customer Have Been Reasonably Aware of Property Conditions?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.customerAwareOfConditions === o ? ' sel' : ''}`} onClick={() => setRoofField('customerAwareOfConditions', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Any Other Issues Relating to Property Conditions?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.otherPropertyConditionIssues === o ? ' sel' : ''}`} onClick={() => setRoofField('otherPropertyConditionIssues', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        {roofReportFields.otherPropertyConditionIssues === 'Yes' && (
                          <div className="fa-fg">
                            <label className="fa-fl">Other Condition Issue Details</label>
                            <textarea className="fa-ta" style={{ minHeight: 70 }} value={roofReportFields.otherPropertyConditionDetails} onChange={e => setRoofField('otherPropertyConditionDetails', e.target.value)} />
                          </div>
                        )}
                        <div className="fa-fg">
                          <label className="fa-fl">Maintenance Repairs Required?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.maintenanceRepairsRequired === o ? ' sel' : ''}`} onClick={() => setRoofField('maintenanceRepairsRequired', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Required / Urgent Maintenance</label>
                          <textarea className="fa-ta" style={{ minHeight: 80 }} placeholder="List urgent maintenance items…" value={roofReportFields.requiredMaintenanceDetails} onChange={e => setRoofField('requiredMaintenanceDetails', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Recommended / Other Maintenance</label>
                          <textarea className="fa-ta" style={{ minHeight: 70 }} placeholder="List recommended maintenance items…" value={roofReportFields.recommendedMaintenanceDetails} onChange={e => setRoofField('recommendedMaintenanceDetails', e.target.value)} />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Conditions / Maintenance Items Prevent Warrantable Claim Repairs?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.conditionsPreventRepairs === o ? ' sel' : ''}`} onClick={() => setRoofField('conditionsPreventRepairs', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        {roofReportFields.conditionsPreventRepairs === 'Yes' && (
                          <div className="fa-fg">
                            <label className="fa-fl">Details</label>
                            <textarea className="fa-ta" style={{ minHeight: 60 }} value={roofReportFields.conditionsPreventRepairsDetails} onChange={e => setRoofField('conditionsPreventRepairsDetails', e.target.value)} />
                          </div>
                        )}
                        <div className="fa-fg">
                          <label className="fa-fl">Previous Repairs Revealed?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.previousRepairs === o ? ' sel' : ''}`} onClick={() => setRoofField('previousRepairs', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        {roofReportFields.previousRepairs === 'Yes' && (
                          <div className="fa-fg">
                            <label className="fa-fl">Previous Repair Details</label>
                            <textarea className="fa-ta" style={{ minHeight: 60 }} value={roofReportFields.previousRepairsDetails} onChange={e => setRoofField('previousRepairsDetails', e.target.value)} />
                          </div>
                        )}
                        <div className="fa-fg">
                          <label className="fa-fl">Building Code Violations Revealed?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.buildingCodeViolations === o ? ' sel' : ''}`} onClick={() => setRoofField('buildingCodeViolations', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        {roofReportFields.buildingCodeViolations === 'Yes' && (
                          <div className="fa-fg">
                            <label className="fa-fl">Violation Details</label>
                            <textarea className="fa-ta" style={{ minHeight: 60 }} value={roofReportFields.buildingCodeViolationsDetails} onChange={e => setRoofField('buildingCodeViolationsDetails', e.target.value)} />
                          </div>
                        )}

                        {/* ── Access and Safety ── */}
                        <div className="mc-rrf-sub">Access and Safety</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Access Concerns Preventing Repairs?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.accessConcerns === o ? ' sel' : ''}`} onClick={() => setRoofField('accessConcerns', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Health &amp; Safety Concerns Preventing Repairs?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.healthSafetyConcerns === o ? ' sel' : ''}`} onClick={() => setRoofField('healthSafetyConcerns', o)}>{o}</button>
                            ))}
                          </div>
                        </div>

                        {/* ── Additional Information ── */}
                        <div className="mc-rrf-sub">Additional Information</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Has a Make Safe Been Completed?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.makeSafeCompleted === o ? ' sel' : ''}`} onClick={() => setRoofField('makeSafeCompleted', o)}>{o}</button>
                            ))}
                          </div>
                        </div>
                        {roofReportFields.makeSafeCompleted === 'Yes' && (
                          <div className="fa-fg">
                            <label className="fa-fl">Make Safe Works Completed</label>
                            <textarea className="fa-ta" style={{ minHeight: 80 }} placeholder="List make safe works carried out on site…" value={roofReportFields.makeSafeCompletedDetails} onChange={e => setRoofField('makeSafeCompletedDetails', e.target.value)} />
                          </div>
                        )}
                        <div className="fa-fg" style={{ paddingBottom: 16 }}>
                          <label className="fa-fl">Is a Make Safe Required?</label>
                          <div className="fa-rg inline">
                            {(['Yes', 'No'] as const).map(o => (
                              <button key={o} className={`fa-ro${roofReportFields.makeSafeRequired === o ? ' sel' : ''}`} onClick={() => setRoofField('makeSafeRequired', o)}>{o}</button>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}
                  </div>

                  {/* Photo Context */}
                  <div className="fa-ai-dark" style={{ marginTop: 2 }}>
                    <div className="fa-ai-dark-head">
                      <span style={{ fontSize: 14 }}>📷</span>
                      <span className="fa-ai-dark-title">Roof Photo Context</span>
                    </div>
                    <div className="fa-ai-dark-body">
                      <textarea
                        className="fa-ai-dark-ta"
                        placeholder="Describe your roof photos in order…"
                        style={{ minHeight: 80 }}
                        value={roofPhotoContext}
                        onChange={e => { setRoofPhotoContext(e.target.value); armDraft() }}
                      />
                      <button
                        className={`fa-ai-label-btn${roofAiLabelDone ? ' done' : ''}`}
                        onClick={runRoofAILabels}
                        disabled={roofAiLabeling || roofPhotos.some(p => p.processing || p.uploading)}
                      >
                        {roofPhotos.some(p => p.processing || p.uploading)
                          ? <><span className="fa-spinner" /> {roofPhotos.some(p => p.processing) ? 'Converting photos…' : 'Saving photos…'}</>
                          : roofAiLabeling
                          ? <><span className="fa-spinner" /> Labelling…</>
                          : roofAiLabelDone
                          ? '✓ Labels Applied'
                          : '✦ AI Label All Photos'}
                      </button>
                    </div>
                  </div>

                  {/* Roof Photos */}
                  <div className="fa-photo-grid">
                    {roofPhotos.map(photo => (
                      <div key={photo.id} className="fa-photo-card">
                        <img className="fa-photo-thumb" src={photo.previewUrl} alt="roof inspection" />
                        {(photo.processing || photo.uploading) && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(44,26,14,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <span className="fa-spinner" style={{ borderColor: 'var(--beige)', borderTopColor: 'transparent', width: 22, height: 22 }} />
                            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 9, color: 'var(--beige)', letterSpacing: 1 }}>{photo.processing ? 'Converting…' : 'Saving…'}</span>
                          </div>
                        )}
                        {!photo.processing && !photo.uploading && <button className="fa-photo-del" onClick={() => removeRoofPhoto(photo.id)}>×</button>}
                        <div className="fa-photo-label-area">
                          <textarea
                            className="fa-photo-label-ta"
                            rows={1}
                            placeholder={photo.processing ? 'Processing…' : photo.uploading ? 'Saving…' : 'Add label'}
                            value={photo.label}
                            disabled={photo.processing || photo.uploading}
                            onChange={e => {
                              const newLabel = e.target.value
                              setRoofPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, label: newLabel } : p))
                              if (photo.photoId) {
                                fetch(`${base}/photos`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoId: photo.photoId, label: newLabel }) }).catch(() => {})
                              }
                              armDraft()
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => roofPhotoInputRef.current?.click()} className="fa-upload-slot">
                      <span style={{ fontSize: 24 }}>📷</span>
                      <span>Add Photo</span>
                    </button>
                    <input
                      ref={roofPhotoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => handleRoofPhotos(e.target.files)}
                    />
                  </div>

                  {/* Export */}
                  <div className="mc-export-wrap">
                    <button
                      className="mc-export-btn"
                      onClick={handleExportRoof}
                      disabled={roofExporting}
                    >
                      {roofExporting ? <><span className="fa-spinner" /> Exporting…</> : 'Export Report'}
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <div style={{ height: 24 }} />
    </div>

    {roofPreviewOpen && (
      <RoofReportPreview
        fields={roofReportFields}
        photos={roofPhotos}
        jobInfo={{
          address: initialData.address,
          insuredName: initialData.insuredName,
          insurer: initialData.insurer,
          claimNumber: initialData.claimNumber,
          jobNumber: initialData.jobNumber,
        }}
        onClose={() => setRoofPreviewOpen(false)}
      />
    )}
    </>
  )
}
