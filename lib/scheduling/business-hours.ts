/**
 * Business Hours & Time Mode System
 * 
 * Single source of truth for all time-mode logic in IRC Master.
 * Handles delivery gating (when to send) and delay calculation (when next event fires).
 */

import { 
  format, 
  parse, 
  addMinutes, 
  addHours, 
  addDays, 
  startOfDay, 
  endOfDay,
  isBefore,
  isAfter,
  isEqual,
  getDay,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds
} from 'date-fns'
import { 
  toZonedTime, 
  fromZonedTime, 
  formatInTimeZone 
} from 'date-fns-tz'

/**
 * Time mode controls both delivery gating and delay calculation for automation rules.
 */
export type TimeMode = 'business_hours' | 'waking_hours' | 'urgent' | 'send_window'

/**
 * Delay unit is a semantic fact about what a timer means. Hardcoded in rule definition.
 */
export type DelayUnit = 'minutes' | 'hours' | 'calendar_days' | 'business_days'

/**
 * Global time configuration loaded from automation_config.
 */
export interface TimeConfig {
  business_hours_start: string    // "HH:MM"
  business_hours_end: string      // "HH:MM"
  business_days: number[]         // [1,2,3,4,5] ISO day numbers, 1=Mon
  public_holidays: string[]       // ["YYYY-MM-DD"]
  waking_hours_start: string
  waking_hours_end: string
  urgent_hours_start: string
  urgent_hours_end: string
  urgent_all_days: boolean
  gary_send_window_start: string
  gary_send_window_end: string
  gary_send_window_tz: string
  timezone: string                // use gary_send_window_tz as source
}

/**
 * Per-job automation overrides from jobs.automation_overrides JSONB field.
 */
export interface JobAutomationOverrides {
  // Existing keys — do not remove
  gary_enabled?: boolean
  gary_deadline_hours?: number
  homeowner_sms_enabled?: boolean
  gary_send_window_start?: string
  gary_send_window_end?: string
  // New keys added by this feature
  time_mode_override?: TimeMode
  insured_contact_window_start?: string
  insured_contact_window_end?: string
  insured_contact_all_days?: boolean
  trade_contact_overrides?: Record<string, {
    contact_window_start?: string
    contact_window_end?: string
    contact_all_days?: boolean
  }>
}

/**
 * Resolved time configuration for a specific send operation.
 * Master resolution function combines global config, rule mode, and job overrides.
 */
export interface ResolvedTimeConfig {
  mode: TimeMode
  windowStart: string    // "HH:MM" effective for this specific send
  windowEnd: string      // "HH:MM"
  allDays: boolean
  timezone: string
  businessDays: number[]
  publicHolidays: string[]
}

/**
 * Parses flat automation_config string pairs to typed TimeConfig.
 * 
 * @param rawConfig - Record of key-value pairs from automation_config table
 * @returns Typed TimeConfig with safe fallback defaults for missing keys
 * 
 * @example
 * ```ts
 * const rawConfig = {
 *   business_hours_start: '07:00',
 *   business_hours_end: '17:30',
 *   business_days: '1,2,3,4,5',
 *   public_holidays: '["2024-12-25","2025-01-01"]',
 *   urgent_all_days: 'true',
 *   gary_send_window_tz: 'Australia/Perth'
 * }
 * const config = parseTimeConfig(rawConfig)
 * // config.business_days === [1,2,3,4,5]
 * // config.public_holidays === ['2024-12-25', '2025-01-01']
 * // config.urgent_all_days === true
 * ```
 */
