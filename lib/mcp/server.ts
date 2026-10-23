import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { PermissionKey } from '@/lib/permissions/catalogue'
import { permissionLevel, refusalMessage } from '@/lib/permissions/resolve'
import { requestApproval } from '@/lib/approvals/service'

// Minimal MCP server (Streamable HTTP, stateless, JSON responses) for the
// Claude voice connector. Only what a tools-only server needs: initialize,
// ping, tools/list and tools/call. Tools live in lib/mcp/tools and must call
// the same lib/ functions the app's buttons use — see AGENTS.md.

export interface McpContext {
  /** Service client — every query must filter on tenantId */
  supabase: SupabaseClient<Database>
  tenantId: string
  /** The app user the connector acts as */
  userId: string
}

export interface McpToolResult {
  /** Plain-language summary Claude reads (and may speak) */
  text: string
  /** The same facts as data */
  data?: Record<string, unknown>
  /** True when the request couldn't be done — text says why */
  isError?: boolean
}

export interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  /**
   * What the connector's user must be allowed to do (lib/permissions).
   * Required for any tool that changes or sends something. At "needs
   * approval" the call is queued for approval instead of run.
   */
  permission?: PermissionKey
  /** The tool checks the caller's permission itself (e.g. deciding approvals) */
  checksOwnPermission?: true
  run(args: Record<string, unknown>, ctx: McpContext): Promise<McpToolResult>
}

/** Newest first; the first is offered when the client asks for one we don't know. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export const SERVER_INSTRUCTIONS = [
  'You are helping the owner of Insurance Repair Co run jobs in their IRC Master system, often by voice.',
  'Keep answers short and spoken-friendly: say trade names, amounts and dates, not ids.',
  'When a request is ambiguous (which job, which trade, several work orders for the same trade), ask before acting.',
  'Always pass on the warnings a tool returns (no email address, $0 amount, already sent).',
  'Before anything that sends an email or changes a record, read back what will happen and wait for a clear yes.',
].join(' ')

type JsonRpcId = string | number
interface JsonRpcRequest { jsonrpc: '2.0'; id?: JsonRpcId | null; method: string; params?: Record<string, unknown> }
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId | null; error: { code: number; message: string } }

const rpcError = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse =>
  ({ jsonrpc: '2.0', id, error: { code, message } })

function isRequest(msg: unknown): msg is JsonRpcRequest {
  return !!msg && typeof msg === 'object' && (msg as JsonRpcRequest).jsonrpc === '2.0'
    && typeof (msg as JsonRpcRequest).method === 'string'
}

/**
 * Handles one JSON-RPC message. Returns null for notifications (the route
 * answers those with 202 and no body).
 */
export async function handleMcpMessage(
  msg: unknown,
  tools: McpTool[],
  ctx: McpContext,
): Promise<JsonRpcResponse | null> {
  if (!isRequest(msg)) return rpcError(null, -32600, 'Invalid request')
  if (msg.id === undefined || msg.id === null) return null
  const { id, method, params = {} } = msg

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'irc-master', title: 'IRC Master', version: '1.0.0' },
          instructions: SERVER_INSTRUCTIONS,
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return {
        jsonrpc: '2.0', id,
        result: {
          tools: tools.map(t => ({
            name: t.name, title: t.title, description: t.description,
            inputSchema: t.inputSchema, annotations: t.annotations,
          })),
        },
      }
    case 'tools/call': {
      const tool = tools.find(t => t.name === params.name)
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`)
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {}
      let out: McpToolResult
      try {
        // Same permission check as the app's buttons: not allowed → refused,
        // needs approval → queued for an approver, with the call to replay
        const level = tool.permission ? await permissionLevel(ctx.tenantId, ctx.userId, tool.permission, ctx.supabase) : 'allowed'
        if (level === 'blocked' && tool.permission) {
          out = { text: refusalMessage(tool.permission, 'blocked'), isError: true }
        } else if (level === 'approval' && tool.permission) {
          const requested = await requestApproval({
            tenantId: ctx.tenantId, userId: ctx.userId, action: tool.permission,
            operation: 'voice.tool', payload: { tool: tool.name, args }, via: 'voice', service: ctx.supabase,
          })
          out = {
            text: `${requested.message} Nothing has been done yet — tell the user it's waiting for approval, and don't retry.`,
            data: { pending_approval: true, approval_id: requested.id, summary: requested.summary },
          }
        } else {
          out = await tool.run(args, ctx)
        }
      } catch (err) {
        console.error(`[mcp] ${tool.name} failed:`, err)
        // Not "nothing changed": a send tool may have got part way. Check first.
        out = { text: `${tool.title} hit an unexpected error. Check the app before trying again.`, isError: true }
      }
      return {
        jsonrpc: '2.0', id,
        result: {
          // The data goes in a text block too: some clients (claude.ai) only
          // show the model the text, and the ids live in the data.
          content: [
            { type: 'text', text: out.text },
            ...(out.data ? [{ type: 'text', text: JSON.stringify(out.data) }] : []),
          ],
          ...(out.data ? { structuredContent: out.data } : {}),
          isError: !!out.isError,
        },
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}
