import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TeachSavePayload } from '@/types/brain'

export const dynamic = 'force-dynamic'

function formatContent(payload: TeachSavePayload): string {
  const { structured } = payload
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
    // Link dictation as an additional example to an existing brain entry
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

  // 'new' or 'variant' — create a brain entry + playbook
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

  // Create the playbook (stores name + tenant; structured content lives in brain_entry)
  const { data: playbook, error: pbErr } = await supabase
    .from('playbooks')
    .insert({
      tenant_id: tenantId,
      name: structured.title,
    })
    .select('id')
    .single()

  if (pbErr) {
    return NextResponse.json({ error: pbErr.message }, { status: 500 })
  }

  return NextResponse.json({ brainEntryId: entry.id, playbookId: playbook.id })
}
