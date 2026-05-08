import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

interface ScopeRoom {
  room: string
  l: string
  w: string
  h: string
  items: string[]
}

interface ScopeItem {
  room: string
  trade: string
  keyword: string
  item_description: string
  qty: number | null
  unit: string
}

async function parseScopeWithAI(scopeRooms: ScopeRoom[], jobContext: { insurer: string; lossType: string }): Promise<ScopeItem[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const scopeText = scopeRooms.map(r => {
    const dims = [r.l, r.w, r.h].filter(Boolean).join('×')
    const dimStr = dims ? ` (${dims}m)` : ''
    const items = r.items.filter(Boolean).map(i => `  - ${i}`).join('\n')
    return `${r.room || 'General'}${dimStr}:\n${items || '  (no items)'}`
  }).join('\n\n')

  const prompt = `You are a building insurance scope parser. Parse the following field inspection scope notes into structured scope items.

Job Context:
- Insurer: ${jobContext.insurer || 'Unknown'}
- Loss Type: ${jobContext.lossType || 'Unknown'}

Scope Notes:
${scopeText}

Return a JSON array of scope items. Each item must have:
- room: room name from the notes
- trade: trade category (e.g. "Carpentry", "Painting", "Tiling", "Plumbing", "Electrical", "Roofing", "Plastering", "Flooring", "General")
- keyword: short keyword (e.g. "replace-ceiling", "paint-walls", "replace-tiles")
- item_description: clear, professional description of the work
- qty: quantity as a number (null if not determinable)
- unit: unit of measure (e.g. "m2", "lm", "ea", "hrs", "m3") or null

Rules:
- One entry per scope item
- If an item mentions dimensions from the room (L×W), calculate m2 for area items
- Use professional trade terminology
- Return ONLY the JSON array, no other text

Example:
[{"room":"Living Room","trade":"Plastering","keyword":"replace-ceiling","item_description":"Supply and replace water-damaged plasterboard ceiling lining","qty":24,"unit":"m2"}]`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0]?.type === 'text' ? message.content[0].text : '[]'
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []

  try {
    return JSON.parse(match[0]) as ScopeItem[]
  } catch {
    return []
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params
  const body = await req.json()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id, name')
    .eq('id', user.id)
    .single()
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const tenantId = userRow.tenant_id

  const { data: insp } = await service
    .from('inspections')
    .select('id, job_id, quote_id, status')
    .eq('id', inspectionId)
    .eq('tenant_id', tenantId)
    .single()
  if (!insp) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

  const {
    personMet,
    safetyData,
    scopeRooms,
    reportNotes,
    propDesc,
    photoContext,
    insurer,
    lossType,
  }: {
    personMet: string
    safetyData: {
      general: boolean
      ppe: boolean
      asbestos: boolean
      structural: boolean
      roofPower: boolean
      weather: boolean
      customNotes: string
      hospitalName: string
      signedBy: string
    }
    scopeRooms: ScopeRoom[]
    reportNotes: string
    propDesc: string
    photoContext: string
    insurer: string
    lossType: string
  } = body

  const now = new Date().toISOString()

  // 1. Save safety record
  await service.from('safety_records').insert({
    tenant_id: tenantId,
    job_id: insp.job_id,
    inspection_id: inspectionId,
    inspector_id: user.id,
    date: now.split('T')[0],
    confirmed_at: now,
    structural_ok: safetyData?.structural ?? false,
    ppe_confirmed: safetyData?.ppe ?? false,
    asbestos_risk: !(safetyData?.asbestos ?? false),
    roof_access: safetyData?.roofPower ?? false,
    nearest_hospital: safetyData?.hospitalName ?? null,
    custom_notes: safetyData?.customNotes ?? null,
    signed_by: safetyData?.signedBy ?? personMet ?? null,
    status: 'confirmed',
    type: 'field_inspection',
  })

  // 2. Update inspection record
  await service.from('inspections').update({
    status: 'submitted',
    form_submitted_at: now,
    safety_confirmed_at: safetyData ? now : null,
    person_met: personMet ?? null,
    notes: reportNotes ?? null,
    field_draft: null, // clear draft on submit
  }).eq('id', inspectionId).eq('tenant_id', tenantId)

  // 3. Parse and write scope items if quote exists
  let parsedCount = 0
  if (insp.quote_id && scopeRooms && scopeRooms.length > 0) {
    const validRooms = scopeRooms.filter(r => r.items && r.items.some(i => i.trim()))
    if (validRooms.length > 0) {
      try {
        const parsedItems = await parseScopeWithAI(validRooms, { insurer, lossType })

        if (parsedItems.length > 0) {
          // Get current max sort order
          const { data: maxSort } = await service
            .from('scope_items')
            .select('sort_order')
            .eq('quote_id', insp.quote_id)
            .eq('tenant_id', tenantId)
            .order('sort_order', { ascending: false })
            .limit(1)
            .maybeSingle()

          let sortOrder = (maxSort?.sort_order ?? 0) + 1

          const inserts = parsedItems.map(item => ({
            tenant_id: tenantId,
            quote_id: insp.quote_id as string,
            room: item.room || null,
            trade: item.trade || null,
            keyword: item.keyword || null,
            item_description: item.item_description || null,
            qty: item.qty ?? null,
            unit: item.unit || null,
            is_custom: true,
            approval_status: 'pending',
            sort_order: sortOrder++,
          }))

          const { error: insertErr } = await service.from('scope_items').insert(inserts)
          if (!insertErr) parsedCount = inserts.length
        }
      } catch (e) {
        console.error('Scope parse error:', e)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    submittedAt: now,
    scopeItemsCreated: parsedCount,
  })
}
