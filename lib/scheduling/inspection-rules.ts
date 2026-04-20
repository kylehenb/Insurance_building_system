// /lib/scheduling/inspection-rules.ts
//
// Pure rule evaluation functions for inspection scheduling.
// No side effects. No database calls. No API calls.
// All functions are independently testable.
//
// MIGRATION SQL: See /supabase/migrations/20260420_inspection_scheduling_rules.sql

import type {
  InspectionSchedulingRules,
  SchedulingCandidate,
  RuleEvaluationResult,
  ZoneDayMapping,
  PeakHourConfig,
} from './inspection-rules.types'

/**
 * Main entry point - evaluates a candidate job against all scheduling rules
 */
export function evaluateCandidate(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  targetDate: Date,
  existingRunJobs: SchedulingCandidate[]
): RuleEvaluationResult {
  // Check for make safe first - immediate dispatch
  if (isMakeSafe(candidate)) {
    return {
      job_id: candidate.job_id,
      eligible: true,
      disqualifiers: [],
      priority_score: 999,
      priority_flags: ['Make safe — immediate dispatch, all batching rules bypassed'],
      suggested_time_preference: 'any',
      estimated_duration_minutes: getJobDuration(candidate, rules),
      requires_senior_inspector: true,
      peak_hour_risk: false,
      overflow_eligible: true,
      notes: ['Make safe — immediate dispatch, all batching rules bypassed'],
    }
  }

  const disqualifiers: string[] = []
  const priority_flags: string[] = []
  const notes: string[] = []
  let priority_score = 50 // neutral starting score

  // Service area check
  const serviceAreaCheck = isInServiceArea(candidate, rules)
  if (!serviceAreaCheck.inArea) {
    disqualifiers.push(serviceAreaCheck.reason)
  }

  // Zone-day rule
  const zoneDayResult = evaluateZoneDayRule(candidate, rules, targetDate)
  if (!zoneDayResult.allowed) {
    disqualifiers.push(`Zone-day rule: ${zoneDayResult.zone} not scheduled on ${targetDate.toLocaleDateString('en-AU', { weekday: 'long' })}`)
  }

  // Cluster rule
  const clusterResult = evaluateClusterRule(candidate, rules, existingRunJobs)
  if (!clusterResult.inCluster && existingRunJobs.length === 0 && rules.min_cluster_size > 1) {
    // Will be handled by scheduling mode and urgency rules
    notes.push('No existing cluster - may be held depending on mode and urgency')
  }

  // Urgency rules
  const urgencyResult = evaluateUrgencyRules(candidate, rules, new Date())
  priority_score += urgencyResult.priorityDelta
  priority_flags.push(...urgencyResult.flags)

  // If urgent, bypass cluster and zone-day restrictions
  const isUrgent = urgencyResult.kpiOverride || urgencyResult.daysOverride || urgencyResult.insurerPriorityBoost
  if (isUrgent) {
    // Remove zone-day and cluster disqualifiers if urgent
    const zoneDayIndex = disqualifiers.findIndex(d => d.startsWith('Zone-day rule'))
    if (zoneDayIndex !== -1) {
      disqualifiers.splice(zoneDayIndex, 1)
      notes.push('Urgency override: zone-day rule bypassed')
    }
  }

  // Scheduling mode check
  const modeResult = evaluateSchedulingMode(candidate, rules, existingRunJobs, 0)
  if (modeResult.holdRequired) {
    // Only hold if not urgent
    if (!isUrgent) {
      disqualifiers.push(modeResult.reason)
    } else {
      notes.push(`Scheduling mode would hold, but urgency override applies: ${modeResult.reason}`)
    }
  }

  // Time of day evaluation
  const timeOfDayResult = evaluateTimeOfDay(candidate, rules)

  // Insured constraints
  const constraintsResult = evaluateInsuredConstraints(candidate, rules, targetDate, '09:00')
  if (constraintsResult.blocked) {
    disqualifiers.push(...constraintsResult.reasons)
  }
  notes.push(...constraintsResult.notes)

  // Determine eligibility
  const eligible = disqualifiers.length === 0

  // Peak hour risk (simplified - needs proposed time)
  const peakHourRisk = rules.peak_hour_config.enabled

  // Overflow eligibility
  const overflowResult = evaluateOverflowEligibility(candidate, rules, existingRunJobs, existingRunJobs.length)

  return {
    job_id: candidate.job_id,
    eligible,
    disqualifiers,
    priority_score,
    priority_flags,
    suggested_time_preference: timeOfDayResult.preferredTimeOfDay,
    estimated_duration_minutes: timeOfDayResult.estimatedDurationMinutes,
    requires_senior_inspector: candidate.wo_type === 'BAR_make_safe' || candidate.wo_type === 'roof_report' || candidate.wo_type === 'specialist',
    peak_hour_risk: peakHourRisk,
    overflow_eligible: overflowResult.overflowEligible,
    notes,
  }
}

