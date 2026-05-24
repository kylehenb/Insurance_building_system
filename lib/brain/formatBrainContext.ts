import type { BrainEntry, BrainEntryCategory } from '@/types/brain'

const CATEGORY_LABEL: Record<BrainEntryCategory, string> = {
  rule: 'RULE',
  tone: 'TONE',
  example: 'EXAMPLE',
  correction: 'CORRECTION',
  workflow: 'WORKFLOW',
  classification: 'CLASSIFICATION',
  'entity-definition': 'DEFINITION',
}

export function formatBrainContext(entries: BrainEntry[]): string {
  if (entries.length === 0) return ''

  const lines = entries.map((entry) => {
    const label = CATEGORY_LABEL[entry.category]
    const tag = entry.persona
      ? `[${label} — ${entry.persona.toUpperCase()}]`
      : `[${label}]`
    return `${tag} ${entry.content}`
  })

  return [
    '--- IRC BRAIN CONTEXT ---',
    'The following rules, examples and knowledge apply to this task:',
    '',
    ...lines,
    '--- END BRAIN CONTEXT ---',
  ].join('\n')
}
