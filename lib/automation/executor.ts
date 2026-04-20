/**
 * Automation Executor
 * Executes automation rules with time-aware delivery gating and delay calculation
 */

import { createClient } from '@supabase/supabase-js'
import { 
  parseTimeConfig, 
  isWithinSendWindow, 
  getNextSendTime, 
  addDelay, 
  resolveEffectiveTimeConfig,
  type TimeConfig,
  type JobAutomationOverrides
} from '@/lib/scheduling/business-hours'
import { getAutomationRule, type AutomationStep } from './rules'

interface ExecutionContext {
  jobId: string
  tenantId: string
  ruleKey: string
  actionQueueItemId?: string
}

interface ExecutionResult {
  success: boolean
  scheduledFor?: Date
  error?: string
}

/**
 * Executes an automation rule with time-aware delivery gating.
 * 
 * @param context - Execution context with job and tenant info
 * @returns Execution result with success status and scheduled time if queued
 */
export async function executeRule(context: ExecutionContext): Promise<ExecutionResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Load automation_config once per execution run
  const { data: configData, error: configError } = await supabase
    .from('automation_config')
    .select('key, value')
    .eq('tenant_id', context.tenantId)

  if (configError) {
    return { success: false, error: `Failed to load automation_config: ${configError.message}` }
  }

  const rawConfig: Record<string, string> = {}
  configData?.forEach(row => {
    rawConfig[row.key] = row.value
  })

  const timeConfig = parseTimeConfig(rawConfig)

  // 2. Load jobs.automation_overrides for this job
  const { data: jobData, error: jobError } = await supabase
    .from('jobs')
    .select('automation_overrides')
    .eq('id', context.jobId)
    .single()

  if (jobError) {
    return { success: false, error: `Failed to load job: ${jobError.message}` }
  }

  const jobOverrides: JobAutomationOverrides = jobData?.automation_overrides || {}

  // Get the rule definition
  const rule = getAutomationRule(context.ruleKey)
  if (!rule) {
    return { success: false, error: `Rule not found: ${context.ruleKey}` }
  }

  // Execute each step in the rule
  for (const step of rule.steps) {
    const stepResult = await executeStep(step, timeConfig, rule.time_mode, jobOverrides, context, supabase)
    if (!stepResult.success) {
      return stepResult
    }
  }

  return { success: true }
}

/**
 * Executes a single automation step with time-aware delivery gating.
 */
async function executeStep(
  step: AutomationStep,
  timeConfig: TimeConfig,
  ruleTimeMode: 'business_hours' | 'waking_hours' | 'urgent' | 'send_window',
  jobOverrides: JobAutomationOverrides,
  context: ExecutionContext,
  supabase: any
): Promise<ExecutionResult> {
  const now = new Date()

  // Handle send_sms and send_email with delivery gating
  if (step.type === 'send_sms' || step.type === 'send_email') {
    // 4. Determine contactType and tradeId from step config
    const config = step.config as any
    let contactType: 'insured' | 'trade' | undefined
    let tradeId: string | undefined

    if (config.to === 'insured') {
      contactType = 'insured'
    } else if (config.to === 'trade') {
      contactType = 'trade'
      // tradeId would need to be determined from job context - this is a placeholder
      // In a real implementation, you'd fetch the assigned trade from work_orders
    }

    // 5. Resolve effective time config
    const resolved = resolveEffectiveTimeConfig(
      timeConfig,
      ruleTimeMode,
      jobOverrides,
      contactType,
      tradeId
    )

    // 6. Check if within send window
    if (!isWithinSendWindow(timeConfig, resolved.mode, now)) {
      // Outside window - schedule for next valid time
      const nextSendTime = getNextSendTime(timeConfig, resolved.mode, now)

      // Write schedule_followup action queue row
      const { error: insertError } = await supabase
        .from('action_queue')
        .insert({
          tenant_id: context.tenantId,
          job_id: context.jobId,
          rule_key: context.ruleKey,
          title: `Scheduled ${step.type} (queued)`,
          description: `Message queued for ${nextSendTime.toISOString()}`,
          status: 'pending',
          scheduled_for: nextSendTime.toISOString()
        })

      if (insertError) {
        return { success: false, error: `Failed to queue message: ${insertError.message}` }
      }

      return { success: true, scheduledFor: nextSendTime }
    }

    // Within window - send immediately
    // In a real implementation, this would call the actual SMS/email sending logic
    console.log(`Sending ${step.type} immediately to ${config.to}`)
    return { success: true }
  }

  // Handle schedule_followup with delay calculation
  if (step.type === 'schedule_followup') {
    const config = step.config as any
    
    // 7. Replace raw delay calculation with addDelay
    const scheduledTime = addDelay(
      timeConfig,
      now,
      config.delay_value,
      config.delay_unit
    )

    // Write schedule_followup action queue row
    const { error: insertError } = await supabase
      .from('action_queue')
      .insert({
        tenant_id: context.tenantId,
        job_id: context.jobId,
        rule_key: config.followup_rule_key,
        title: `Scheduled follow-up`,
        description: `Follow-up scheduled for ${scheduledTime.toISOString()}`,
        status: 'pending',
        scheduled_for: scheduledTime.toISOString()
      })

    if (insertError) {
      return { success: false, error: `Failed to schedule follow-up: ${insertError.message}` }
    }

    return { success: true, scheduledFor: scheduledTime }
  }

  // Handle other step types (notify_internal, create_action_card)
  // These don't require time gating
  console.log(`Executing step type: ${step.type}`)
  return { success: true }
}
