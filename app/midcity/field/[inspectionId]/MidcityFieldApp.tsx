'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RoofReportPreview } from './RoofReportPreview'
import { MakeSafeReportPreview } from './MakeSafeReportPreview'
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

interface MakeSafeData {
  claimDetails: string
  conductedOn: string
  description: string
}

function emptyMakeSafe(): MakeSafeData {
  return { claimDetails: '', conductedOn: '', description: '• ' }
}

interface ScopeItem { id: string; text: string }
interface ScopeRoom { id: string; name: string; l: string; w: string; h: string; items: ScopeItem[] }
interface PhotoEntry { id: string; photoId: string | null; file: File | null; previewUrl: string; label: string; processing: boolean; uploading: boolean; cropX: number; cropY: number; cropScale: number }

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

// — Pan/zoom photo card used in both roof and make safe photo grids ——————————
function MidcityPhotoCard({
  photo,
  base,
  onDelete,
  onLabelChange,
  onCropChange,
}: {
  photo: PhotoEntry
  base: string
  onDelete: () => void
  onLabelChange: (label: string) => void
  onCropChange: (x: number, y: number, scale: number) => void
}) {
  const [cropX, setCropX] = React.useState(photo.cropX)
  const [cropY, setCropY] = React.useState(photo.cropY)
  const [cropScale, setCropScale] = React.useState(photo.cropScale)
  const cropRef = React.useRef({ x: photo.cropX, y: photo.cropY, scale: photo.cropScale })
  const frameRef = React.useRef<HTMLDivElement>(null)
  const isPanning = React.useRef(false)
  const lastPointer = React.useRef({ x: 0, y: 0 })
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const updateCrop = React.useCallback((x: number, y: number, scale: number) => {
    cropRef.current = { x, y, scale }
    setCropX(x); setCropY(y); setCropScale(scale)
    onCropChange(x, y, scale)
    if (photo.photoId) {
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        fetch(`${base}/photos`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoId: photo.photoId, crop_x: x, crop_y: y, crop_scale: scale }),
        }).catch(() => {})
      }, 400)
    }
  }, [photo.photoId, base, onCropChange])

  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    if (photo.processing || photo.uploading) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    const newScale = Math.max(0.5, Math.min(8, cropRef.current.scale + delta))
    updateCrop(cropRef.current.x, cropRef.current.y, newScale)
  }, [photo.processing, photo.uploading, updateCrop])

  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (photo.processing || photo.uploading) return
    e.preventDefault()
    isPanning.current = true
    lastPointer.current = { x: e.clientX, y: e.clientY }
    frameRef.current?.setPointerCapture(e.pointerId)
  }, [photo.processing, photo.uploading])

  const handlePointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!isPanning.current || !frameRef.current) return
    const rect = frameRef.current.getBoundingClientRect()
    const dx = (e.clientX - lastPointer.current.x) / rect.width * 100
    const dy = (e.clientY - lastPointer.current.y) / rect.height * 100
    lastPointer.current = { x: e.clientX, y: e.clientY }
    updateCrop(cropRef.current.x + dx, cropRef.current.y + dy, cropRef.current.scale)
  }, [updateCrop])

  const handlePointerUp = React.useCallback(() => { isPanning.current = false }, [])

  const isCropped = cropX !== 0 || cropY !== 0 || cropScale !== 1
  const busy = photo.processing || photo.uploading

  return (
    <div className="fa-photo-card">
      <div
        ref={frameRef}
        className="fa-photo-frame"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        style={{ cursor: busy ? 'default' : 'grab', touchAction: 'none' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="fa-photo-thumb"
          src={photo.previewUrl}
          alt="photo"
          draggable={false}
          style={{ transform: `translate(${cropX}%, ${cropY}%) scale(${cropScale})` }}
        />
        {busy && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(44,26,14,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span className="fa-spinner" style={{ borderColor: 'var(--beige)', borderTopColor: 'transparent', width: 22, height: 22 }} />
            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 9, color: 'var(--beige)', letterSpacing: 1 }}>{photo.processing ? 'Converting…' : 'Saving…'}</span>
          </div>
        )}
        {!busy && (
          <button className="fa-photo-del" onClick={(e) => { e.stopPropagation(); onDelete() }}>×</button>
        )}
        {!busy && isCropped && (
          <button
            onClick={(e) => { e.stopPropagation(); updateCrop(0, 0, 1) }}
            style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.55)', color: 'white', border: 'none', borderRadius: 4, padding: '2px 7px', fontSize: 9, cursor: 'pointer', fontFamily: 'var(--font-dm-mono)', letterSpacing: 1 }}
          >
            Reset
          </button>
        )}
      </div>
      <div className="fa-photo-label-area">
        <textarea
          className="fa-photo-label-ta"
          rows={1}
          placeholder={photo.processing ? 'Processing…' : photo.uploading ? 'Saving…' : 'Add label'}
          value={photo.label}
          disabled={busy}
          onChange={e => onLabelChange(e.target.value)}
        />
      </div>
    </div>
  )
}