/**
 * Check if candidate is a make safe job
 */
export function isMakeSafe(candidate: SchedulingCandidate): boolean {
  return candidate.is_make_safe === true
}

/**
 * Check if candidate is in the configured service area
 */
export function isInServiceArea(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules
): { inArea: boolean; reason: string } {
  if (rules.service_area_postcodes.length === 0) {
    return { inArea: true, reason: '' }
  }

  const inArea = rules.service_area_postcodes.includes(candidate.postcode)
  return {
    inArea,
    reason: inArea ? '' : `Postcode ${candidate.postcode} outside service area`,
  }
}

/**
 * Evaluate zone-day rule - check if target date is a preferred day for the candidate's zone
 */
export function evaluateZoneDayRule(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  targetDate: Date
): { allowed: boolean; zone: string | null; preferredDays: string[] } {
  // CAT event bypasses all zone-day rules
  if (rules.cat_event_active) {
    return { allowed: true, zone: null, preferredDays: [] }
  }

  // Find zone for this postcode
  const zoneEntry = rules.postcode_zone_map.find(z => z.postcode === candidate.postcode)
  if (!zoneEntry) {
    // No zone mapping - no restriction
    return { allowed: true, zone: null, preferredDays: [] }
  }

  const zoneConfig = rules.zone_day_map.find(z => z.zone_name === zoneEntry.zone_name)
  if (!zoneConfig) {
    // Zone not configured - no restriction
    return { allowed: true, zone: zoneEntry.zone_name, preferredDays: [] }
  }

  const dayOfWeek = targetDate.toLocaleDateString('en-AU', { weekday: 'long' }).toLowerCase()
  const allowed = zoneConfig.preferred_days.includes(dayOfWeek as any)

  return {
    allowed,
    zone: zoneEntry.zone_name,
    preferredDays: zoneConfig.preferred_days,
  }
}

/**
 * Evaluate cluster rule - check if candidate is within cluster radius of existing jobs
 */
export function evaluateClusterRule(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  existingRunJobs: SchedulingCandidate[]
): { inCluster: boolean; nearestJobKm: number | null; anchorExists: boolean } {
  if (existingRunJobs.length === 0) {
    return { inCluster: false, nearestJobKm: null, anchorExists: false }
  }

  let nearestDistance = null
  let inCluster = false

  for (const job of existingRunJobs) {
    const distance = haversineKm(candidate.lat, candidate.lng, job.lat, job.lng)
    if (nearestDistance === null || distance < nearestDistance) {
      nearestDistance = distance
    }

    if (distance <= rules.cluster_radius_km) {
      inCluster = true
    }
  }

  // Check for anchor job in same zone
  const candidateZone = rules.postcode_zone_map.find(z => z.postcode === candidate.postcode)?.zone_name
  const anchorExists = rules.anchor_job_enabled && existingRunJobs.some(job => {
    const jobZone = rules.postcode_zone_map.find(z => z.postcode === job.postcode)?.zone_name
    return jobZone === candidateZone
  })

  return {
    inCluster,
    nearestJobKm: nearestDistance,
    anchorExists,
  }
}

/**
 * Evaluate urgency rules - KPI override, days since lodged, insurer SLA
 */
