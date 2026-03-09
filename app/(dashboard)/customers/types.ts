export interface Customer {
  id: string;
  company_name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_job_title: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  payment_terms_days: number;
  default_validity_days: number;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CustomerFormData {
  company_name: string;
  short_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_job_title: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  county: string;
  postcode: string;
  payment_terms_days: number;
  default_validity_days: number;
  status: 'active' | 'inactive';
  notes: string;
}

export const EMPTY_CUSTOMER_FORM: CustomerFormData = {
  company_name: '',
  short_name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  contact_job_title: '',
  address_line_1: '',
  address_line_2: '',
  city: '',
  county: '',
  postcode: '',
  payment_terms_days: 30,
  default_validity_days: 30,
  status: 'active',
  notes: '',
};
