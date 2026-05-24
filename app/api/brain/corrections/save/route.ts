import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { CorrectionSavePayload } from '@/types/brain'

export const dynamic = 'force-dynamic'

function reviewDueAt(): string {
  const d = new Date()
  d.setDate(d.getDate() + 90)
  return d.toISOString()
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

interface AiAuditUpdate {
  was_edited: boolean
  outcome: string
  edited_by: string
  edited_at: string
}

interface AiAuditClient {
  from(table: 'ai_audit'): {
    update(data: AiAuditUpdate): {
      eq(col: string, val: string): Promise<{ error: { message: string } | null }>
    }
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'No tenant' }, { status: 401 })
  const tenantId = (profile as { tenant_id: string }).tenant_id

  const body = (await req.json()) as CorrectionSavePayload
  const { fieldName, before, after, sourceType, playbookRunId, aiAuditId, detectedAt } = body

  const sourceRefTable = playbookRunId
    ? 'playbook_runs'
    : aiAuditId
      ? 'ai_audit'
      : null
  const sourceRefId = playbookRunId ?? aiAuditId ?? null

  const content = [
    `Field: ${fieldName}`,
    `Was generated as: ${stringify(before)}`,
    `Corrected to: ${stringify(after)}`,
    `Source: ${sourceType} (${playbookRunId ?? aiAuditId ?? 'unknown'})`,
  ].join('\n')

  const { data: entry, error: entryErr } = await supabase
    .from('brain_entries')
    .insert({
      tenant_id: tenantId,
      category: 'correction',
      source_type: 'correction',
      source_ref_table: sourceRefTable,
      source_ref_id: sourceRefId,
      status: 'approved',
      confidence: 'high',
      content,
      title: `Correction: ${fieldName} on ${sourceType} output`,
      tags: ['correction', sourceType, fieldName],
      prompt_keys: [],
      review_due_at: reviewDueAt(),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (entryErr) {
    return NextResponse.json({ error: entryErr.message }, { status: 500 })
  }

  if (aiAuditId) {
    // ai_audit is not in generated database types; cast through a typed interface
    const auditClient = supabase as unknown as AiAuditClient
    await auditClient.from('ai_audit').update({
      was_edited: true,
      outcome: 'edited',
      edited_by: user.id,
      edited_at: detectedAt,
    }).eq('id', aiAuditId)
  }

  return NextResponse.json({ success: true, brainEntryId: entry.id })
}
