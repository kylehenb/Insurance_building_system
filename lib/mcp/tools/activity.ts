import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { listActivity } from '@/lib/activity/log'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'

// The who-did-what log by voice — the same listActivity as Settings → Activity,
// with the same rule: everyone's for people who may manage users, else your own.

const TIME_ZONE = 'Australia/Perth'
const SHOWN = 30
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const VIA = { app: 'in the app', voice: 'by voice', approval: 'on approval' } as const

export const listActivityTool: McpTool = {
  name: 'list_activity',
  title: 'Activity log',
  description: [
    'Who did what: sends, lodging, stage and excess changes, voice actions and approvals, newest first.',
    'Filter by person (name), job, or days back (default 1, max 90). Admins see everyone; others see only their own.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'A staff member\'s name, e.g. Olivia.' },
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      days: { type: 'number', description: 'How many days back. Default 1.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    let userId: string | undefined
    if (typeof args.person === 'string' && args.person.trim()) {
      const { data: users } = await ctx.supabase.from('users').select('id, name').eq('tenant_id', ctx.tenantId)
      const wanted = args.person.trim().toLowerCase()
      const matches = (users ?? []).filter(u => (u.name ?? '').toLowerCase().includes(wanted))
      if (matches.length === 0) return { text: `No one called "${args.person}".`, isError: true }
      if (matches.length > 1) return { text: `Which one: ${matches.map(u => u.name).join(', ')}?`, isError: true }
      userId = matches[0].id
    }
    let jobId: string | undefined
    if (typeof args.job_number === 'string' && args.job_number.trim()) {
      const job = await jobFromArgs(args, ctx)
      if (isToolResult(job)) return job
      jobId = job.id
    }
    const days = typeof args.days === 'number' ? args.days : 1

    const { entries, seesEveryone } = await listActivity(ctx.tenantId, ctx.userId, { userId, jobId, days }, ctx.supabase)
    const note = !seesEveryone && userId && userId !== ctx.userId ? ' (You can only see your own activity.)' : ''
    if (!entries.length) return { text: `Nothing in the last ${days === 1 ? 'day' : `${days} days`}.${note}`, data: { entries: [] } }

    const lines = entries.slice(0, SHOWN).map(e =>
      `- ${when(e.createdAt)} — ${e.user.name ?? 'someone'} ${VIA[e.via]}: ${e.summary}${e.outcome === 'done' ? '' : ` [${e.outcome}]`}${e.approvedBy ? ` (approved by ${e.approvedBy})` : ''}`)
    return {
      text: [`${entries.length} thing${entries.length === 1 ? '' : 's'} in the last ${days === 1 ? 'day' : `${days} days`}${entries.length > SHOWN ? ` (latest ${SHOWN} shown)` : ''}:${note}`, ...lines].join('\n'),
      data: {
        entries: entries.slice(0, SHOWN).map(e => ({
          at: e.createdAt, who: e.user.name, via: e.via, summary: e.summary, outcome: e.outcome, job_number: e.job?.number ?? null, approved_by: e.approvedBy,
        })),
      },
    }
  },
}
