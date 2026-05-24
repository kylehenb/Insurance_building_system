import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SimilarityMatch } from '@/types/brain'

export const dynamic = 'force-dynamic'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'from',
  'by', 'as', 'if', 'then', 'when', 'where', 'how', 'what', 'which', 'who',
])

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  )
}

function wordOverlap(aWords: Set<string>, bWords: Set<string>): number {
  let count = 0
  for (const w of aWords) {
    if (bWords.has(w)) count++
  }
  return count
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    title: string
    trigger_condition: string
    tags: string[]
    tenantId: string
  }

  const { title, trigger_condition, tags, tenantId } = body

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

  // Build the new entry's word set from title + tags (not trigger — too many common words)
  const newText = [title, ...(tags ?? [])].join(' ')
  const newWords = tokenize(newText)

  // Query approved brain entries for this tenant
  const { data: entries } = await supabase
    .from('brain_entries')
    .select('id, title, category, tags')
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')

  // Query playbooks for this tenant (no status column — check all)
  const { data: playbooks } = await supabase
    .from('playbooks')
    .select('id, name')
    .eq('tenant_id', tenantId)

  const matches: SimilarityMatch[] = []

  for (const entry of entries ?? []) {
    const entryText = [entry.title, ...(entry.tags ?? [])].join(' ')
    const entryWords = tokenize(entryText)
    const overlap = wordOverlap(newWords, entryWords)
    if (overlap >= 2) {
      matches.push({
        id: entry.id as string,
        title: entry.title as string,
        category: entry.category as string,
        similarity: overlap >= 3 ? 'high' : 'medium',
      })
    }
  }

  for (const playbook of playbooks ?? []) {
    const pbWords = tokenize(playbook.name as string)
    const overlap = wordOverlap(newWords, pbWords)
    if (overlap >= 2) {
      // Only add if not already matched via brain_entries
      const alreadyMatched = matches.some((m) => m.title === playbook.name)
      if (!alreadyMatched) {
        matches.push({
          id: playbook.id as string,
          title: playbook.name as string,
          category: 'workflow',
          similarity: overlap >= 3 ? 'high' : 'medium',
        })
      }
    }
  }

  // Sort high similarity first
  matches.sort((a, b) => (a.similarity === 'high' ? -1 : 1) - (b.similarity === 'high' ? -1 : 1))

  return NextResponse.json({ matches })
}
