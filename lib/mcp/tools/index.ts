import type { McpTool } from '@/lib/mcp/server'
import { findWorkOrders } from '@/lib/mcp/tools/work-orders'
import { getWorkOrderEmail, sendWorkOrder } from '@/lib/mcp/tools/work-order-send'
import { getDocumentEmail, listJobDocumentsTool, sendDocuments } from '@/lib/mcp/tools/documents'

// Every tool the voice connector offers. Add new tools here and to the
// "Voice connector" section of the tech spec.
export const MCP_TOOLS: McpTool[] = [
  findWorkOrders,
  getWorkOrderEmail,
  sendWorkOrder,
  listJobDocumentsTool,
  getDocumentEmail,
  sendDocuments,
]
