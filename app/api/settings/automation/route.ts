import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'

interface PublicHoliday {
  date: string
  label: string
}

interface AutomationConfig {
  business_hours_start: string
  business_hours_end: string
  business_days: number[]
  public_holidays: PublicHoliday[]
  waking_hours_start: string
  waking_hours_end: string
  urgent_hours_start: string
  urgent_hours_end: string
  urgent_all_days: boolean
  gary_send_window_start: string
  gary_send_window_end: string
  gary_send_window_tz: string
}

export async function GET(req: NextRequest) {
  try {
    const userSession = await getUser()

    if (!userSession || !userSession.tenant_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = userSession.tenant_id
    const supabase = createServiceClient()

    // Load automation_config
    const { data: configData, error: configError } = await supabase
      .from('automation_config')
      .select('key, value')
      .eq('tenant_id', tenantId)

    if (configError) {
      return NextResponse.json({ error: 'Failed to load config' }, { status: 500 })
    }

    const rawConfig: Record<string, string> = {}
    configData?.forEach(row => {
      rawConfig[row.key] = row.value
    })

    // Parse business_days
    const parseBusinessDays = (value: string | undefined): number[] => {
      if (!value) return [1, 2, 3, 4, 5]
      return value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    }

    // Parse public_holidays
    const parsePublicHolidays = (value: string | undefined): PublicHoliday[] => {
      if (!value) return []
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }

    const config: AutomationConfig = {
      business_hours_start: rawConfig.business_hours_start || '07:00',
      business_hours_end: rawConfig.business_hours_end || '17:30',
      business_days: parseBusinessDays(rawConfig.business_days),
      public_holidays: parsePublicHolidays(rawConfig.public_holidays),
      waking_hours_start: rawConfig.waking_hours_start || '07:00',
      waking_hours_end: rawConfig.waking_hours_end || '20:00',
      urgent_hours_start: rawConfig.urgent_hours_start || '05:00',
      urgent_hours_end: rawConfig.urgent_hours_end || '22:00',
      urgent_all_days: rawConfig.urgent_all_days === 'true',
      gary_send_window_start: rawConfig.gary_send_window_start || '06:00',
      gary_send_window_end: rawConfig.gary_send_window_end || '19:00',
      gary_send_window_tz: rawConfig.gary_send_window_tz || 'Australia/Perth',
    }

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error loading automation config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userSession = await getUser()

    if (!userSession || !userSession.tenant_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = userSession.tenant_id
    const supabase = createServiceClient()
    const config: AutomationConfig = await req.json()

    // Helper to update or insert config value
    const upsertConfig = async (key: string, value: string) => {
      const { error } = await supabase
        .from('automation_config')
        .upsert({
          tenant_id: tenantId,
          key,
          value,
        }, {
          onConflict: 'tenant_id,key'
        })
      return error
    }

    // Update all config values
    const errors = await Promise.all([
      upsertConfig('business_hours_start', config.business_hours_start),
      upsertConfig('business_hours_end', config.business_hours_end),
      upsertConfig('business_days', config.business_days.join(',')),
      upsertConfig('public_holidays', JSON.stringify(config.public_holidays)),
      upsertConfig('waking_hours_start', config.waking_hours_start),
      upsertConfig('waking_hours_end', config.waking_hours_end),
      upsertConfig('urgent_hours_start', config.urgent_hours_start),
      upsertConfig('urgent_hours_end', config.urgent_hours_end),
      upsertConfig('urgent_all_days', config.urgent_all_days.toString()),
      upsertConfig('gary_send_window_start', config.gary_send_window_start),
      upsertConfig('gary_send_window_end', config.gary_send_window_end),
      upsertConfig('gary_send_window_tz', config.gary_send_window_tz),
    ])

    const actualErrors = errors.filter(e => e !== null)
    if (actualErrors.length > 0) {
      console.error('Errors updating config:', actualErrors)
      return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
    }

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error saving automation config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