async function processPhotoForUpload(file: File): Promise<File> {
  const TARGET_BYTES = 62 * 1024
  const MAX_DIM = 1200

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
          if (blob.size > TARGET_BYTES && quality > 0.40) { compress(Math.round((quality - 0.08) * 100) / 100); return }
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

  // ─── Section 1: Notes + scope ─────────────────────────────────────────────
  const [dictationNotes, setDictationNotes] = useState('')

  // ─── Report enable states ─────────────────────────────────────────────────
  const [barEnabled, setBarEnabled] = useState(false)
  const [makeSafeEnabled, setMakeSafeEnabled] = useState(false)
  const [roofEnabled, setRoofEnabled] = useState(false)

  // ─── Scope notes ──────────────────────────────────────────────────────────
  const [scopeRooms, setScopeRooms] = useState<ScopeRoom[]>([])

  // ─── BAR fields ───────────────────────────────────────────────────────────
  const [insuranceTemplate, setInsuranceTemplate] = useState<InsuranceTemplate | ''>('')
  const [insuranceFields, setInsuranceFields] = useState<Record<string, string>>({})
  const [insuranceFieldsOpen, setInsuranceFieldsOpen] = useState(false)
  const [autofillScript, setAutofillScript] = useState('')
  const [autofillScriptOpen, setAutofillScriptOpen] = useState(false)
  const [barDamageTemplate, setBarDamageTemplate] = useState<string | null>(null)

  // ─── Make Safe fields ─────────────────────────────────────────────────────
  const [makeSafeFields, setMakeSafeFields] = useState<MakeSafeData>(emptyMakeSafe)
  const [makeSafeFieldsOpen, setMakeSafeFieldsOpen] = useState(true)
  const [makeSafePhotos, setMakeSafePhotos] = useState<PhotoEntry[]>([])
  const [makeSafePreviewOpen, setMakeSafePreviewOpen] = useState(false)
  const makeSafePhotoInputRef = useRef<HTMLInputElement>(null)
  const makeSafePhotoIdsRef = useRef<Set<string>>(new Set())

  // ─── Roof Report fields ───────────────────────────────────────────────────
  const [roofPhotos, setRoofPhotos] = useState<PhotoEntry[]>([])
  const roofPhotoInputRef = useRef<HTMLInputElement>(null)

  // ─── Roof Report structured fields ───────────────────────────────────────
  const [roofReportFields, setRoofReportFields] = useState<RoofReportData>(emptyRoofReport)
  const [roofFieldsOpen, setRoofFieldsOpen] = useState(false)
  const [roofReportGenerating, setRoofReportGenerating] = useState(false)

  // ─── Save / export state ─────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState('')
  const [barExporting, setBarExporting] = useState(false)
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
    dictationNotes,
    barEnabled, makeSafeEnabled, roofEnabled,
    scopeRooms: scopeRooms.map(r => ({ ...r, items: r.items.map(i => i.text) })),
    insuranceTemplate, insuranceFields, insuranceFieldsOpen, autofillScript, autofillScriptOpen,
    damage_template: barDamageTemplate,
    roofReportFields, roofFieldsOpen,
    makeSafeFields, makeSafeFieldsOpen,
    makeSafePhotoIds: makeSafePhotos.map(p => p.photoId).filter(Boolean),
  }), [dictationNotes, barEnabled, makeSafeEnabled, roofEnabled, scopeRooms, insuranceTemplate, insuranceFields, insuranceFieldsOpen, autofillScript, autofillScriptOpen, barDamageTemplate, roofReportFields, roofFieldsOpen, makeSafeFields, makeSafeFieldsOpen, makeSafePhotos])

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
    if (d.dictationNotes) setDictationNotes(d.dictationNotes as string)
    if (d.barEnabled) setBarEnabled(d.barEnabled as boolean)
    if (d.makeSafeEnabled) setMakeSafeEnabled(d.makeSafeEnabled as boolean)
    if (d.roofEnabled) setRoofEnabled(d.roofEnabled as boolean)
    if (d.insuranceTemplate) setInsuranceTemplate(d.insuranceTemplate as InsuranceTemplate)
    if (d.insuranceFields) setInsuranceFields(d.insuranceFields as Record<string, string>)
    if (d.insuranceFieldsOpen) setInsuranceFieldsOpen(d.insuranceFieldsOpen as boolean)
    if (d.autofillScript) setAutofillScript(d.autofillScript as string)
    if (d.autofillScriptOpen) setAutofillScriptOpen(d.autofillScriptOpen as boolean)
    if (d.damage_template) setBarDamageTemplate(d.damage_template as string)
    if (d.roofReportFields) setRoofReportFields(prev => ({ ...prev, ...(d.roofReportFields as RoofReportData) }))
    if (d.roofFieldsOpen) setRoofFieldsOpen(d.roofFieldsOpen as boolean)
    if (d.makeSafeFields) setMakeSafeFields(prev => ({ ...prev, ...(d.makeSafeFields as MakeSafeData) }))
    if (d.makeSafeFieldsOpen !== undefined) setMakeSafeFieldsOpen(d.makeSafeFieldsOpen as boolean)
    if (d.makeSafePhotoIds) makeSafePhotoIdsRef.current = new Set(d.makeSafePhotoIds as string[])
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
      .then((data: { photos?: { id: string; url: string | null; label: string; crop_x: number; crop_y: number; crop_scale: number }[] }) => {
        if (data.photos?.length) {
          const roofP: PhotoEntry[] = []
          const makeSafeP: PhotoEntry[] = []
          for (const p of data.photos) {
            const entry: PhotoEntry = { id: uid(), photoId: p.id, file: null, previewUrl: p.url ?? '', label: p.label, processing: false, uploading: false, cropX: p.crop_x ?? 0, cropY: p.crop_y ?? 0, cropScale: p.crop_scale ?? 1 }
            if (makeSafePhotoIdsRef.current.has(p.id)) {
              makeSafeP.push(entry)
            } else {
              roofP.push(entry)
            }
          }
          if (roofP.length) setRoofPhotos(roofP)
          if (makeSafeP.length) setMakeSafePhotos(makeSafeP)
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
    Array.from(files).forEach(file => {
      const id = uid()
      const rawPreview = URL.createObjectURL(file)
      setRoofPhotos(prev => [...prev, { id, photoId: null, file, previewUrl: rawPreview, label: '', processing: true, uploading: false, cropX: 0, cropY: 0, cropScale: 1 }])
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

  // ─── Roof report field helper ─────────────────────────────────────────────
  const setRoofField = (key: keyof RoofReportData, value: string) => {
    setRoofReportFields(prev => ({ ...prev, [key]: value }))
    if (key === 'claimDetails') setMakeSafeFields(prev => ({ ...prev, claimDetails: value }))
    armDraft()
  }

  // ─── Make Safe field helper ───────────────────────────────────────────────
  const setMakeSafeField = (key: keyof MakeSafeData, value: string) => {
    setMakeSafeFields(prev => ({ ...prev, [key]: value }))
    if (key === 'claimDetails') setRoofReportFields(prev => ({ ...prev, claimDetails: value }))
    armDraft()
  }

  // ─── Make Safe photo helpers ──────────────────────────────────────────────
  const handleMakeSafePhotos = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(file => {
      const id = uid()
      const rawPreview = URL.createObjectURL(file)
      setMakeSafePhotos(prev => [...prev, { id, photoId: null, file, previewUrl: rawPreview, label: '', processing: true, uploading: false, cropX: 0, cropY: 0, cropScale: 1 }])
      processPhotoForUpload(file).then(async processed => {
        const processedPreview = URL.createObjectURL(processed)
        setMakeSafePhotos(prev => prev.map(p => {
          if (p.id !== id) return p
          URL.revokeObjectURL(p.previewUrl)
          return { ...p, file: processed, previewUrl: processedPreview, processing: false, uploading: true }
        }))
        try {
          const fd = new FormData()
          fd.append('file', processed)
          const res = await fetch(`${base}/photos`, { method: 'POST', body: fd })
          const data = await res.json()
          if (data.id) {
            makeSafePhotoIdsRef.current.add(data.id)
            setMakeSafePhotos(prev => prev.map(p => p.id !== id ? p : { ...p, photoId: data.id, previewUrl: data.url ?? p.previewUrl, file: null, uploading: false }))
            armDraft()
          } else {
            setMakeSafePhotos(prev => prev.map(p => p.id === id ? { ...p, uploading: false } : p))
          }
        } catch {
          setMakeSafePhotos(prev => prev.map(p => p.id === id ? { ...p, uploading: false } : p))
        }
      })
    })
  }

  const removeMakeSafePhoto = (id: string) => {
    setMakeSafePhotos(prev => {
      const p = prev.find(x => x.id === id)
      if (p) {
        URL.revokeObjectURL(p.previewUrl)
        if (p.photoId) {
          makeSafePhotoIdsRef.current.delete(p.photoId)
          fetch(`${base}/photos?photoId=${p.photoId}`, { method: 'DELETE' }).catch(() => {})
        }
      }
      return prev.filter(x => x.id !== id)
    })
    armDraft()
  }

  // ─── Make Safe toggle (records conducted-on timestamp on first enable) ────
  const handleMakeSafeToggle = () => {
    const isEnabling = !makeSafeEnabled
    setMakeSafeEnabled(isEnabling)
    if (isEnabling && !makeSafeFields.conductedOn) {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const tzAbbr = Intl.DateTimeFormat('en-AU', { timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value ?? ''
      const dateStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}${tzAbbr ? ' ' + tzAbbr : ''}`
      setMakeSafeFields(prev => ({ ...prev, conductedOn: `${dateStr} ${timeStr}` }))
    }
    armDraft()
  }

  // ─── Generate Roof Report from raw notes ──────────────────────────────────
  const generateRoofReport = async () => {
    if (!dictationNotes.trim()) { alert('Add job notes in Section 1 first.'); return }
    setRoofReportGenerating(true)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const tzAbbr = Intl.DateTimeFormat('en-AU', { timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value ?? ''
    const attendanceDateFormatted = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
    const timeAttendedFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}${tzAbbr ? ' ' + tzAbbr : ''}`
    try {
      const res = await fetch('/api/midcity/generate-roof-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawNotes: dictationNotes,
          inspectorName: initialData.inspector,
          address: initialData.address,
          insuredName: initialData.insuredName,
          claimNumber: initialData.claimNumber,
          insurer: initialData.insurer,
          scheduledDate: initialData.scheduledDate,
          lossType: initialData.lossType,
          attendanceDateFormatted,
          timeAttendedFormatted,
        }),
      })
      const data = await res.json()
      if (data.ok && data.reportData) {
        const rd = data.reportData as Record<string, string>
        setRoofReportFields(prev => ({
          ...prev,
          ...rd,
          attendanceDate: attendanceDateFormatted,
          timeAttended: timeAttendedFormatted,
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
      alert('Please select an insurer / template before generating.')
      return
    }
    setBarExporting(true)
    try {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const reportDateFormatted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const siteAttendanceDatetimeFormatted = `${reportDateFormatted}T${pad(now.getHours())}:${pad(now.getMinutes())}`

      const scopeRoomsSummary = scopeRooms
        .filter(r => r.name || r.items.some(i => i.text))
        .map(r => `${r.name}: ${r.items.map(i => i.text).filter(Boolean).join(', ')}`)
        .join('\n')

      const res = await fetch('/api/midcity/generate-insurance-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawNotes: dictationNotes,
          template: insuranceTemplate,
          claimNumber: initialData.claimNumber,
          insuredName: initialData.insuredName,
          address: initialData.address,
          insurer: initialData.insurer,
          dateOfLoss: initialData.dateOfLoss,
          inspector: initialData.inspector,
          scheduledDate: initialData.scheduledDate,
          lossType: initialData.lossType,
          scopeRoomsSummary,
          reportDateFormatted,
          siteAttendanceDatetimeFormatted,
        }),
      })
      const data = await res.json()
      if (data.ok && (data.fields || data.javascript)) {
        if (data.fields) {
          setInsuranceFields(data.fields)
          setInsuranceFieldsOpen(true)
        }
        if (data.javascript) {
          setAutofillScript(data.javascript)
          setAutofillScriptOpen(true)
        }
        armDraft()
      } else {
        alert('Failed to generate template. Please try again.')
      }
    } catch {
      alert('Error generating template. Check your connection.')
    }
    setBarExporting(false)
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

      {/* ── 01 NOTES & SCOPE ──────────────────────────────────────────────── */}
      <div className="fa-sc" id="sec-details">
        <div className="fa-sc-head">
          <div className="fa-sc-circle active">01</div>
          <div className="fa-sc-meta">
            <h3>Notes &amp; Scope</h3>
            <p>Job notes · scope of works</p>
          </div>
          <span className="fa-badge req">Required</span>
        </div>
        <div className="fa-sc-body">
          <div style={{ padding: '16px 0' }}>

            {/* Job Notes dictation dump box */}
            <div className="fa-ai-dark">
              <div className="fa-ai-dark-head">
                <span style={{ fontSize: 14 }}>✦</span>
                <span className="fa-ai-dark-title">Job Notes</span>
              </div>
              <div className="fa-ai-hints">
                {['Who you met', 'Property description', 'BAR findings', 'Cause of damage', 'Areas damaged', 'Roof inspection', 'Make safe works', 'Pre-existing conditions', 'Maintenance items'].map(hint => (
                  <div key={hint} className="fa-ai-hint">{hint}</div>
                ))}
              </div>
              <div className="fa-ai-dark-body">
                <textarea
                  className="fa-ai-dark-ta"
                  placeholder="Dictate all job notes here — who you met, property description, BAR findings, roof inspection details, make safe works, damage cause, pre-existing conditions, maintenance items, etc. Each report in Section 2 pulls from these notes…"
                  style={{ minHeight: 160 }}
                  value={dictationNotes}
                  onChange={e => { setDictationNotes(e.target.value); armDraft() }}
                />
              </div>
            </div>

            {/* Scope Notes */}
            <div className="mc-section-head" style={{ marginTop: 16 }}>Scope Notes</div>
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

                  {/* Damage Scenario Template */}
                  <div style={{ padding: '16px 16px 0' }}>
                    <TemplateSelectorField
                      reportType="BAR"
                      value={barDamageTemplate}
                      onChange={name => { setBarDamageTemplate(name); armDraft() }}
                      onTemplateSaved={name => { setBarDamageTemplate(name); armDraft() }}
                    />
                  </div>

                  {/* Insurer / Template */}
                  <div className="fa-fg" style={{ paddingTop: 8 }}>
                    <label className="fa-fl">Insurer / Template</label>
                    <select
                      className="fa-input"
                      style={{ appearance: 'auto' as never }}
                      value={insuranceTemplate}
                      onChange={e => { setInsuranceTemplate(e.target.value as InsuranceTemplate | ''); armDraft() }}
                    >
                      <option value="">Select insurer / template…</option>
                      <option value="aai">AAI Limited</option>
                      <option value="auto_general">Auto &amp; General</option>
                      <option value="iag">IAG</option>
                    </select>
                  </div>

                  {/* Generate */}
                  <div className="mc-export-wrap">
                    <button
                      className="mc-export-btn"
                      onClick={handleExportBAR}
                      disabled={barExporting}
                    >
                      {barExporting ? <><span className="fa-spinner" /> Generating…</> : 'Generate Report'}
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

                  {/* MySysWorks Autofill Script (AAI only) */}
                  {autofillScript && (
                    <div>
                      <div
                        className="mc-rrf-head"
                        onClick={() => { setAutofillScriptOpen(p => !p); armDraft() }}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: 'var(--off)', borderTop: '1px solid var(--border)' }}
                      >
                        <span className="mc-rrf-head-label" style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text)', fontWeight: 500 }}>
                          MySysWorks Autofill Script
                        </span>
                        <span className="mc-rrf-arrow">{autofillScriptOpen ? '▾' : '›'}</span>
                      </div>
                      {autofillScriptOpen && (
                        <div style={{ background: 'white', padding: '12px 18px', paddingBottom: 16 }}>
                          <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                            <button
                              className="mc-export-btn"
                              style={{ background: 'var(--blue)', fontSize: 12 }}
                              onClick={() => {
                                navigator.clipboard.writeText(autofillScript)
                                  .catch(() => {
                                    const ta = document.createElement('textarea')
                                    ta.value = autofillScript
                                    document.body.appendChild(ta)
                                    ta.select()
                                    document.execCommand('copy')
                                    document.body.removeChild(ta)
                                  })
                              }}
                            >
                              Copy to Clipboard
                            </button>
                          </div>
                          <textarea
                            readOnly
                            value={autofillScript}
                            style={{ width: '100%', height: 320, fontFamily: 'var(--font-dm-mono)', fontSize: 11, resize: 'vertical', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px', background: '#f9f9f9', boxSizing: 'border-box' }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── MAKE SAFE ────────────────────────────────────────────────── */}
            <div className={`mc-pill${makeSafeEnabled ? ' enabled' : ''}`}>
              <div className="mc-pill-header" onClick={handleMakeSafeToggle}>
                <div className="mc-pill-check">{makeSafeEnabled ? '✓' : ''}</div>
                <div className="mc-pill-info">
                  <div className="mc-pill-name">Make Safe</div>
                  <div className="mc-pill-sub">Emergency works completed on site</div>
                </div>
                <div className="mc-pill-arrow">{makeSafeEnabled ? '▾' : '›'}</div>
              </div>

              {makeSafeEnabled && (
                <div className="mc-pill-body">
                  <div className="mc-section-head">Make Safe Report</div>

                  {/* Make Safe Fields Accordion */}
                  <div className="mc-rrf-accordion">
                    <div className="mc-rrf-head" onClick={() => setMakeSafeFieldsOpen(p => !p)}>
                      <span className="mc-rrf-head-label">📋 Make Safe Report Fields</span>
                      <span className="mc-rrf-arrow">{makeSafeFieldsOpen ? '▾' : '›'}</span>
                    </div>
                    {makeSafeFieldsOpen && (
                      <div className="mc-rrf-body">

                        {/* Claim Details */}
                        <div className="mc-rrf-sub">Claim Details</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Customer Name, Loss Address, Insurer, Claim Number</label>
                          <input
                            className="fa-input"
                            type="text"
                            placeholder="e.g. Mr & Mrs Smith · 123 Example St · IAG · Claim #123456"
                            value={makeSafeFields.claimDetails}
                            onChange={e => setMakeSafeField('claimDetails', e.target.value)}
                          />
                        </div>

                        {/* Make Safe Details */}
                        <div className="mc-rrf-sub">Make Safe Details</div>
                        <div className="fa-fg">
                          <label className="fa-fl">Contractor</label>
                          <input
                            className="fa-input"
                            type="text"
                            value="Bindi Co"
                            readOnly
                            style={{ background: '#f5f5f5', color: '#666' }}
                          />
                        </div>
                        <div className="fa-fg">
                          <label className="fa-fl">Conducted On</label>
                          <input
                            className="fa-input"
                            type="text"
                            placeholder="Date and time"
                            value={makeSafeFields.conductedOn}
                            onChange={e => setMakeSafeField('conductedOn', e.target.value)}
                          />
                        </div>

                        {/* Description */}
                        <div className="mc-rrf-sub">Make Safe Description</div>
                        <div className="fa-fg" style={{ paddingBottom: 16 }}>
                          <label className="fa-fl">Description of Works</label>
                          <textarea
                            className="fa-ta"
                            style={{ minHeight: 180 }}
                            value={makeSafeFields.description}
                            onChange={e => setMakeSafeField('description', e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                const ta = e.currentTarget
                                const pos = ta.selectionStart ?? makeSafeFields.description.length
                                const newVal = makeSafeFields.description.slice(0, pos) + '\n• ' + makeSafeFields.description.slice(pos)
                                setMakeSafeField('description', newVal)
                                setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + 3 }, 0)
                              }
                            }}
                          />
                        </div>

                      </div>
                    )}
                  </div>

                  {/* Make Safe Photos */}
                  <div className="fa-photo-grid">
                    {makeSafePhotos.map(photo => (
                      <MidcityPhotoCard
                        key={photo.id}
                        photo={photo}
                        base={base}
                        onDelete={() => removeMakeSafePhoto(photo.id)}
                        onLabelChange={(label) => {
                          setMakeSafePhotos(prev => prev.map(p => p.id === photo.id ? { ...p, label } : p))
                          if (photo.photoId) {
                            fetch(`${base}/photos`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoId: photo.photoId, label }) }).catch(() => {})
                          }
                          armDraft()
                        }}
                        onCropChange={(x, y, scale) => {
                          setMakeSafePhotos(prev => prev.map(p => p.id === photo.id ? { ...p, cropX: x, cropY: y, cropScale: scale } : p))
                        }}
                      />
                    ))}
                    <button type="button" onClick={() => makeSafePhotoInputRef.current?.click()} className="fa-upload-slot">
                      <span style={{ fontSize: 24 }}>📷</span>
                      <span>Add Photo</span>
                    </button>
                    <input
                      ref={makeSafePhotoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => handleMakeSafePhotos(e.target.files)}
                    />
                  </div>

                  {/* Export */}
                  <div className="mc-export-wrap">
                    <button className="mc-export-btn" onClick={() => setMakeSafePreviewOpen(true)}>
                      Export Report
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
                  <div style={{ padding: '12px 16px' }}>
                    <button
                      className="fa-ai-label-btn"
                      onClick={generateRoofReport}
                      disabled={roofReportGenerating}
                    >
                      {roofReportGenerating
                        ? <><span className="fa-spinner" /> Generating Report…</>
                        : '✦ Generate Roof Report'}
                    </button>
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0', fontFamily: 'var(--font-dm-mono)' }}>Uses notes from Section 1</p>
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

                  {/* Roof Photos */}
                  <div className="fa-photo-grid">
                    {roofPhotos.map(photo => (
                      <MidcityPhotoCard
                        key={photo.id}
                        photo={photo}
                        base={base}
                        onDelete={() => removeRoofPhoto(photo.id)}
                        onLabelChange={(label) => {
                          setRoofPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, label } : p))
                          if (photo.photoId) {
                            fetch(`${base}/photos`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoId: photo.photoId, label }) }).catch(() => {})
                          }
                          armDraft()
                        }}
                        onCropChange={(x, y, scale) => {
                          setRoofPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, cropX: x, cropY: y, cropScale: scale } : p))
                        }}
                      />
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

    {makeSafePreviewOpen && (
      <MakeSafeReportPreview
        fields={makeSafeFields}
        photos={makeSafePhotos}
        jobInfo={{
          address: initialData.address,
          insuredName: initialData.insuredName,
          insurer: initialData.insurer,
          claimNumber: initialData.claimNumber,
        }}
        onClose={() => setMakeSafePreviewOpen(false)}
      />
    )}
    </>
  )
}
