export type ContactRole =
  | 'insured'
  | 'auth'
  | 'primary_site'
  | 'secondary_site'
  | 'broker'
  | 'real_estate';

export type AdditionalContactType =
  | 'tenant'
  | 'real_estate'
  | 'property_manager'
  | 'broker'
  | 'owner'
  | 'other';

export interface JobContact {
  slot: 'insured' | 'additional_1' | 'additional_2';
  type?: AdditionalContactType; // only for additional slots
  name: string;
  phone: string;
  email: string;
  roles: ContactRole[];
}

export interface ContactsValidation {
  hasAuth: boolean;       // exactly one contact has 'auth' role
  hasPrimarySite: boolean; // exactly one contact has 'primary_site' role
  errors: string[];
}

// Comms routing — resolved contact for a given action
export interface ResolvedContact {
  name: string;
  phone: string;
  email: string;
  role: ContactRole;
}
