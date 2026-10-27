import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { spokenDate } from '@/lib/mcp/tools/work-orders'
import { findContacts, findMailContacts, type ContactMatch } from '@/lib/contacts/search'
import { permissionLevel } from '@/lib/permissions/resolve'

// A trade's, supplier's or insured's phone and email by name
// (lib/contacts/search.ts): the trades directory, then email history and
// signatures, then insureds on jobs.

const MAX_FOUND = 6

function contactLine(c: ContactMatch): string {
  const who = [c.name, c.contact_person && c.contact_person !== c.name ? `(${c.contact_person})` : null, c.trade ? `— ${c.trade}` : null].filter(Boolean).join(' ')
  const phone = c.phone ? `phone ${c.phone}${c.phone_source === 'email signature' ? ' (from their email signature)' : ''}${c.other_phones.length ? `, also ${c.other_phones.join(', ')}` : ''}` : 'no phone number on file'
  const extra = [
    c.email ? `email ${c.email}` : 'no email',
    c.jobs.length ? `jobs ${c.jobs.join(', ')}` : null,
    c.last_email ? `last emailed ${spokenDate(c.last_email)}` : null,
    c.status && c.status !== 'active' ? `status ${c.status}` : null,
  ].filter(Boolean)
  return `- ${who}: ${phone}; ${extra.join('; ')}. [${c.source}]`
}

export const findContact: McpTool = {
  name: 'find_contact',
  title: 'Find contact',
  description: [
    'Looks up a trade\'s, supplier\'s or insured\'s phone number and email by name — e.g. "True Fix", "Bunnings trade desk", "Mr Jones".',
    'Searches the trades directory (business, entity and contact names), the people we\'ve emailed (a phone number from their latest email signature when the directory has none — say so), and insureds on jobs.',
    'Returns phone, email, trade and the jobs they\'re on. Use it before calling or emailing someone, or to put their number in a reminder; don\'t search the web for a number first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Business or person, or part of it.' } },
    required: ['name'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (name.length < 2) return { text: 'Who should I look up?', isError: true }
    // Their mailbox only if they can see it
    const canSeeMail = (await permissionLevel(ctx.tenantId, ctx.userId, 'mail.view', ctx.supabase)) === 'allowed'
    const found = await findContacts(ctx.supabase, ctx.tenantId, name, { limit: MAX_FOUND, mail: canSeeMail ? findMailContacts : async () => [] })
    if (!found.length) return { text: `No one called "${name}" in the trades directory, emails or jobs. Try part of the name.`, data: { name, contacts: [] } }
    return {
      text: [`${found.length === 1 ? 'Found' : `${found.length} matches for`} "${name}":`, ...found.map(contactLine)].join('\n'),
      data: { name, contacts: found },
    }
  },
}
