import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { findWorkOrders, spokenDate } from '@/lib/mcp/tools/work-orders'
import { describeExcess, isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { listJobDocumentsTool } from '@/lib/mcp/tools/documents'
import { listJobEmails } from '@/lib/mcp/tools/emails'
import { describeRequest } from '@/lib/mcp/tools/signing'
import { fetchJobContext } from '@/lib/jobs/fetchJobContext'
import { getJobStage } from '@/lib/jobs/getJobStage'
import { loadExcessContext } from '@/lib/excess/server'
import { listSigningRequestsForJob } from '@/lib/signing/service'
import { JobNoteError, addJobNote as saveJobNote, listJobNotes } from '@/lib/communications/notes'
import { searchJobs, type JobMatch } from '@/lib/jobs/search'

// Finding a job, a job at a glance, and adding a note to it. The summary is assembled from
// the app's own stage logic (getJobStage), the dashboard's pending actions,
// and the other connector tools' views of work orders, documents, signing,
// excess and email — so it says what those say.

const NOTES_SHOWN_CHARS = 600
const RECENT_NOTES = 5

type Section = { title: string; text: string }

/** One section of the summary; a failure in one doesn't stop the rest. */
async function section(title: string, load: () => Promise<string | null>): Promise<Section | null> {
  try {
    const text = await load()
    return text ? { title, text } : null
  } catch (err) {
    console.error(`[mcp] job summary section "${title}" failed:`, err)
    return { title, text: '(couldn\'t load this part)' }
  }
}

/** A tool's text without its first line (the job heading every tool repeats). */
const body = (text: string) => text.split('\n').slice(1).join('\n').trim()

export const getJobSummary: McpTool = {
  name: 'get_job_summary',
  title: 'Job summary',
  description: [
    'Everything about a job at a glance: who and where, its stage and the next step, pending actions from the dashboard, work orders, quotes/reports/invoices,',
    'signing, excess, the latest emails and the job notes. Use it for "what\'s happening on IRC…" and summarise it for the user — lead with the stage, the next step and anything waiting on them.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' } },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    const jobArgs = { job_number: job.job_number }

    const { data: full, error } = await ctx.supabase
      .from('jobs').select('insured_name, insured_phone, insurer, claim_number, loss_type, created_at, notes')
      .eq('tenant_id', ctx.tenantId).eq('id', job.id).maybeSingle()
    if (error) throw error

    const sections = (await Promise.all([
      section('Stage', async () => {
        const stage = getJobStage(await fetchJobContext(job.id, ctx.supabase))
        return [
          `${stage.label} — ${stage.description}`,
          stage.primaryAction ? `Next step: ${stage.primaryAction.label}.` : null,
          stage.contextualWarning ? `Note: ${stage.contextualWarning.message}` : null,
        ].filter(Boolean).join(' ')
      }),
      section('Waiting on you', async () => {
        const { data } = await ctx.supabase
          .from('action_queue').select('title, description, priority')
          .eq('tenant_id', ctx.tenantId).eq('job_id', job.id).eq('status', 'pending')
          .order('priority', { ascending: true })
        return data?.length ? data.map(a => `- ${a.title}${a.description ? ` (${a.description})` : ''}`).join('\n') : null
      }),
      section('Work orders', async () => body((await findWorkOrders.run(jobArgs, ctx)).text) || 'None.'),
      section('Documents', async () => body((await listJobDocumentsTool.run(jobArgs, ctx)).text)),
      section('Signing', async () => {
        const requests = await listSigningRequestsForJob({ tenantId: ctx.tenantId, userId: ctx.userId }, job.id)
        return requests.length ? requests.map(r => `- ${describeRequest(r)}`).join('\n') : 'Nothing sent for signing yet.'
      }),
      section('Excess', async () => describeExcess(await loadExcessContext(ctx.supabase, ctx.tenantId, job.id))),
      section('Latest emails', async () => body((await listJobEmails.run({ ...jobArgs, limit: 3 }, ctx)).text) || 'None yet.'),
      section('Recent job notes', async () => {
        const notes = await listJobNotes(ctx.supabase, { tenantId: ctx.tenantId, jobId: job.id, limit: RECENT_NOTES })
        return notes.length
          ? notes.map(n => `- ${n.created_at ? `${spokenDate(n.created_at)}, ` : ''}${n.author ?? 'note'}: ${n.content}`).join('\n')
          : null
      }),
    ])).filter((s): s is Section => !!s)

    const notes = full?.notes?.trim()
    if (notes) {
      sections.push({
        title: 'Overview notes',
        text: notes.length > NOTES_SHOWN_CHARS ? `…${notes.slice(-NOTES_SHOWN_CHARS)}` : notes,
      })
    }

    const who = [
      full?.insured_name ? `Insured: ${full.insured_name}${full.insured_phone ? ` (${full.insured_phone})` : ''}` : null,
      full?.insurer ? `Insurer: ${full.insurer}${full.claim_number ? `, claim ${full.claim_number}` : ''}` : null,
      full?.loss_type ? `Loss: ${full.loss_type}` : null,
      full?.created_at ? `Lodged ${spokenDate(full.created_at)}` : null,
    ].filter(Boolean).join('. ')

    return {
      text: [
        `${job.job_number}, ${job.property_address ?? 'no address'}.${who ? ` ${who}.` : ''}`,
        ...sections.map(s => `\n${s.title}:\n${s.text}`),
      ].join('\n'),
      data: { job_number: job.job_number, property_address: job.property_address, sections },
    }
  },
}

