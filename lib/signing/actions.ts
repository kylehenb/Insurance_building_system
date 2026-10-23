import { SigningError, type SigningActor } from './provider'
import { confirmSigningStage, getSigningProvider, resendSigningRequest, setRemindersEnabled } from './service'

// The actions on an existing signing request, as the job's Signing panel
// offers them (app/api/signing/requests/[id]/[action]) — also run by approved
// requests.

export const SIGNING_ACTIONS = ['send', 'resend', 'revoke', 'confirm-stage', 'reminders'] as const
export type SigningAction = (typeof SIGNING_ACTIONS)[number]

export function isSigningAction(value: string): value is SigningAction {
  return (SIGNING_ACTIONS as readonly string[]).includes(value)
}

/** The fields each action reads from the request body */
export interface SigningActionBody {
  reason?: unknown
  enabled?: unknown
}

export async function runSigningAction(actor: SigningActor, requestId: string, action: SigningAction, body: SigningActionBody): Promise<unknown> {
  const provider = getSigningProvider()
  switch (action) {
    case 'send':
      return { request: await provider.send(actor, requestId) }
    case 'resend':
      return { request: await resendSigningRequest(actor, requestId) }
    case 'revoke':
      return { request: await provider.revoke(actor, requestId, typeof body.reason === 'string' ? body.reason : null) }
    case 'confirm-stage':
      return confirmSigningStage(actor, requestId)
    case 'reminders':
      if (typeof body.enabled !== 'boolean') throw new SigningError('enabled must be true or false', 400)
      return { request: await setRemindersEnabled(actor, requestId, body.enabled) }
  }
}
