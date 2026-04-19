import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { tenantId, item } = body

    if (!tenantId || !item) {
      return NextResponse.json({ error: 'Missing tenantId or item' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Check if item already exists in scope library
    const { data: existing } = await supabase
      .from('scope_library')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('trade', item.trade)
      .eq('item_description', item.item_description)
      .eq('unit', item.unit)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Item already exists in scope library' }, { status: 409 })
    }

    // Insert new item with pending approval status
    const labourPerUnit = item.rate_labour || null;
    const materialsPerUnit = item.rate_materials || null;
    const labourRatePerHour = item.labour_rate_per_hour || null;
    const totalPerUnit = (labourPerUnit || 0) + (materialsPerUnit || 0);
    
    // Calculate estimated_hours if labour_rate_per_hour is provided
    let estimatedHours = null;
    if (labourPerUnit !== null && labourRatePerHour !== null && labourRatePerHour > 0) {
      estimatedHours = labourPerUnit / labourRatePerHour;
    }

    const { data, error } = await supabase
      .from('scope_library')
      .insert({
        tenant_id: tenantId,
        trade: item.trade || null,
        keyword: item.keyword || null,
        item_description: item.item_description || null,
        unit: item.unit || null,
        labour_rate_per_hour: labourRatePerHour,
        labour_per_unit: labourPerUnit,
        materials_per_unit: materialsPerUnit,
        total_per_unit: totalPerUnit,
        estimated_hours: estimatedHours,
        estimated_hours_overridden: false,
        insurer_specific: null,
        approval_status: 'pending',
        updated_at: new Date().toISOString(),
      } as any)
      .select('id')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ id: data.id, approval_status: 'pending' })
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
