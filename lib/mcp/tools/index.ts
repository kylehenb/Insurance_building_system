import type { McpTool } from '@/lib/mcp/server'
import { findWorkOrders } from '@/lib/mcp/tools/work-orders'
import { getWorkOrderEmail, sendWorkOrder } from '@/lib/mcp/tools/work-order-send'
import { getDocumentEmail, listJobDocumentsTool, sendDocuments } from '@/lib/mcp/tools/documents'
import { getJobExcess, setJobExcessDecision } from '@/lib/mcp/tools/excess'
import { getSigning, resendSigningRequestTool, sendForSignatureTool } from '@/lib/mcp/tools/signing'
import { createOrderFromEmail, findOrderEmails, listInsurerOrders, lodgeOrder } from '@/lib/mcp/tools/orders'
import { getEmail, listJobEmails, replyToEmailTool } from '@/lib/mcp/tools/emails'
import { readEmailAttachment } from '@/lib/mcp/tools/attachments'
import { linkEmailToJob, saveEmail } from '@/lib/mcp/tools/inbox'
import { recoverDroppedEmails } from '@/lib/mcp/tools/recovery'

// Every tool the voice connector offers. Add new tools here and to the
// "Voice connector" section of the tech spec.
export const MCP_TOOLS: McpTool[] = [
  findWorkOrders,
  getWorkOrderEmail,
  sendWorkOrder,
  listJobDocumentsTool,
  getDocumentEmail,
  sendDocuments,
  getJobExcess,
  setJobExcessDecision,
  getSigning,
  sendForSignatureTool,
  resendSigningRequestTool,
  listInsurerOrders,
  findOrderEmails,
  createOrderFromEmail,
  lodgeOrder,
  listJobEmails,
  getEmail,
  replyToEmailTool,
  readEmailAttachment,
  saveEmail,
  linkEmailToJob,
  recoverDroppedEmails,
]
