import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BrainEntryCategory, BrainEntryPersona } from '@/types/brain'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    text: string
    persona: string
    category: string
    tenantId: string
  }

  const { text, persona, category, tenantId } = body

  if (!text?.trim() || !tenantId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const validCategories: BrainEntryCategory[] = [
    'rule', 'workflow', 'tone', 'classification', 'example', 'correction', 'entity-definition',
  ]
  const validPersonas: BrainEntryPersona[] = ['gary', 'client-comms', 'internal']

  const resolvedCategory: BrainEntryCategory = validCategories.includes(category as BrainEntryCategory)
    ? (category as BrainEntryCategory)
    : 'rule'

  const resolvedPersona: BrainEntryPersona | null = validPersonas.includes(persona as BrainEntryPersona)
    ? (persona as BrainEntryPersona)
    : null

  const { data, error } = await supabase
    .from('brain_entries')
    .insert({
      tenant_id: tenantId,
      title: text.slice(0, 120).trim(),
      content: text.trim(),
      category: resolvedCategory,
      persona: resolvedPersona,
      source_type: 'manual',
      status: 'draft',
      confidence: 'medium',
      prompt_keys: [],
      tags: [],
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id: data.id })
}
