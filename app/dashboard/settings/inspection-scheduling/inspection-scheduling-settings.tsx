'use client'

import { useState, useEffect } from 'react'
import { HelpCircle } from 'lucide-react'
import type { InspectionSchedulingRules } from '@/lib/scheduling/inspection-rules.types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

function LabelWithTooltip({ children, tooltip }: { children: React.ReactNode; tooltip: string }) {
  return (
    <div className="flex items-center gap-2">
      <Label>{children}</Label>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="w-4 h-4 text-[#6b6763] cursor-help" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

interface InspectionSchedulingSettingsProps {
  tenantId: string
}

export default function InspectionSchedulingSettings({ tenantId }: InspectionSchedulingSettingsProps) {
  const [rules, setRules] = useState<InspectionSchedulingRules | null>(null)
  const [initialRules, setInitialRules] = useState<InspectionSchedulingRules | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Load rules
  useEffect(() => {
    async function loadRules() {
      try {
        const response = await fetch('/api/settings/inspection-scheduling')
        if (!response.ok) throw new Error('Failed to load rules')
        
        const data = await response.json()
        setRules(data)
        setInitialRules(data)
      } catch (error) {
        console.error('Error loading rules:', error)
      } finally {
        setLoading(false)
      }
    }
    loadRules()
  }, [])

  // Track unsaved changes
  useEffect(() => {
    if (initialRules && rules) {
      setHasUnsavedChanges(JSON.stringify(rules) !== JSON.stringify(initialRules))
    }
  }, [rules, initialRules])

  const handleSave = async () => {
    if (!rules) return

    setSaving(true)
    try {
      const response = await fetch('/api/settings/inspection-scheduling', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      })

      if (!response.ok) throw new Error('Failed to save rules')

      const data = await response.json()
      setRules(data)
      setInitialRules(data)
      setHasUnsavedChanges(false)
    } catch (error) {
      console.error('Error saving rules:', error)
      alert('Failed to save rules. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const updateRule = <K extends keyof InspectionSchedulingRules>(key: K, value: InspectionSchedulingRules[K]) => {
    setRules(prev => prev ? { ...prev, [key]: value } : null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-[#6b6763]">Loading...</div>
      </div>
    )
  }

  if (!rules) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-[#6b6763]">Failed to load settings</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] pb-24">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-[#1a1a1a] mb-2">Inspection Scheduling</h1>
          <p className="text-[#6b6763]">Rules applied when the auto-scheduler proposes inspection runs.</p>
        </div>

        <Accordion type="multiple" defaultValue={['mode-capacity']} className="space-y-4">
          {/* Section 1: Mode & Capacity */}
          <AccordionItem value="mode-capacity" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Mode & Capacity</CardTitle>
                    <CardDescription className="mt-1">
                      Controls whether the system holds jobs for clustering or schedules them immediately.
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <LabelWithTooltip tooltip="Controls how jobs are batched and scheduled. Quiet mode holds jobs for clustering, Busy mode schedules immediately, CAT Event maximizes throughput, Manual disables auto-scheduling.">Scheduling Mode</LabelWithTooltip>
                    <Select
                      value={rules.scheduling_mode}
                      onValueChange={(value: any) => updateRule('scheduling_mode', value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quiet">Quiet</SelectItem>
                        <SelectItem value="busy">Busy</SelectItem>
                        <SelectItem value="cat_event">CAT Event</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-[#6b6763]">
                      {rules.scheduling_mode === 'quiet' && 'Hold jobs until a cluster forms or the hold period expires. Best for low-volume periods.'}
                      {rules.scheduling_mode === 'busy' && 'Schedule immediately if the job is within the busy radius of an existing run job.'}
                      {rules.scheduling_mode === 'cat_event' && 'Zone and cluster rules suspended. Maximise daily throughput.'}
                      {rules.scheduling_mode === 'manual' && 'No automatic scheduling. Human assigns all inspections manually.'}
                    </p>
                  </div>

                  {rules.scheduling_mode === 'cat_event' && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
                      <p className="text-sm text-amber-800">
                        ⚠️ CAT Event mode is active. Zone-day and cluster rules are suspended.
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <LabelWithTooltip tooltip="When enabled, automatically switches to CAT Event mode and suspends zone-day and cluster rules to maximise throughput during high-volume events.">CAT Event Active</LabelWithTooltip>
                    </div>
                    <Switch
                      checked={rules.cat_event_active}
                      onCheckedChange={(checked) => updateRule('cat_event_active', checked)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Number of pending jobs that triggers automatic switch from Quiet to Busy mode. Set to 0 to disable auto-switching.">Auto-switch Threshold</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.auto_mode_trigger_count}
                          onChange={(e) => updateRule('auto_mode_trigger_count', parseInt(e.target.value) || 0)}
                        />
                        <span className="text-sm text-[#6b6763]">jobs</span>
                      </div>
                      <p className="text-xs text-[#6b6763]">Set to 0 to disable auto-switching</p>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Maximum number of inspections a single inspector can complete in one day.">Max Daily Inspections</LabelWithTooltip>
                      <Input
                        type="number"
                        min="1"
                        max="20"
                        value={rules.max_daily_inspections}
                        onChange={(e) => updateRule('max_daily_inspections', parseInt(e.target.value) || 6)}
                      />
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Additional inspection slots allowed per day beyond the normal maximum, used for urgent or nearby jobs.">Overflow Slots</LabelWithTooltip>
                      <Input
                        type="number"
                        min="0"
                        max="5"
                        value={rules.overflow_max_per_day}
                        onChange={(e) => updateRule('overflow_max_per_day', parseInt(e.target.value) || 0)}
                      />
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Maximum distance from existing jobs to qualify for overflow slot allocation.">Overflow Radius</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.overflow_radius_km}
                          onChange={(e) => updateRule('overflow_radius_km', parseFloat(e.target.value) || 5)}
                        />
                        <span className="text-sm text-[#6b6763]">km</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Maximum number of days to hold a job in Quiet mode waiting for cluster formation before forcing scheduling.">Quiet Mode Hold Period</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.quiet_mode_hold_days}
                          onChange={(e) => updateRule('quiet_mode_hold_days', parseInt(e.target.value) || 3)}
                        />
                        <span className="text-sm text-[#6b6763]">days</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Radius in km within which jobs are considered close enough to existing run jobs for immediate scheduling in Busy mode.">Busy Mode Radius</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.busy_mode_radius_km}
                          onChange={(e) => updateRule('busy_mode_radius_km', parseFloat(e.target.value) || 20)}
                        />
                        <span className="text-sm text-[#6b6763]">km</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section 2: Zone & Geography */}
          <AccordionItem value="zone-geography" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Zone & Geography</CardTitle>
                    <CardDescription className="mt-1">
                      Define which areas are inspected on which days. Jobs outside preferred zone-days are held unless urgent.
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <LabelWithTooltip tooltip="Whitelist of postcodes in your service area. Jobs outside this list will not be auto-scheduled. Leave empty to accept all postcodes.">Service Area Postcodes</LabelWithTooltip>
                    <Input
                      placeholder="e.g. 6000, 6001, 6002"
                      value={rules.service_area_postcodes.join(', ')}
                      onChange={(e) => updateRule('service_area_postcodes', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    />
                    <p className="text-sm text-[#6b6763]">Leave empty to accept all postcodes</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Maximum distance in km for a job to be added to an existing cluster. Jobs beyond this distance won't be grouped together.">Cluster Radius</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.cluster_radius_km}
                          onChange={(e) => updateRule('cluster_radius_km', parseFloat(e.target.value) || 15)}
                        />
                        <span className="text-sm text-[#6b6763]">km</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Minimum number of jobs required in a cluster before it can be scheduled in Quiet mode.">Min Cluster Size</LabelWithTooltip>
                      <Input
                        type="number"
                        min="1"
                        value={rules.min_cluster_size}
                        onChange={(e) => updateRule('min_cluster_size', parseInt(e.target.value) || 2)}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <LabelWithTooltip tooltip="When enabled, a single confirmed job in a zone opens that zone for the day, allowing other jobs in that zone to be scheduled.">Anchor Job Logic</LabelWithTooltip>
                    </div>
                    <Switch
                      checked={rules.anchor_job_enabled}
                      onCheckedChange={(checked) => updateRule('anchor_job_enabled', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <LabelWithTooltip tooltip="When enabled, jobs at the same address or complex will always be scheduled on the same run, regardless of other constraints.">Same Address Always Together</LabelWithTooltip>
                    </div>
                    <Switch
                      checked={rules.same_address_always_together}
                      onCheckedChange={(checked) => updateRule('same_address_always_together', checked)}
                    />
                  </div>

                  <div className="p-4 bg-[#f5f2ee] rounded-md">
                    <p className="text-sm font-medium mb-2">Zone-Day Rules</p>
                    <p className="text-sm text-[#6b6763] mb-2">Define named zones, their postcodes, and which days of the week they are scheduled.</p>
                    <p className="text-xs text-[#6b6763]">Zone configuration UI coming in next update. Currently configured via API.</p>
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section 3: Urgency & Priority */}
          <AccordionItem value="urgency-priority" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Urgency & Priority</CardTitle>
                    <CardDescription className="mt-1">
                      Rules that override batching and clustering when jobs are time-critical.
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Jobs within this many hours of breaching their KPI visit deadline will jump the queue and be scheduled immediately, bypassing normal batching rules.">KPI Breach Override</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.kpi_override_hours}
                          onChange={(e) => updateRule('kpi_override_hours', parseFloat(e.target.value) || 8)}
                        />
                        <span className="text-sm text-[#6b6763]">hours</span>
                      </div>
                      <p className="text-xs text-[#6b6763]">Jump the queue when a job is within X hours of its KPI visit deadline</p>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Jobs that have been unscheduled for this many days will receive priority weighting regardless of location, helping prevent long-standing jobs from being held indefinitely.">Days Since Lodged Escalation</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.days_since_lodged_escalation}
                          onChange={(e) => updateRule('days_since_lodged_escalation', parseInt(e.target.value) || 3)}
                        />
                        <span className="text-sm text-[#6b6763]">days</span>
                      </div>
                      <p className="text-xs text-[#6b6763]">Escalate priority after a job has been unscheduled for X days</p>
                    </div>
                  </div>

                  <div className="p-4 bg-[#f5f2ee] rounded-md">
                    <p className="text-sm font-medium mb-2">Insurer-Specific SLA Rules</p>
                    <p className="text-sm text-[#6b6763] mb-2">Override scheduling priority for specific insurers.</p>
                    <p className="text-xs text-[#6b6763]">Insurer SLA configuration UI coming in next update. Currently configured via API.</p>
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section 4: Time of Day */}
          <AccordionItem value="time-of-day" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Time of Day</CardTitle>
                    <CardDescription className="mt-1">
                      Controls when inspections are scheduled and how long each job type takes.
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Earliest time of day that inspections can be scheduled.">First Appointment</LabelWithTooltip>
                      <Input
                        type="time"
                        value={rules.first_appointment_time}
                        onChange={(e) => updateRule('first_appointment_time', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Latest time of day that inspections can be scheduled.">Last Appointment</LabelWithTooltip>
                      <Input
                        type="time"
                        value={rules.last_appointment_time}
                        onChange={(e) => updateRule('last_appointment_time', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Travel and buffer time between consecutive inspections to ensure inspectors can arrive on time.">Buffer Between Inspections</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.inspection_buffer_minutes}
                          onChange={(e) => updateRule('inspection_buffer_minutes', parseInt(e.target.value) || 30)}
                        />
                        <span className="text-sm text-[#6b6763]">minutes</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Additional time allocated for inspections involving vulnerable persons to allow for extra care and communication.">Vulnerable Person Extra Time</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.vulnerable_person_extra_minutes}
                          onChange={(e) => updateRule('vulnerable_person_extra_minutes', parseInt(e.target.value) || 15)}
                        />
                        <span className="text-sm text-[#6b6763]">minutes</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <LabelWithTooltip tooltip="When enabled, complex job types (BAR+Make Safe, Roof Report, Specialist) are preferred for morning appointment slots.">Morning Preference for Complex Jobs</LabelWithTooltip>
                      </div>
                      <Switch
                        checked={rules.morning_complex_jobs}
                        onCheckedChange={(checked) => updateRule('morning_complex_jobs', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <LabelWithTooltip tooltip="When enabled, standard BAR inspections are preferred for afternoon appointment slots.">Afternoon Preference for Simple Jobs</LabelWithTooltip>
                      </div>
                      <Switch
                        checked={rules.afternoon_simple_jobs}
                        onCheckedChange={(checked) => updateRule('afternoon_simple_jobs', checked)}
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-[#f5f2ee] rounded-md">
                    <p className="text-sm font-medium mb-2">Peak Hour Traffic Rules</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <LabelWithTooltip tooltip="When enabled, the scheduler will avoid scheduling jobs during peak traffic hours in CBD areas to minimise travel delays.">Enable peak hour avoidance</LabelWithTooltip>
                        <Switch
                          checked={rules.peak_hour_config.enabled}
                          onCheckedChange={(checked) => updateRule('peak_hour_config', { ...rules.peak_hour_config, enabled: checked })}
                        />
                      </div>
                      <p className="text-xs text-[#6b6763]">Full peak hour configuration UI coming in next update. Currently configured via API.</p>
                    </div>
                  </div>

                  <div className="p-4 bg-[#f5f2ee] rounded-md">
                    <p className="text-sm font-medium mb-2">Inspection Time Blocks</p>
                    <p className="text-sm text-[#6b6763] mb-2">Estimated duration per job type. Used to build the daily run schedule.</p>
                    <p className="text-xs text-[#6b6763]">Job type duration configuration UI coming in next update. Currently configured via API.</p>
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section 5: Insured Constraints */}
          <AccordionItem value="insured-constraints" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Insured Constraints</CardTitle>
                    <CardDescription className="mt-1">
                      Rules for handling insured availability and access constraints.
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <LabelWithTooltip tooltip="When enabled, the system will parse insured availability preferences from SMS replies and use them to schedule inspections at preferred times.">Capture Availability from SMS</LabelWithTooltip>
                      </div>
                      <Switch
                        checked={rules.capture_availability_from_sms}
                        onCheckedChange={(checked) => updateRule('capture_availability_from_sms', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <LabelWithTooltip tooltip="When enabled, jobs with access constraints (e.g. keys required, restricted access) will not be auto-scheduled and require manual assignment.">Access Constraint Block</LabelWithTooltip>
                      </div>
                      <Switch
                        checked={rules.access_constraint_block}
                        onCheckedChange={(checked) => updateRule('access_constraint_block', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <LabelWithTooltip tooltip="When enabled, jobs involving vulnerable persons will be preferred for morning appointment slots.">Vulnerable Person Morning Preference</LabelWithTooltip>
                      </div>
                      <Switch
                        checked={rules.vulnerable_person_morning_preference}
                        onCheckedChange={(checked) => updateRule('vulnerable_person_morning_preference', checked)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="After this many reschedule attempts, the system will flag the job for phone call follow-up instead of continuing SMS-based scheduling.">Repeat Reschedule Threshold</LabelWithTooltip>
                      <Input
                        type="number"
                        min="0"
                        value={rules.repeat_reschedule_threshold}
                        onChange={(e) => updateRule('repeat_reschedule_threshold', parseInt(e.target.value) || 2)}
                      />
                      <p className="text-xs text-[#6b6763]">After this many cancellations, flag for phone call instead of SMS</p>
                    </div>
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section 6: Hold & Batching */}
          <AccordionItem value="hold-batching" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Hold & Batching</CardTitle>
                    <CardDescription className="mt-1">
                      Controls how long jobs are held before scheduling and CAT event detection.
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Hold window after a new order arrives before the scheduler considers it for scheduling. Allows time for clustering.">New Order Hold Minutes</LabelWithTooltip>
                      <Input
                        type="number"
                        min="0"
                        value={rules.new_order_hold_minutes}
                        onChange={(e) => updateRule('new_order_hold_minutes', parseInt(e.target.value) || 30)}
                      />
                      <p className="text-xs text-[#6b6763]">Hold window after new order arrives before scheduling</p>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Number of orders from the same postcode cluster required to trigger automatic CAT Event mode.">CAT Cluster Order Count</LabelWithTooltip>
                      <Input
                        type="number"
                        min="0"
                        value={rules.cat_cluster_order_count}
                        onChange={(e) => updateRule('cat_cluster_order_count', parseInt(e.target.value) || 5)}
                      />
                      <p className="text-xs text-[#6b6763]">Orders from same postcode cluster to trigger CAT mode</p>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Time window in hours for detecting postcode clusters that trigger CAT Event mode.">CAT Cluster Window Hours</LabelWithTooltip>
                      <Input
                        type="number"
                        min="0"
                        value={rules.cat_cluster_window_hours}
                        onChange={(e) => updateRule('cat_cluster_window_hours', parseInt(e.target.value) || 2)}
                      />
                      <p className="text-xs text-[#6b6763]">Time window for CAT cluster detection</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <LabelWithTooltip tooltip="When enabled, jobs from the same claim that haven't been linked yet will be held until they are linked, allowing them to be scheduled together.">Same Claim Hold Enabled</LabelWithTooltip>
                    </div>
                    <Switch
                      checked={rules.same_claim_hold_enabled}
                      onCheckedChange={(checked) => updateRule('same_claim_hold_enabled', checked)}
                    />
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section 7: Operational Efficiency */}
          <AccordionItem value="operational-efficiency" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Operational Efficiency</CardTitle>
                    <CardDescription className="mt-1">
                      Confirmation thresholds and arrival window settings.
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Minimum percentage of insureds who must confirm their appointment before the run is locked and finalised.">Confirmation Threshold %</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={rules.confirmation_threshold_pct}
                          onChange={(e) => updateRule('confirmation_threshold_pct', parseInt(e.target.value) || 60)}
                        />
                        <span className="text-sm text-[#6b6763]">%</span>
                      </div>
                      <p className="text-xs text-[#6b6763]">Lock and finalise run only once this % of insureds have confirmed</p>
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Width of the arrival time window communicated to insureds (e.g., 120 minutes means 'between 9am and 11am').">Arrival Window Minutes</LabelWithTooltip>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={rules.arrival_window_minutes}
                          onChange={(e) => updateRule('arrival_window_minutes', parseInt(e.target.value) || 120)}
                        />
                        <span className="text-sm text-[#6b6763]">minutes</span>
                      </div>
                      <p className="text-xs text-[#6b6763]">Width of arrival window communicated to insured</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <LabelWithTooltip tooltip="When enabled, insureds will receive an SMS on the morning of their inspection with their specific arrival time window.">Arrival Window SMS Enabled</LabelWithTooltip>
                    </div>
                    <Switch
                      checked={rules.arrival_window_sms_enabled}
                      onCheckedChange={(checked) => updateRule('arrival_window_sms_enabled', checked)}
                    />
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section 8: Inspector Configuration */}
          <AccordionItem value="inspector-config" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Inspectors</CardTitle>
                    <CardDescription className="mt-1">
                      Per-inspector scheduling rules, availability windows, and home base.
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent>
                  <div className="p-4 bg-[#f5f2ee] rounded-md">
                    <p className="text-sm font-medium mb-2">Inspector Configuration</p>
                    <p className="text-sm text-[#6b6763] mb-2">Configure per-inspector rules, availability windows, and home base.</p>
                    <p className="text-xs text-[#6b6763]">Inspector configuration UI coming in next update. Currently configured via API.</p>
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Fixed save button */}
      <div className="fixed bottom-6 right-6 flex items-center gap-3">
        {hasUnsavedChanges && (
          <span className="text-sm text-[#6b6763]">Unsaved changes</span>
        )}
        <Button
          onClick={handleSave}
          disabled={!hasUnsavedChanges || saving}
          className="bg-[#1a1a1a] text-white hover:bg-[#2a2a2a]"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
