import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TeachSavePayload } from '@/types/brain'
import type { Database } from '@/lib/supabase/database.types'

type PlaybookInsert = Database['public']['Tables']['playbooks']['Insert']

export const dynamic = 'force-dynamic'

function formatContent(payload: TeachSavePayload): string {
  const { structured } = payload
  if (structured.type === 'note') {
    const lines = [structured.title]
    if (structured.trigger_condition) lines.push(`Context: ${structured.trigger_condition}`)
    return lines.join('\n').trim()
  }
  const lines: string[] = [
    `Triggers when: ${structured.trigger_condition}`,
    '',
    'Steps:',
    ...structured.steps.map((s) => `${s.order}. ${s.description}`),
  ]
  if (structured.variables.length > 0) {
    lines.push('', `Variables: ${structured.variables.join(', ')}`)
  }
  return lines.join('\n').trim()
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await req.json() as TeachSavePayload
  const { structured, tenantId, saveMode = 'new', sourceRefId } = payload

  if (!structured || !tenantId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const content = formatContent(payload)

  if (saveMode === 'example') {
    const { data: exEntry, error: exErr } = await supabase
      .from('brain_entries')
      .insert({
        tenant_id: tenantId,
        title: `Example: ${structured.title}`,
        content,
        category: 'example',
        source_type: 'ai-structured',
        source_ref_table: 'brain_entries',
        source_ref_id: sourceRefId ?? null,
        status: 'approved',
        confidence: structured.confidence,
        prompt_keys: structured.prompt_keys,
        tags: structured.tags,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (exErr) {
      return NextResponse.json({ error: exErr.message }, { status: 500 })
    }

    return NextResponse.json({ brainEntryId: exEntry.id, playbookId: null })
  }

  // Create the brain entry
  const { data: entry, error: entryErr } = await supabase
    .from('brain_entries')
    .insert({
      tenant_id: tenantId,
      title: structured.title,
      content,
      category: structured.category,
      persona: null,
      source_type: 'ai-structured',
      source_ref_table: saveMode === 'variant' && sourceRefId ? 'brain_entries' : null,
      source_ref_id: saveMode === 'variant' && sourceRefId ? sourceRefId : null,
      status: 'approved',
      confidence: structured.confidence,
      prompt_keys: structured.prompt_keys,
      tags: structured.tags,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (entryErr) {
    return NextResponse.json({ error: entryErr.message }, { status: 500 })
  }

  // Skip playbook creation for note-type entries
  if (structured.type === 'note') {
    return NextResponse.json({ brainEntryId: entry.id, playbookId: null })
  }

  const stepsText = structured.steps
    .map((s) => `${s.order}. ${s.description}`)
    .join('\n')

  const playbookData = {
    tenant_id: tenantId,
    name: structured.title,
    steps: stepsText,
    trigger_keywords: structured.tags,
    description: structured.trigger_condition,
    created_by: user.id,
  } as unknown as PlaybookInsert

  const { data: playbook, error: pbErr } = await supabase
    .from('playbooks')
    .insert(playbookData)
    .select('id')
    .single()

  if (pbErr) {
    return NextResponse.json({ error: pbErr.message }, { status: 500 })
  }

  return NextResponse.json({ brainEntryId: entry.id, playbookId: playbook.id })
}
