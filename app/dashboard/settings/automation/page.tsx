'use client'

import { useState, useEffect } from 'react'
import { HelpCircle, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
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

interface BusinessDay {
  label: string
  value: number
}

const businessDays: BusinessDay[] = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 7 },
]

interface PublicHoliday {
  date: string
  label: string
}

interface AutomationConfig {
  // Business Hours
  business_hours_start: string
  business_hours_end: string
  business_days: number[]
  public_holidays: PublicHoliday[]
  
  // Waking Hours
  waking_hours_start: string
  waking_hours_end: string
  
  // Urgent Mode
  urgent_hours_start: string
  urgent_hours_end: string
  urgent_all_days: boolean
  
  // Gary Send Window
  gary_send_window_start: string
  gary_send_window_end: string
  gary_send_window_tz: string
}

interface AutomationSettingsProps {
  tenantId: string
}

export default function AutomationSettings({ tenantId }: AutomationSettingsProps) {
  const [config, setConfig] = useState<AutomationConfig | null>(null)
  const [initialConfig, setInitialConfig] = useState<AutomationConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Load config
  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch('/api/settings/automation')
        if (!response.ok) throw new Error('Failed to load config')
        
        const data = await response.json()
        setConfig(data)
        setInitialConfig(data)
      } catch (error) {
        console.error('Error loading config:', error)
      } finally {
        setLoading(false)
      }
    }
    loadConfig()
  }, [])

  // Track unsaved changes
  useEffect(() => {
    if (initialConfig && config) {
      setHasUnsavedChanges(JSON.stringify(config) !== JSON.stringify(initialConfig))
    }
  }, [config, initialConfig])

  const handleSave = async () => {
    if (!config) return

    setSaving(true)
    try {
      const response = await fetch('/api/settings/automation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (!response.ok) throw new Error('Failed to save config')

      const data = await response.json()
      setConfig(data)
      setInitialConfig(data)
      setHasUnsavedChanges(false)
    } catch (error) {
      console.error('Error saving config:', error)
      alert('Failed to save config. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const updateConfig = <K extends keyof AutomationConfig>(key: K, value: AutomationConfig[K]) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : null)
  }

  const addPublicHoliday = () => {
    setConfig(prev => prev ? {
      ...prev,
      public_holidays: [...prev.public_holidays, { date: '', label: '' }]
    } : null)
  }

  const removePublicHoliday = (index: number) => {
    setConfig(prev => prev ? {
      ...prev,
      public_holidays: prev.public_holidays.filter((_, i) => i !== index)
    } : null)
  }

  const updatePublicHoliday = (index: number, field: 'date' | 'label', value: string) => {
    setConfig(prev => prev ? {
      ...prev,
      public_holidays: prev.public_holidays.map((holiday, i) => 
        i === index ? { ...holiday, [field]: value } : holiday
      )
    } : null)
  }

  const toggleBusinessDay = (dayValue: number) => {
    setConfig(prev => prev ? {
      ...prev,
      business_days: prev.business_days.includes(dayValue)
        ? prev.business_days.filter(d => d !== dayValue)
        : [...prev.business_days, dayValue]
    } : null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-[#6b6763]">Loading...</div>
      </div>
    )
  }

  if (!config) {
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
          <h1 className="text-3xl font-semibold text-[#1a1a1a] mb-2">Automation Config</h1>
          <p className="text-[#6b6763]">Configure timing, windows, and behaviour for automated communications.</p>
        </div>

        <Accordion type="multiple" defaultValue={['business-hours', 'waking-hours', 'urgent-mode', 'gary-window']} className="space-y-4">
          {/* Section A — Business Hours */}
          <AccordionItem value="business-hours" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Business Hours</CardTitle>
                    <CardDescription className="mt-1">
                      Trade follow-up timelines and trade-facing comms delivery gating
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <p className="text-sm text-[#6b6763]">
                    Business hours control trade follow-up timelines (Gary escalation deadlines) and gate delivery of trade-facing comms. Messages generated outside these hours queue and deliver when the window reopens.
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Start of business day in 24-hour format. Used for business_hours mode delivery gating and business_days delay calculation.">Start time</LabelWithTooltip>
                      <Input
                        type="time"
                        value={config.business_hours_start}
                        onChange={(e) => updateConfig('business_hours_start', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="End of business day in 24-hour format.">End time</LabelWithTooltip>
                      <Input
                        type="time"
                        value={config.business_hours_end}
                        onChange={(e) => updateConfig('business_hours_end', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <LabelWithTooltip tooltip="Days of the week counted as business days. Messages only send within business hours on these days.">Business days</LabelWithTooltip>
                    <div className="flex gap-4 flex-wrap">
                      {businessDays.map((day) => (
                        <div key={day.value} className="flex items-center gap-2">
                          <Switch
                            id={`day-${day.value}`}
                            checked={config.business_days.includes(day.value)}
                            onCheckedChange={() => toggleBusinessDay(day.value)}
                          />
                          <Label
                            htmlFor={`day-${day.value}`}
                            className="text-sm cursor-pointer"
                          >
                            {day.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <LabelWithTooltip tooltip="Public holidays excluded from business day calculations. Add WA public holidays at the start of each calendar year.">Public holidays</LabelWithTooltip>
                    <div className="space-y-2">
                      {config.public_holidays.map((holiday, index) => (
                        <div key={index} className="flex gap-2">
                          <Input
                            type="date"
                            value={holiday.date}
                            onChange={(e) => updatePublicHoliday(index, 'date', e.target.value)}
                            className="flex-1"
                          />
                          <Input
                            placeholder="Optional label"
                            value={holiday.label}
                            onChange={(e) => updatePublicHoliday(index, 'label', e.target.value)}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => removePublicHoliday(index)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addPublicHoliday}
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add holiday
                      </Button>
                    </div>
                    <p className="text-xs text-[#6b6763]">
                      Add WA public holidays at the start of each calendar year. These days are excluded from business day calculations.
                    </p>
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section B — Waking Hours */}
          <AccordionItem value="waking-hours" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Waking Hours (Homeowner & Insured Comms)</CardTitle>
                    <CardDescription className="mt-1">
                      Delivery window for homeowner and insured SMS
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <p className="text-sm text-[#6b6763]">
                    Homeowner and insured SMS only sends within these hours, any day of the week. Outside this window, messages queue and deliver at the next opening.
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Earliest time for homeowner/insured comms. Any day of week.">Start time</LabelWithTooltip>
                      <Input
                        type="time"
                        value={config.waking_hours_start}
                        onChange={(e) => updateConfig('waking_hours_start', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Latest time for homeowner/insured comms.">End time</LabelWithTooltip>
                      <Input
                        type="time"
                        value={config.waking_hours_end}
                        onChange={(e) => updateConfig('waking_hours_end', e.target.value)}
                      />
                    </div>
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section C — Urgent Mode */}
          <AccordionItem value="urgent-mode" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Urgent Mode (Make Safe & Emergency)</CardTitle>
                    <CardDescription className="mt-1">
                      Time limits for make safe cascade and emergency dispatch
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <p className="text-sm text-[#6b6763]">
                    Make safe cascade and emergency dispatch use urgent mode. This is NOT unrestricted — the time limits below still apply to avoid genuinely unsociable hours. Adjust temporarily during CAT events if needed.
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Earliest time for urgent mode comms. Default 5am.">Start time</LabelWithTooltip>
                      <Input
                        type="time"
                        value={config.urgent_hours_start}
                        onChange={(e) => updateConfig('urgent_hours_start', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Latest time for urgent mode comms. Default 10pm.">End time</LabelWithTooltip>
                      <Input
                        type="time"
                        value={config.urgent_hours_end}
                        onChange={(e) => updateConfig('urgent_hours_end', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <LabelWithTooltip tooltip="If true urgent mode runs all 7 days. If false respects business_days setting.">Include weekends and public holidays</LabelWithTooltip>
                    </div>
                    <Switch
                      checked={config.urgent_all_days}
                      onCheckedChange={(checked) => updateConfig('urgent_all_days', checked)}
                    />
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>

          {/* Section D — Gary Send Window */}
          <AccordionItem value="gary-window" className="border-0">
            <Card>
              <CardHeader>
                <AccordionTrigger className="hover:no-underline">
                  <div className="text-left">
                    <CardTitle>Gary Send Window</CardTitle>
                    <CardDescription className="mt-1">
                      Trade-facing SMS delivery window
                    </CardDescription>
                  </div>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="Start of Gary's send window in 24-hour format.">Start time</LabelWithTooltip>
                      <Input
                        type="time"
                        value={config.gary_send_window_start}
                        onChange={(e) => updateConfig('gary_send_window_start', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <LabelWithTooltip tooltip="End of Gary's send window in 24-hour format.">End time</LabelWithTooltip>
                      <Input
                        type="time"
                        value={config.gary_send_window_end}
                        onChange={(e) => updateConfig('gary_send_window_end', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <LabelWithTooltip tooltip="Timezone for Gary's send window. All times are interpreted in this timezone.">Timezone</LabelWithTooltip>
                    <Input
                      value={config.gary_send_window_tz}
                      onChange={(e) => updateConfig('gary_send_window_tz', e.target.value)}
                      placeholder="Australia/Perth"
                    />
                  </div>

                  <p className="text-sm text-[#6b6763]">
                    Gary's send window applies to trade-facing SMS. Make safe dispatch uses Urgent Mode above, not this window.
                  </p>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>
        </Accordion>

        {/* Save Button */}
        {hasUnsavedChanges && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e8e4e0] p-4">
            <div className="max-w-4xl mx-auto flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setConfig(initialConfig)}
              >
                Discard changes
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