export function evaluateUrgencyRules(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  now: Date
): {
  kpiOverride: boolean
  daysOverride: boolean
  insurerPriorityBoost: boolean
  priorityDelta: number
  flags: string[]
} {
  const flags: string[] = []
  let priorityDelta = 0

  let kpiOverride = false
  let daysOverride = false
  let insurerPriorityBoost = false

  // KPI override
  if (candidate.kpi_visit_due) {
    const hoursUntilBreach = (new Date(candidate.kpi_visit_due).getTime() - now.getTime()) / (1000 * 60 * 60)
    if (hoursUntilBreach <= rules.kpi_override_hours && hoursUntilBreach > 0) {
      kpiOverride = true
      priorityDelta += 40
      flags.push(`KPI breach in ${Math.round(hoursUntilBreach)} hours — queue jump`)
    }
  }

  // Days since lodged escalation
  if (candidate.days_since_lodged >= rules.days_since_lodged_escalation) {
    daysOverride = true
    priorityDelta += 20
    flags.push(`Unscheduled ${candidate.days_since_lodged} days — priority escalated`)
  }

  // Insurer SLA priority boost
  const insurerConfig = rules.insurer_sla_config.find(c => c.client_id === candidate.client_id)
  if (insurerConfig && insurerConfig.priority_boost) {
    insurerPriorityBoost = true
    priorityDelta += 15
    flags.push(`Insurer SLA priority: ${insurerConfig.insurer_name}`)
  }

  return {
    kpiOverride,
    daysOverride,
    insurerPriorityBoost,
    priorityDelta,
    flags,
  }
}

/**
 * Evaluate scheduling mode - quiet, busy, cat_event, or manual
 */
export function evaluateSchedulingMode(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  existingRunJobs: SchedulingCandidate[],
  unscheduledTotalCount: number
): {
  mode: string
  holdRequired: boolean
  reason: string
} {
  let mode = rules.scheduling_mode

  // Auto-mode check
  if (unscheduledTotalCount >= rules.auto_mode_trigger_count && mode === 'quiet') {
    mode = 'busy'
  }

  switch (mode) {
    case 'cat_event':
      return {
        mode: 'cat_event',
        holdRequired: false,
        reason: '',
      }

    case 'busy':
      // Schedule if within busy radius of any existing job, or if no jobs yet
      if (existingRunJobs.length === 0) {
        return {
          mode: 'busy',
          holdRequired: false,
          reason: '',
        }
      }

      const inBusyRadius = existingRunJobs.some(job => {
        const distance = haversineKm(candidate.lat, candidate.lng, job.lat, job.lng)
        return distance <= rules.busy_mode_radius_km
      })

      if (inBusyRadius) {
        return {
          mode: 'busy',
          holdRequired: false,
          reason: '',
        }
      }

      return {
        mode: 'busy',
        holdRequired: true,
        reason: `Not within busy mode radius (${rules.busy_mode_radius_km}km) of existing jobs`,
      }

    case 'quiet':
      const clusterResult = evaluateClusterRule(candidate, rules, existingRunJobs)
      const daysEscalated = candidate.days_since_lodged >= rules.quiet_mode_hold_days

      if (clusterResult.inCluster || daysEscalated) {
        return {
          mode: 'quiet',
          holdRequired: false,
          reason: daysEscalated ? `Quiet mode hold period exceeded (${rules.quiet_mode_hold_days} days)` : '',
        }
      }

      return {
        mode: 'quiet',
        holdRequired: true,
        reason: `Quiet mode: waiting for cluster or hold period (${rules.quiet_mode_hold_days} days)`,
      }

    case 'manual':
      return {
        mode: 'manual',
        holdRequired: true,
        reason: 'Manual mode — human scheduling only',
      }

    default:
      return {
        mode: 'unknown',
        holdRequired: true,
        reason: 'Unknown scheduling mode',
      }
  }
}

/**
 * Evaluate time of day preferences and duration
 */
