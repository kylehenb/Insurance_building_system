import type { McpTool } from '@/lib/mcp/server'
import { findWorkOrders } from '@/lib/mcp/tools/work-orders'
import { getWorkOrderEmail, sendWorkOrder } from '@/lib/mcp/tools/work-order-send'
import { createWorkOrderTool, createWorkOrdersFromQuote, editWorkOrderItems, getWorkOrder, updateWorkOrderTool } from '@/lib/mcp/tools/work-order-edit'
import { createQuoteTool, editQuoteItems, findLineItemsTool, getQuote, updateQuoteTool } from '@/lib/mcp/tools/quotes'
import { createInvoiceTool, editInvoiceItems, getInvoice, updateInvoiceTool } from '@/lib/mcp/tools/invoices'
import { createReportTool, getReport, updateReportTool } from '@/lib/mcp/tools/reports'
import { getDocumentEmail, listJobDocumentsTool, sendDocuments } from '@/lib/mcp/tools/documents'
import { getJobExcess, setJobExcessDecision } from '@/lib/mcp/tools/excess'
import { getSigning, resendSigningRequestTool, sendForSignatureTool } from '@/lib/mcp/tools/signing'
import { createOrderFromEmail, findOrderEmails, linkOrderToJob, listInsurerOrders, lodgeOrder, updateInsurerOrder } from '@/lib/mcp/tools/orders'
import { getEmail, listJobEmails, replyToEmailTool } from '@/lib/mcp/tools/emails'
import { readEmailAttachment } from '@/lib/mcp/tools/attachments'
import { linkEmailToJob, saveEmail } from '@/lib/mcp/tools/inbox'
import { recoverDroppedEmails } from '@/lib/mcp/tools/recovery'
import { addJobNote, getJobSummary } from '@/lib/mcp/tools/jobs'
import { decideApprovalTool, listApprovalsTool } from '@/lib/mcp/tools/approvals'
import { listActivityTool } from '@/lib/mcp/tools/activity'
import { confirmActionCard, listActionCards, readActionCard, skipActionCard } from '@/lib/mcp/tools/action-cards'
import { fileConversation, listMailbox, organiseEmails, readConversation, sendEmailTool } from '@/lib/mcp/tools/mailbox'

// Every tool the voice connector offers. Add new tools here and to the
// "Voice connector" section of the tech spec.
export const MCP_TOOLS: McpTool[] = [
  getJobSummary,
  addJobNote,
  findWorkOrders,
  getWorkOrder,
  createWorkOrdersFromQuote,
  createWorkOrderTool,
  updateWorkOrderTool,
  editWorkOrderItems,
  getWorkOrderEmail,
  sendWorkOrder,
  listJobDocumentsTool,
  getDocumentEmail,
  sendDocuments,
  getQuote,
  findLineItemsTool,
  createQuoteTool,
  updateQuoteTool,
  editQuoteItems,
  getInvoice,
  createInvoiceTool,
  updateInvoiceTool,
  editInvoiceItems,
  getReport,
  createReportTool,
  updateReportTool,
  getJobExcess,
  setJobExcessDecision,
  getSigning,
  sendForSignatureTool,
  resendSigningRequestTool,
  listInsurerOrders,
  findOrderEmails,
  createOrderFromEmail,
  lodgeOrder,
  updateInsurerOrder,
  linkOrderToJob,
  listJobEmails,
  getEmail,
  replyToEmailTool,
  readEmailAttachment,
  saveEmail,
  linkEmailToJob,
  recoverDroppedEmails,
  listMailbox,
  readConversation,
  organiseEmails,
  sendEmailTool,
  fileConversation,
  listActionCards,
  readActionCard,
  confirmActionCard,
  skipActionCard,
  listApprovalsTool,
  decideApprovalTool,
  listActivityTool,
]