export function parseTimeConfig(rawConfig: Record<string, string>): TimeConfig {
  const parseBoolean = (value: string | undefined): boolean => {
    if (!value) return false
    return value.toLowerCase() === 'true'
  }

  const parseNumberArray = (value: string | undefined): number[] => {
    if (!value) return [1, 2, 3, 4, 5] // Default Mon-Fri
    return value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
  }

  const parseJsonArray = (value: string | undefined): string[] => {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  return {
    business_hours_start: rawConfig.business_hours_start || '07:00',
    business_hours_end: rawConfig.business_hours_end || '17:30',
    business_days: parseNumberArray(rawConfig.business_days),
    public_holidays: parseJsonArray(rawConfig.public_holidays),
    waking_hours_start: rawConfig.waking_hours_start || '07:00',
    waking_hours_end: rawConfig.waking_hours_end || '20:00',
    urgent_hours_start: rawConfig.urgent_hours_start || '05:00',
    urgent_hours_end: rawConfig.urgent_hours_end || '22:00',
    urgent_all_days: parseBoolean(rawConfig.urgent_all_days),
    gary_send_window_start: rawConfig.gary_send_window_start || '06:00',
    gary_send_window_end: rawConfig.gary_send_window_end || '19:00',
    gary_send_window_tz: rawConfig.gary_send_window_tz || 'Australia/Perth',
    timezone: rawConfig.gary_send_window_tz || 'Australia/Perth'
  }
}

/**
 * Returns true if the given time is within the valid delivery window for the mode.
 * All comparisons are in config.timezone.
 * 
 * @param config - Time configuration
 * @param mode - Time mode to check
 * @param at - Time to check (default: now)
 * @returns True if within valid send window
 * 
 * @example
 * ```ts
 * const config = parseTimeConfig(rawConfig)
 * const canSend = isWithinSendWindow(config, 'business_hours', new Date())
 * // Returns false if it's Sunday or outside 07:00-17:30
 * ```
 */
export function isWithinSendWindow(config: TimeConfig, mode: TimeMode, at: Date = new Date()): boolean {
  const zonedTime = toZonedTime(at, config.timezone)
  const dayOfWeek = getDay(zonedTime) // 0=Sun, 1=Mon, ..., 6=Sat
  const currentTime = format(zonedTime, 'HH:mm')
  
  const isBusinessDay = config.business_days.includes(dayOfWeek)
  const dateString = format(zonedTime, 'yyyy-MM-dd')
  const isHoliday = config.public_holidays.includes(dateString)

  const isTimeInRange = (start: string, end: string): boolean => {
    return (currentTime >= start && currentTime <= end)
  }

  switch (mode) {
    case 'business_hours':
      return isBusinessDay && !isHoliday && isTimeInRange(config.business_hours_start, config.business_hours_end)
    
    case 'waking_hours':
      return isTimeInRange(config.waking_hours_start, config.waking_hours_end)
    
    case 'urgent':
      const urgentDayOk = config.urgent_all_days || isBusinessDay
      return urgentDayOk && isTimeInRange(config.urgent_hours_start, config.urgent_hours_end)
    
    case 'send_window':
      return isTimeInRange(config.gary_send_window_start, config.gary_send_window_end)
    
    default:
      return false
  }
}

/**
 * Returns the next valid delivery time at or after the reference time.
 * If already within valid window, returns reference time unchanged.
 * If outside window, returns the opening time of the next valid window.
 * 
 * @param config - Time configuration
 * @param mode - Time mode to use
 * @param referenceTime - Reference time (default: now)
 * @returns Next valid send time in config.timezone
 * 
 * @example
 * ```ts
 * const config = parseTimeConfig(rawConfig)
 * const nextSend = getNextSendTime(config, 'business_hours', new Date('2024-12-25T20:00:00'))
 * // Returns Monday Dec 30 at 07:00 (skips Christmas weekend)
 * ```
 */
export function getNextSendTime(config: TimeConfig, mode: TimeMode, referenceTime: Date = new Date()): Date {
  const zonedRef = toZonedTime(referenceTime, config.timezone)
  
  // If already within window, return reference time
  if (isWithinSendWindow(config, mode, referenceTime)) {
    return referenceTime
  }

  const parseTime = (timeStr: string): { hours: number, minutes: number } => {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return { hours, minutes }
  }

  let windowStart: string
  let windowEnd: string
  let checkBusinessDays: boolean

  switch (mode) {
    case 'business_hours':
      windowStart = config.business_hours_start
      windowEnd = config.business_hours_end
      checkBusinessDays = true
      break
    case 'waking_hours':
      windowStart = config.waking_hours_start
      windowEnd = config.waking_hours_end
      checkBusinessDays = false
      break
    case 'urgent':
      windowStart = config.urgent_hours_start
      windowEnd = config.urgent_hours_end
      checkBusinessDays = !config.urgent_all_days
      break
    case 'send_window':
      windowStart = config.gary_send_window_start
      windowEnd = config.gary_send_window_end
      checkBusinessDays = false
      break
    default:
      return referenceTime
  }

  // Edge case: if start === end, return reference time to prevent infinite loop
  if (windowStart === windowEnd) {
    return referenceTime
  }

  const { hours: startHours, minutes: startMinutes } = parseTime(windowStart)
  const { hours: endHours, minutes: endMinutes } = parseTime(windowEnd)
  const currentTime = format(zonedRef, 'HH:mm')
  const currentDay = getDay(zonedRef)
  const dateString = format(zonedRef, 'yyyy-MM-dd')
  const isHoliday = config.public_holidays.includes(dateString)
  const isBusinessDay = config.business_days.includes(currentDay)

  // Check if we're after the window on the current day
  if (currentTime > windowEnd) {
    // Move to next day
    let nextDay = addDays(zonedRef, 1)
    let iterations = 0
    const maxIterations = 365 // Prevent infinite loop on misconfiguration
    
    while (iterations < maxIterations) {
      const nextDayZoned = toZonedTime(nextDay, config.timezone)
      const nextDayOfWeek = getDay(nextDayZoned)
      const nextDateString = format(nextDayZoned, 'yyyy-MM-dd')
      const nextIsHoliday = config.public_holidays.includes(nextDateString)
      const nextIsBusinessDay = config.business_days.includes(nextDayOfWeek)
      
      if (!checkBusinessDays || (nextIsBusinessDay && !nextIsHoliday)) {
        // Set to window start time
        const atWindowStart = setHours(setMinutes(setSeconds(setMilliseconds(nextDayZoned, 0), startMinutes), 0), startHours)
        return fromZonedTime(atWindowStart, config.timezone)
      }
      
      nextDay = addDays(nextDay, 1)
      iterations++
    }
    
    // Fallback: return reference time if we hit max iterations
    return referenceTime
  }

  // Check if we're before the window on the current day
  if (currentTime < windowStart) {
    // Check if current day is valid
    const dayValid = !checkBusinessDays || (isBusinessDay && !isHoliday)
    if (dayValid) {
      const atWindowStart = setHours(setMinutes(setSeconds(setMilliseconds(zonedRef, 0), startMinutes), 0), startHours)
      return fromZonedTime(atWindowStart, config.timezone)
    }
    
    // Current day not valid, move to next valid day
    let nextDay = addDays(zonedRef, 1)
    let iterations = 0
    const maxIterations = 365
    
    while (iterations < maxIterations) {
      const nextDayZoned = toZonedTime(nextDay, config.timezone)
      const nextDayOfWeek = getDay(nextDayZoned)
      const nextDateString = format(nextDayZoned, 'yyyy-MM-dd')
      const nextIsHoliday = config.public_holidays.includes(nextDateString)
      const nextIsBusinessDay = config.business_days.includes(nextDayOfWeek)
      
      if (!checkBusinessDays || (nextIsBusinessDay && !nextIsHoliday)) {
        const atWindowStart = setHours(setMinutes(setSeconds(setMilliseconds(nextDayZoned, 0), startMinutes), 0), startHours)
        return fromZonedTime(atWindowStart, config.timezone)
      }
      
      nextDay = addDays(nextDay, 1)
      iterations++
    }
    
    return referenceTime
  }

  // Default: return reference time
  return referenceTime
}

/**
 * Calculates the wall-clock timestamp after adding a delay to startTime.
 * 
 * @param config - Time configuration
 * @param startTime - Starting time
 * @param value - Numeric delay value
 * @param unit - Delay unit (semantic fact about what the timer means)
 * @returns Calculated timestamp
 * 
 * @example
 * ```ts
 * const config = parseTimeConfig(rawConfig)
 * const deadline = addDelay(config, workOrderSentAt, 2, 'business_days')
 * // If workOrderSentAt is Friday 4pm, returns Tuesday at 07:00 (skips weekend)
 * ```
 */
export function addDelay(config: TimeConfig, startTime: Date, value: number, unit: DelayUnit): Date {
  const zonedStart = toZonedTime(startTime, config.timezone)

  switch (unit) {
    case 'minutes':
      const minutesResult = addMinutes(zonedStart, value)
      return fromZonedTime(minutesResult, config.timezone)
    
    case 'hours':
      const hoursResult = addHours(zonedStart, value)
      return fromZonedTime(hoursResult, config.timezone)
    
    case 'calendar_days':
      const daysResult = addDays(zonedStart, value)
      return fromZonedTime(daysResult, config.timezone)
    
    case 'business_days':
      // Advance day-by-day, counting only business days
      let currentDay = startOfDay(zonedStart)
      let businessDaysCounted = 0
      const maxIterations = 365 // Prevent infinite loop on empty business_days
      
      while (businessDaysCounted < value && maxIterations > 0) {
        currentDay = addDays(currentDay, 1)
        const dayOfWeek = getDay(currentDay)
        const dateString = format(currentDay, 'yyyy-MM-dd')
        const isHoliday = config.public_holidays.includes(dateString)
        const isBusinessDay = config.business_days.includes(dayOfWeek)
        
        if (isBusinessDay && !isHoliday) {
          businessDaysCounted++
        }
      }
      
      // Return at business_hours_start time
      const [startHours, startMinutes] = config.business_hours_start.split(':').map(Number)
      const atBusinessHoursStart = setHours(setMinutes(setSeconds(setMilliseconds(currentDay, 0), startMinutes), 0), startHours)
      return fromZonedTime(atBusinessHoursStart, config.timezone)
    
    default:
      return startTime
  }
}

/**
 * Master resolution function. Called before every send to determine effective window.
 * Override resolution order (most specific wins):
 * 1. jobOverrides.trade_contact_overrides[tradeId] - if contactType is 'trade'
 * 2. jobOverrides.insured_contact_window_start/end - if contactType is 'insured'
 * 3. jobOverrides.time_mode_override - job-level mode override
 * 4. mode parameter - rule-level default
 * 5. config global values - tenant defaults
 * 
 * @param config - Global time configuration
 * @param mode - Rule-level default time mode
 * @param jobOverrides - Per-job automation overrides
 * @param contactType - Type of contact ('insured' or 'trade')
 * @param tradeId - Trade ID (for trade-specific overrides)
 * @returns Resolved time configuration for this specific send
 * 
 * @example
 * ```ts
 * const config = parseTimeConfig(rawConfig)
 * const overrides = { time_mode_override: 'urgent' }
 * const resolved = resolveEffectiveTimeConfig(config, 'business_hours', overrides, 'insured')
 * // resolved.mode === 'urgent' (override takes precedence)
 * ```
 */
export function resolveEffectiveTimeConfig(
  config: TimeConfig,
  mode: TimeMode,
  jobOverrides?: JobAutomationOverrides,
  contactType?: 'insured' | 'trade',
  tradeId?: string
): ResolvedTimeConfig {
  let effectiveMode = mode
  let effectiveWindowStart: string
  let effectiveWindowEnd: string
  let effectiveAllDays = false

  // 1. Trade-specific override (highest priority)
  if (contactType === 'trade' && tradeId && jobOverrides?.trade_contact_overrides?.[tradeId]) {
    const tradeOverride = jobOverrides.trade_contact_overrides[tradeId]
    effectiveWindowStart = tradeOverride.contact_window_start || config.business_hours_start
    effectiveWindowEnd = tradeOverride.contact_window_end || config.business_hours_end
    effectiveAllDays = tradeOverride.contact_all_days || false
  }
  // 2. Insured-specific override
  else if (contactType === 'insured' && jobOverrides?.insured_contact_window_start) {
    effectiveWindowStart = jobOverrides.insured_contact_window_start
    effectiveWindowEnd = jobOverrides.insured_contact_window_end || config.waking_hours_end
    effectiveAllDays = jobOverrides.insured_contact_all_days || false
  }
  // 3. Job-level mode override
  else if (jobOverrides?.time_mode_override) {
    effectiveMode = jobOverrides.time_mode_override
    switch (effectiveMode) {
      case 'business_hours':
        effectiveWindowStart = config.business_hours_start
        effectiveWindowEnd = config.business_hours_end
        effectiveAllDays = false
        break
      case 'waking_hours':
        effectiveWindowStart = config.waking_hours_start
        effectiveWindowEnd = config.waking_hours_end
        effectiveAllDays = true
        break
      case 'urgent':
        effectiveWindowStart = config.urgent_hours_start
        effectiveWindowEnd = config.urgent_hours_end
        effectiveAllDays = config.urgent_all_days
        break
      case 'send_window':
        effectiveWindowStart = config.gary_send_window_start
        effectiveWindowEnd = config.gary_send_window_end
        effectiveAllDays = true
        break
    }
  }
  // 4. Rule-level mode (parameter)
  else {
    switch (mode) {
      case 'business_hours':
        effectiveWindowStart = config.business_hours_start
        effectiveWindowEnd = config.business_hours_end
        effectiveAllDays = false
        break
      case 'waking_hours':
        effectiveWindowStart = config.waking_hours_start
        effectiveWindowEnd = config.waking_hours_end
        effectiveAllDays = true
        break
      case 'urgent':
        effectiveWindowStart = config.urgent_hours_start
        effectiveWindowEnd = config.urgent_hours_end
        effectiveAllDays = config.urgent_all_days
        break
      case 'send_window':
        effectiveWindowStart = config.gary_send_window_start
        effectiveWindowEnd = config.gary_send_window_end
        effectiveAllDays = true
        break
      default:
        effectiveWindowStart = config.business_hours_start
        effectiveWindowEnd = config.business_hours_end
        effectiveAllDays = false
    }
  }

  return {
    mode: effectiveMode,
    windowStart: effectiveWindowStart,
    windowEnd: effectiveWindowEnd,
    allDays: effectiveAllDays,
    timezone: config.timezone,
    businessDays: config.business_days,
    publicHolidays: config.public_holidays
  }
}