export function evaluateTimeOfDay(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules
): {
  preferredTimeOfDay: 'morning' | 'afternoon' | 'any'
  estimatedDurationMinutes: number
  requiresExtendedBlock: boolean
} {
  let preferredTimeOfDay: 'morning' | 'afternoon' | 'any' = 'any'

  // Complex job types prefer morning
  const complexJobTypes = ['BAR_make_safe', 'roof_report', 'leak_detection', 'specialist']
  if (rules.morning_complex_jobs && complexJobTypes.includes(candidate.wo_type)) {
    preferredTimeOfDay = 'morning'
  }

  // Simple BARs prefer afternoon
  if (rules.afternoon_simple_jobs && candidate.wo_type === 'BAR') {
    preferredTimeOfDay = 'afternoon'
  }

  // Vulnerable person preference
  if (candidate.vulnerable_person && rules.vulnerable_person_morning_preference) {
    preferredTimeOfDay = 'morning'
  }

  const estimatedDurationMinutes = getJobDuration(candidate, rules)
  const requiresExtendedBlock = estimatedDurationMinutes > 75

  return {
    preferredTimeOfDay,
    estimatedDurationMinutes,
    requiresExtendedBlock,
  }
}

/**
 * Evaluate peak hour traffic risk
 */
export function evaluatePeakHourRisk(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  inspectorHomeLat: number,
  inspectorHomeLng: number,
  proposedStartTime: string // HH:MM
): {
  peakRisk: boolean
  reason: string | null
} {
  if (!rules.peak_hour_config.enabled) {
    return { peakRisk: false, reason: null }
  }

  const config = rules.peak_hour_config
  const [hours, minutes] = proposedStartTime.split(':').map(Number)
  const proposedTimeMinutes = hours * 60 + minutes

  const [morningStartH, morningStartM] = config.morning_peak_start.split(':').map(Number)
  const [morningEndH, morningEndM] = config.morning_peak_end.split(':').map(Number)
  const morningStartMinutes = morningStartH * 60 + morningStartM
  const morningEndMinutes = morningEndH * 60 + morningEndM

  const [afternoonStartH, afternoonStartM] = config.afternoon_peak_start.split(':').map(Number)
  const [afternoonEndH, afternoonEndM] = config.afternoon_peak_end.split(':').map(Number)
  const afternoonStartMinutes = afternoonStartH * 60 + afternoonStartM
  const afternoonEndMinutes = afternoonEndH * 60 + afternoonEndM

  const inMorningPeak = proposedTimeMinutes >= morningStartMinutes && proposedTimeMinutes <= morningEndMinutes
  const inAfternoonPeak = proposedTimeMinutes >= afternoonStartMinutes && proposedTimeMinutes <= afternoonEndMinutes

  if (!inMorningPeak && !inAfternoonPeak) {
    return { peakRisk: false, reason: null }
  }

  // Calculate direction vectors
  const toJobX = candidate.lng - inspectorHomeLng
  const toJobY = candidate.lat - inspectorHomeLat
  const toCbdX = config.cbd_lng - inspectorHomeLng
  const toCbdY = config.cbd_lat - inspectorHomeLat

  // Normalize vectors
  const toJobMag = Math.sqrt(toJobX * toJobX + toJobY * toJobY)
  const toCbdMag = Math.sqrt(toCbdX * toCbdX + toCbdY * toCbdY)

  if (toJobMag === 0 || toCbdMag === 0) {
    return { peakRisk: false, reason: null }
  }

  const toJobNormX = toJobX / toJobMag
  const toJobNormY = toJobY / toJobMag
  const toCbdNormX = toCbdX / toCbdMag
  const toCbdNormY = toCbdY / toCbdMag

  // Dot product gives cosine of angle between vectors
  const dotProduct = toJobNormX * toCbdNormX + toJobNormY * toCbdNormY
  const alignmentPct = (dotProduct + 1) / 2 * 100 // Convert from [-1,1] to [0,100]

  if (inMorningPeak) {
    // Morning peak: driving toward CBD is bad (with traffic)
    if (alignmentPct > config.inbound_threshold_pct) {
      return {
        peakRisk: true,
        reason: 'Job requires driving toward CBD during morning peak — consider scheduling before 07:30 or after 09:30',
      }
    }
  }

  if (inAfternoonPeak) {
    // Afternoon peak: driving away from CBD is bad (with traffic)
    if (alignmentPct < (100 - config.inbound_threshold_pct)) {
      return {
        peakRisk: true,
        reason: 'Job requires driving away from CBD during afternoon peak — consider scheduling before 15:30 or after 17:30',
      }
    }
  }

  return { peakRisk: false, reason: null }
}