export const addJobNote: McpTool = {
  name: 'add_job_note',
  title: 'Add job note',
  description: [
    'Adds a note to the job\'s Comms feed (the communications list on the job\'s Overview tab), dated and marked as added by voice (or by the assistant, in the app\'s chat).',
    'Write the note in the user\'s words; read it back and get a yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      note: { type: 'string', description: 'The note.' },
    },
    required: ['job_number', 'note'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.notes',

  async run(args, ctx: McpContext): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    try {
      const note = await saveJobNote(ctx.supabase, {
        tenantId: ctx.tenantId, userId: ctx.userId, jobId: job.id, note: args.note,
        source: ctx.via === 'chat' ? 'assistant' : 'voice',
      })
      return { text: `Added a note to ${job.job_number}'s comms: "${note.content}"`, data: { job_number: job.job_number, note: note.content, id: note.id } }
    } catch (err) {
      if (err instanceof JobNoteError) return { text: err.message, isError: true }
      throw err
    }
  },
}

const MAX_FOUND = 8

const jobLine = (j: JobMatch) =>
  `- ${j.job_number}: ${j.property_address ?? 'no address'}` +
  `${j.insured_name ? `, ${j.insured_name}` : ''}${j.client_name || j.insurer ? ` (${j.client_name ?? j.insurer}${j.claim_number ? `, claim ${j.claim_number}` : ''})` : j.claim_number ? ` (claim ${j.claim_number})` : ''}` +
  `${j.stage ? ` — ${j.stage}` : ''}.`

export const findJob: McpTool = {
  name: 'find_job',
  title: 'Find job',
  description: [
    'Finds a job from what the user remembers: part of the street name or suburb, the insured\'s or client\'s name, the insurer, the claim number or the job number — e.g. "Leighton Mundaring", "Castle Smith", "claim 0123456".',
    'Every word has to match something on the job. Returns each match\'s job number, address, insured, client, claim number and stage.',
    'Use it whenever the user names a job by address or person instead of its number, then use the job_number with the other tools. If several match, read them out and ask which.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Words to match, e.g. "Leighton Rd Mundaring" or "Jones".' } },
    required: ['query'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return { text: 'What should I look for — a street, suburb, name or claim number?', isError: true }
    const { matches, total } = await searchJobs(ctx.supabase, ctx.tenantId, query, { limit: MAX_FOUND })
    if (!matches.length) return { text: `No job matches "${query}". Try fewer words, or just the street or surname.`, data: { query, jobs: [] } }
    const jobs = matches.map(({ id: _id, created_at: _c, ...j }) => j)
    return {
      text: [
        matches.length === 1 ? `One job matches "${query}":` : `${total} jobs match "${query}"${total > matches.length ? ` — the best ${matches.length}` : ''}:`,
        ...matches.map(jobLine),
      ].join('\n'),
      data: { query, total, jobs },
    }
  },
}
