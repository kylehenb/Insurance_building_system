import { describe, it, expect } from 'vitest'
import { PendingApprovalError, isPendingApproval, pendingApprovalFrom, responseError } from '../client'

// Screens tell "saved for approval" apart from a real failure by the
// pendingApproval flag permissionGate puts on its 403.

describe('approval responses in the browser', () => {
  it('recognises a queued action', () => {
    const queued = pendingApprovalFrom({ error: 'Sent for approval: Move IRC1001 to "Repairs".', pendingApproval: true, approvalId: 'a1' })
    expect(queued).toBeInstanceOf(PendingApprovalError)
    expect(queued).toMatchObject({ message: 'Sent for approval: Move IRC1001 to "Repairs".', approvalId: 'a1' })
    expect(isPendingApproval(responseError({ pendingApproval: true }, 'x'))).toBe(true)
  })

  it('leaves real failures as errors', () => {
    expect(pendingApprovalFrom({ error: "Your account isn't allowed to…", level: 'blocked' })).toBeNull()
    expect(pendingApprovalFrom(null)).toBeNull()
    const err = responseError({ error: 'No email address' }, 'fallback')
    expect(isPendingApproval(err)).toBe(false)
    expect(err.message).toBe('No email address')
    expect(responseError({}, 'fallback').message).toBe('fallback')
  })
})
