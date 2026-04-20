/**
 * Automation Rules Configuration
 * Defines automation rules with time modes and delay units for IRC Master
 */

import { TimeMode, DelayUnit } from '@/lib/scheduling/business-hours'

export interface AutomationRule {
  key: string
  title: string
  description: string
  time_mode: TimeMode
  steps: AutomationStep[]
}

export interface AutomationStep {
  type: 'send_sms' | 'send_email' | 'schedule_followup' | 'notify_internal' | 'create_action_card'
  config: SendSmsConfig | SendEmailConfig | ScheduleFollowupConfig | NotifyInternalConfig | CreateActionCardConfig
}

export interface SendSmsConfig {
  template_key: string
  to: 'insured' | 'trade' | 'insurer'
}

export interface SendEmailConfig {
  template_key: string
  to: 'insured' | 'trade' | 'insurer'
}

export interface ScheduleFollowupConfig {
  delay_value: number    // the numeric value — user can change this in automation_config
  delay_unit: DelayUnit  // hardcoded in the rule — NOT user-configurable
  followup_rule_key: string
}

export interface NotifyInternalConfig {
  message: string
}

export interface CreateActionCardConfig {
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
}

// Automation rules with time_mode and delay_unit configured
export const automationRules: AutomationRule[] = [
  {
    key: 'make_safe_dispatch_cascade',
    title: 'Make Safe Dispatch Cascade',
    description: 'Cascading SMS to trades for make safe work orders',
    time_mode: 'urgent',
    steps: [
      {
        type: 'send_sms',
        config: {
          template_key: 'sms_trade_make_safe',
          to: 'trade'
        }
      }
    ]
  },
  {
    key: 'gary_trade_scheduling',
    title: 'Gary Trade Scheduling',
    description: 'Gary sends work order SMS to trade',
    time_mode: 'send_window',
    steps: [
      {
        type: 'send_sms',
        config: {
          template_key: 'sms_trade_work_order',
          to: 'trade'
        }
      }
    ]
  },
  {
    key: 'gary_reminder_1',
    title: 'Gary Reminder 1',
    description: 'First reminder to trade after work order sent',
    time_mode: 'send_window',
    steps: [
      {
        type: 'schedule_followup',
        config: {
          delay_value: 1,
          delay_unit: 'business_days',
          followup_rule_key: 'gary_reminder_1_send'
        }
      }
    ]
  },
  {
    key: 'gary_final_nudge',
    title: 'Gary Final Nudge',
    description: 'Final nudge before escalation',
    time_mode: 'send_window',
    steps: [
      {
        type: 'schedule_followup',
        config: {
          delay_value: 2,
          delay_unit: 'business_days',
          followup_rule_key: 'gary_final_nudge_send'
        }
      }
    ]
  },
  {
    key: 'gary_escalation_deadline',
    title: 'Gary Escalation Deadline',
    description: 'Trade escalation deadline for management review',
    time_mode: 'business_hours',
    steps: [
      {
        type: 'schedule_followup',
        config: {
          delay_value: 2,
          delay_unit: 'business_days',
          followup_rule_key: 'gary_escalation_notify'
        }
      }
    ]
  },
  {
    key: 'gary_return_visit',
    title: 'Gary Return Visit SMS',
    description: 'SMS to trade for return visit scheduling',
    time_mode: 'send_window',
    steps: [
      {
        type: 'schedule_followup',
        config: {
          delay_value: 1,
          delay_unit: 'calendar_days',
          followup_rule_key: 'gary_return_visit_send'
        }
      }
    ]
  },
  {
    key: 'inspection_booking_sms',
    title: 'Inspection Booking SMS',
    description: 'SMS to insured for inspection booking proposal',
    time_mode: 'waking_hours',
    steps: [
      {
        type: 'send_sms',
        config: {
          template_key: 'sms_inspection_booking_proposal',
          to: 'insured'
        }
      }
    ]
  },
  {
    key: 'homeowner_acknowledgement',
    title: 'Homeowner Acknowledgement SMS',
    description: 'SMS acknowledgement to homeowner',
    time_mode: 'waking_hours',
    steps: [
      {
        type: 'send_sms',
        config: {
          template_key: 'sms_homeowner_acknowledgement',
          to: 'insured'
        }
      }
    ]
  },
  {
    key: 'homeowner_followup',
    title: 'Homeowner Follow-up',
    description: 'Follow-up SMS to homeowner after initial contact',
    time_mode: 'waking_hours',
    steps: [
      {
        type: 'schedule_followup',
        config: {
          delay_value: 1,
          delay_unit: 'calendar_days',
          followup_rule_key: 'homeowner_followup_send'
        }
      }
    ]
  },
  {
    key: 'internal_notify',
    title: 'Internal Notification',
    description: 'Internal notification for team',
    time_mode: 'business_hours',
    steps: [
      {
        type: 'notify_internal',
        config: {
          message: 'New job requires attention'
        }
      }
    ]
  },
  {
    key: 'action_queue_card',
    title: 'Action Queue Card Creation',
    description: 'Create action queue card for manual review',
    time_mode: 'business_hours',
    steps: [
      {
        type: 'create_action_card',
        config: {
          title: 'Review Required',
          description: 'Job requires manual review',
          priority: 'medium'
        }
      }
    ]
  },
  {
    key: 'quote_approved',
    title: 'Quote Approved Notification',
    description: 'Notification when quote is approved',
    time_mode: 'business_hours',
    steps: [
      {
        type: 'notify_internal',
        config: {
          message: 'Quote approved - proceed with works'
        }
      }
    ]
  },
  {
    key: 'blueprint_draft',
    title: 'Blueprint Draft Notification',
    description: 'Notification when schedule blueprint draft is ready',
    time_mode: 'business_hours',
    steps: [
      {
        type: 'notify_internal',
        config: {
          message: 'Schedule blueprint draft ready for review'
        }
      }
    ]
  }
]

export function getAutomationRule(key: string): AutomationRule | undefined {
  return automationRules.find(rule => rule.key === key)
}
