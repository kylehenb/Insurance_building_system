// Browser side of the approval queue. A route answers 403 with
// { pendingApproval: true, error: "Sent for approval: …" } when the user's
// level is "needs approval" and the action was saved for an approver instead
// of done (lib/permissions/http.ts permissionGate). Screens show that as a
// neutral "waiting for approval" notice, not as an error — and don't treat it
// as done either.

export class PendingApprovalError extends Error {
  readonly pendingApproval = true
  constructor(message: string, readonly approvalId: string | null) {
    super(message)
    this.name = 'PendingApprovalError'
  }
}

/** The pending-approval answer in a response body, or null */
export function pendingApprovalFrom(data: unknown): PendingApprovalError | null {
  const d = data as { pendingApproval?: unknown; error?: unknown; approvalId?: unknown } | null
  if (!d || d.pendingApproval !== true) return null
  return new PendingApprovalError(
    typeof d.error === 'string' ? d.error : 'Sent for approval.',
    typeof d.approvalId === 'string' ? d.approvalId : null,
  )
}

/** For a failed response: PendingApprovalError when it was queued, else an Error with the route's message */
export function responseError(data: unknown, fallback: string): Error {
  return pendingApprovalFrom(data) ?? new Error((data as { error?: string } | null)?.error ?? fallback)
}

export const isPendingApproval = (err: unknown): err is PendingApprovalError => err instanceof PendingApprovalError