/**
 * Evaluate insured constraints
 */
export function evaluateInsuredConstraints(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  targetDate: Date,
  proposedTime: string // HH:MM
): {
  blocked: boolean
  reasons: string[]
  notes: string[]
} {
  const reasons: string[] = []
  const notes: string[] = []

  // Access constraint block
  if (candidate.has_access_constraint && rules.access_constraint_block) {
    reasons.push('Access constraint — requires manual scheduling')
  }

  // Repeat reschedule flag
  if (candidate.cancellation_count >= rules.repeat_reschedule_threshold) {
    notes.push(`${candidate.cancellation_count} cancellations — flag for phone call instead of SMS proposal`)
  }

  // Insured availability notes
  if (candidate.insured_availability_notes) {
    const notes_lower = candidate.insured_availability_notes.toLowerCase()
    if (notes_lower.includes('morning') || notes_lower.includes('afternoon') || notes_lower.includes('not')) {
      notes.push(`Insured availability preference: ${candidate.insured_availability_notes}`)
    }
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    notes,
  }
}

/**
 * Evaluate hold rules
 */
export function evaluateHoldRules(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  orderReceivedAt: Date,
  now: Date,
  linkedOrderCount: number
): {
  holdRequired: boolean
  reason: string | null
} {
  // New order hold window
  const minutesSinceOrder = (now.getTime() - orderReceivedAt.getTime()) / (1000 * 60)
  if (minutesSinceOrder < rules.new_order_hold_minutes) {
    return {
      holdRequired: true,
      reason: `New order hold — wait ${Math.round(rules.new_order_hold_minutes - minutesSinceOrder)} more minutes before scheduling (cluster detection window)`,
    }
  }

  // Same-claim multi-order hold
  if (rules.same_claim_hold_enabled && linkedOrderCount > 1) {
    return {
      holdRequired: true,
      reason: 'Multiple orders on same claim — link all orders before scheduling',
    }
  }

  return {
    holdRequired: false,
    reason: null,
  }
}

/**
 * Evaluate overflow eligibility
 */
export function evaluateOverflowEligibility(
  candidate: SchedulingCandidate,
  rules: InspectionSchedulingRules,
  existingRunJobs: SchedulingCandidate[],
  currentRunCount: number
): {
  overflowEligible: boolean
  reason: string
} {
  const overflowSlotsAvailable = currentRunCount >= rules.max_daily_inspections && currentRunCount < rules.max_daily_inspections + rules.overflow_max_per_day

  if (!overflowSlotsAvailable) {
    return {
      overflowEligible: false,
      reason: 'No overflow slots available',
    }
  }

  // Make safes are always overflow-eligible if there's any slot
  if (candidate.is_make_safe) {
    return {
      overflowEligible: true,
      reason: 'Make safe — overflow eligible',
    }
  }

  // Check if within overflow radius of existing confirmed job
  const inOverflowRadius = existingRunJobs.some(job => {
    const distance = haversineKm(candidate.lat, candidate.lng, job.lat, job.lng)
    return distance <= rules.overflow_radius_km
  })

  if (inOverflowRadius) {
    return {
      overflowEligible: true,
      reason: `Within overflow radius (${rules.overflow_radius_km}km) of confirmed run job`,
    }
  }

  return {
    overflowEligible: false,
    reason: `Not within overflow radius (${rules.overflow_radius_km}km) of any confirmed run job`,
  }
}

/**
 * Haversine formula for distance between two lat/lng points in kilometres
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180)
}

/**
 * Get job duration from rules, with vulnerable person adjustment
 */
function getJobDuration(candidate: SchedulingCandidate, rules: InspectionSchedulingRules): number {
  const durationConfig = rules.job_type_durations.find(d => d.job_type === candidate.wo_type)
  let duration = durationConfig ? durationConfig.duration_minutes : 60

  if (candidate.vulnerable_person) {
    duration += rules.vulnerable_person_extra_minutes
  }

  return duration
}
