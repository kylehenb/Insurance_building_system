import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { debrief, MAX_SAID, OFFICE, officeMemory, spokenTakeaways } from '@/lib/learning/debrief'

// The office memory by voice and chat (tech spec §24.8): "remember, Dave at
// Brush Bros likes it casual" teaches IRC anywhere, not just on a card; and
// before writing anything in the office's voice, Claude reads what it's been
// taught about that person and how the office writes.

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const db = (ctx: McpContext) => ctx.supabase as unknown as SupabaseClient

export const remember: McpTool = {
  name: 'remember',
  title: 'Remember this',
  description: [
    'Teaches IRC something to keep doing from now on — "remember, Dave at Brush Bros likes it casual", "always copy the assessor in on Allianz make safes", "every time a trade confirms a day, let the homeowner know". It\'s turned into a few takeaways that apply wherever IRC writes or acts (action cards, emails by voice, the chat).',
    'Pass what the user said in full, in their words. Read the takeaways back; if one is wrong, they can say so and you call remember again with the correction.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      what: { type: 'string', description: 'What the user wants remembered, in their words, in full.' },
      about: { type: 'string', description: 'Who or what it\'s about, if clear: a person, a company, a job number.' },
    },
    required: ['what'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  // The same as teaching from an action card
  permission: 'actions.review',

  async run(args, ctx): Promise<McpToolResult> {
    const what = str(args.what).slice(0, MAX_SAID)
    if (!what) return { text: 'What should I remember?', isError: true }
    const about = str(args.about)
    const points = await debrief(db(ctx), {
      tenantId: ctx.tenantId, userId: ctx.userId, feature: OFFICE, said: what,
      situation: { kind: 'remember', about: about || null }, situationText: about ? `Something to remember about ${about}` : 'Something to remember',
      happened: `The owner asked IRC to remember this ${ctx.via === 'chat' ? 'in the app\'s chat' : 'by voice'}.`,
      recordEvent: { sourceTable: undefined, sourceId: undefined, kind: 'remember' },
    })
    if (!points.length) return { text: 'I didn\'t take anything general from that to remember — say it as something to do from now on, e.g. "always…" or "with Dave, …".', data: { takeaways: [] } }
    return { text: spokenTakeaways(points), data: { takeaways: points } }
  },
}

export const getOfficeMemory: McpTool = {
  name: 'get_office_memory',
  title: 'What the office has taught',
  description: [
    'What the owner has taught IRC about people, companies and how the office writes and works (tone with a person, who to copy in, what never to send, workflows). Read it BEFORE writing anything in the office\'s voice — an email, a reply, a message — and follow what applies to who it\'s to.',
    'about narrows to lessons mentioning a person, company or insurer.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { about: { type: 'string', description: 'A person, company or insurer, e.g. "Dave", "Brush Bros", "Suncorp".' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const all = await officeMemory(db(ctx), ctx.tenantId)
    const about = str(args.about).toLowerCase()
    const words = about.split(/\s+/).filter(w => w.length > 2)
    // Lessons about them, and the ones that apply to everything
    const general = /\b(any|all|every|always|everyone|anyone)\b/i
    const rows = about
      ? all.filter(l => words.some(w => `${l.applies_when} ${l.lesson}`.toLowerCase().includes(w)) || general.test(l.applies_when))
      : all
    if (!rows.length) return { text: about ? `Nothing taught about ${str(args.about)} yet.` : 'Nothing taught yet.', data: { lessons: [] } }
    return {
      text: rows.map(l => `- When: ${l.applies_when} — ${l.lesson}`).join('\n'),
      data: { lessons: rows },
    }
  },
}
