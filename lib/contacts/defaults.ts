import { JobContact, ContactRole } from '@/lib/types/contacts';

// Called when a new job or order is created or when contacts array is modified.
export function applyContactDefaults(contacts: JobContact[]): JobContact[] {
  // Single contact (insured only): auto-assign all roles
  if (contacts.length === 1 && contacts[0].slot === 'insured') {
    return [{
      ...contacts[0],
      roles: ['insured', 'auth', 'primary_site'],
    }];
  }

  // Multiple contacts: keep existing roles. Ensure insured always has 'insured' role.
  return contacts.map(c => {
    if (c.slot === 'insured' && !c.roles.includes('insured')) {
      return { ...c, roles: ['insured', ...c.roles] };
    }
    return c;
  });
}

// Returns the contact(s) assigned a given role
export function getContactsByRole(contacts: JobContact[], role: ContactRole): JobContact[] {
  return contacts.filter(c => c.roles.includes(role));
}

// Returns primary outbound contact for a given comms action type
export function resolveCommsTarget(contacts: JobContact[], action: CommsAction): JobContact | null {
  const roleMap: Record<CommsAction, ContactRole> = {
    building_contract: 'auth',
    scope_signoff: 'auth',
    homeowner_signoff: 'auth',
    inspection_booking: 'primary_site',
    site_access: 'primary_site',
    day_of_visit_sms: 'primary_site',
    trade_access: 'primary_site',
    general_update: 'insured',
    excess: 'insured',
    secondary_access: 'secondary_site',
  };
  const targetRole = roleMap[action];
  const matches = getContactsByRole(contacts, targetRole);
  return matches[0] ?? null;
}

export type CommsAction =
  | 'building_contract'
  | 'scope_signoff'
  | 'homeowner_signoff'
  | 'inspection_booking'
  | 'site_access'
  | 'day_of_visit_sms'
  | 'trade_access'
  | 'general_update'
  | 'excess'
  | 'secondary_access';
