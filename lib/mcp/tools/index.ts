import type { McpTool } from '@/lib/mcp/server'
import { findWorkOrders } from '@/lib/mcp/tools/work-orders'

// Every tool the voice connector offers. Add new tools here and to the
// "Voice connector" section of the tech spec.
export const MCP_TOOLS: McpTool[] = [
  findWorkOrders,
]
