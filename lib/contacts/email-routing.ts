// Resolves To/CC recipients for outbound insurer/adjuster emails (reports, quotes, BAR)
// Priority: order_sender_email → adjuster_submission_email → insurer submission_email

export interface OutboundEmailRecipients {
  to: string[];   // primary recipient(s)
  cc: string[];   // always include all submission emails found
}

export function resolveInsurerEmailRecipients(params: {
  orderSenderEmail?: string | null;
  orderSenderName?: string | null;
  adjusterSubmissionEmail?: string | null;  // from clients table, adjuster firm
  insurerSubmissionEmail?: string | null;   // from clients table, insurer
}): OutboundEmailRecipients {
  const { orderSenderEmail, adjusterSubmissionEmail, insurerSubmissionEmail } = params;

  const cc: string[] = [];
  if (adjusterSubmissionEmail) cc.push(adjusterSubmissionEmail);
  if (insurerSubmissionEmail) cc.push(insurerSubmissionEmail);

  // Primary To: order sender if available
  if (orderSenderEmail) {
    // Remove from CC if it's also in To
    const filteredCc = cc.filter(e => e !== orderSenderEmail);
    return { to: [orderSenderEmail], cc: filteredCc };
  }

  // Fallback: adjuster firm submission email
  if (adjusterSubmissionEmail) {
    const filteredCc = cc.filter(e => e !== adjusterSubmissionEmail);
    return { to: [adjusterSubmissionEmail], cc: filteredCc };
  }

  // Final fallback: insurer submission email
  if (insurerSubmissionEmail) {
    return { to: [insurerSubmissionEmail], cc: [] };
  }

  return { to: [], cc: [] };
}
