'use client'

import { useState, useEffect } from 'react'
import { getUser } from '@/lib/supabase/get-user'
import type { InspectionSchedulingRules } from '@/lib/scheduling/inspection-rules.types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

export default function InspectionSchedulingPage() {
  const [rules, setRules] = useState<InspectionSchedulingRules | null>(null)
  const [initialRules, setInitialRules] = useState<InspectionSchedulingRules | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [userSession, setUserSession] = useState<any>(null)

  // Auth bootstrap
  useEffect(() => {
    async function loadUser() {
      const session = await getUser()
      if (!session || !session.tenant_id) {
        window.location.href = '/login'
        return
      }
      setUserSession(session)
    }
    loadUser()
  }, [])

  // Load rules after auth
  useEffect(() => {
    async function loadRules() {
      if (!userSession?.tenant_id) return

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
  }, [userSession])

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
                    <Label>Scheduling Mode</Label>
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
                      <Label>CAT Event Active</Label>
                      <p className="text-sm text-[#6b6763]">When on, zone-day and cluster rules are suspended</p>
                    </div>
                    <Switch
                      checked={rules.cat_event_active}
                      onCheckedChange={(checked) => updateRule('cat_event_active', checked)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Auto-switch Threshold</Label>
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
                      <Label>Max Daily Inspections</Label>
                      <Input
                        type="number"
                        min="1"
                        max="20"
                        value={rules.max_daily_inspections}
                        onChange={(e) => updateRule('max_daily_inspections', parseInt(e.target.value) || 6)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Overflow Slots</Label>
                      <Input
                        type="number"
                        min="0"
                        max="5"
                        value={rules.overflow_max_per_day}
                        onChange={(e) => updateRule('overflow_max_per_day', parseInt(e.target.value) || 0)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Overflow Radius</Label>
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
                      <Label>Quiet Mode Hold Period</Label>
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
                      <Label>Busy Mode Radius</Label>
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
                    <Label>Service Area Postcodes</Label>
                    <Input
                      placeholder="e.g. 6000, 6001, 6002"
                      value={rules.service_area_postcodes.join(', ')}
                      onChange={(e) => updateRule('service_area_postcodes', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    />
                    <p className="text-sm text-[#6b6763]">Leave empty to accept all postcodes</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Cluster Radius</Label>
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
                      <Label>Min Cluster Size</Label>
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
                      <Label>Anchor Job Logic</Label>
                      <p className="text-sm text-[#6b6763]">One confirmed job in a zone opens that zone for the day</p>
                    </div>
                    <Switch
                      checked={rules.anchor_job_enabled}
                      onCheckedChange={(checked) => updateRule('anchor_job_enabled', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Same Address Always Together</Label>
                      <p className="text-sm text-[#6b6763]">Always schedule jobs at the same address or complex on the same run</p>
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
                      <Label>KPI Breach Override</Label>
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
                      <Label>Days Since Lodged Escalation</Label>
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
                      <Label>First Appointment</Label>
                      <Input
                        type="time"
                        value={rules.first_appointment_time}
                        onChange={(e) => updateRule('first_appointment_time', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Last Appointment</Label>
                      <Input
                        type="time"
                        value={rules.last_appointment_time}
                        onChange={(e) => updateRule('last_appointment_time', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Buffer Between Inspections</Label>
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
                      <Label>Vulnerable Person Extra Time</Label>
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
                        <Label>Morning Preference for Complex Jobs</Label>
                        <p className="text-sm text-[#6b6763]">Prefer morning slots for complex job types (BAR+Make Safe, Roof Report, Specialist)</p>
                      </div>
                      <Switch
                        checked={rules.morning_complex_jobs}
                        onCheckedChange={(checked) => updateRule('morning_complex_jobs', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Afternoon Preference for Simple Jobs</Label>
                        <p className="text-sm text-[#6b6763]">Prefer afternoon slots for standard BARs</p>
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
                        <Label className="text-sm">Enable peak hour avoidance</Label>
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
                        <Label>Capture Availability from SMS</Label>
                        <p className="text-sm text-[#6b6763]">Parse insured availability preferences from SMS replies</p>
                      </div>
                      <Switch
                        checked={rules.capture_availability_from_sms}
                        onCheckedChange={(checked) => updateRule('capture_availability_from_sms', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Access Constraint Block</Label>
                        <p className="text-sm text-[#6b6763]">Jobs with access constraints not auto-scheduled</p>
                      </div>
                      <Switch
                        checked={rules.access_constraint_block}
                        onCheckedChange={(checked) => updateRule('access_constraint_block', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Vulnerable Person Morning Preference</Label>
                        <p className="text-sm text-[#6b6763]">Prefer morning slot for vulnerable person jobs</p>
                      </div>
                      <Switch
                        checked={rules.vulnerable_person_morning_preference}
                        onCheckedChange={(checked) => updateRule('vulnerable_person_morning_preference', checked)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Repeat Reschedule Threshold</Label>
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
                      <Label>New Order Hold Minutes</Label>
                      <Input
                        type="number"
                        min="0"
                        value={rules.new_order_hold_minutes}
                        onChange={(e) => updateRule('new_order_hold_minutes', parseInt(e.target.value) || 30)}
                      />
                      <p className="text-xs text-[#6b6763]">Hold window after new order arrives before scheduling</p>
                    </div>

                    <div className="space-y-2">
                      <Label>CAT Cluster Order Count</Label>
                      <Input
                        type="number"
                        min="0"
                        value={rules.cat_cluster_order_count}
                        onChange={(e) => updateRule('cat_cluster_order_count', parseInt(e.target.value) || 5)}
                      />
                      <p className="text-xs text-[#6b6763]">Orders from same postcode cluster to trigger CAT mode</p>
                    </div>

                    <div className="space-y-2">
                      <Label>CAT Cluster Window Hours</Label>
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
                      <Label>Same Claim Hold Enabled</Label>
                      <p className="text-sm text-[#6b6763]">Hold multi-order same-claim jobs until linked before scheduling</p>
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
                      <Label>Confirmation Threshold %</Label>
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
                      <Label>Arrival Window Minutes</Label>
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
                      <Label>Arrival Window SMS Enabled</Label>
                      <p className="text-sm text-[#6b6763]">Send morning-of arrival window SMS to insured</p>
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
