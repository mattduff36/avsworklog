import type { ErrorDetailsResponse } from '@/types/error-details';

interface TimesheetEntryFixture {
  day_of_week: number;
  time_started: string;
  time_finished: string;
  job_number: string;
  working_in_yard: boolean;
  did_not_work: boolean;
  daily_total: number | null;
  remarks: string;
  night_shift?: boolean;
  bank_holiday?: boolean;
}

export const DEMO_ERROR_DETAILS: Record<'pending' | 'subcategory', ErrorDetailsResponse> = {
  pending: {
    success: true,
    detailsType: 'pending-tasks',
    summary: {
      title: 'Pending Workshop Tasks Found',
      description: 'Some tasks remain incomplete and need attention before proceeding.',
      count: 2,
    },
    items: [
      {
        id: 'pending-1',
        title: 'Brake check on unit A12',
        status: 'pending',
        priority: 'high',
        due_date: new Date().toISOString(),
        assigned_to: { id: 'user-1', name: 'Alex Mechanic' },
      },
      {
        id: 'pending-2',
        title: 'Tyre inspection',
        status: 'logged',
        priority: 'medium',
        due_date: null,
        assigned_to: null,
      },
    ],
    actions: [
      { id: 'open-task-board', label: 'Open Task Board', type: 'primary' },
      { id: 'dismiss', label: 'Dismiss', type: 'secondary' },
    ],
    resolutionGuide: [
      'Open the task board and review high-priority items first.',
      'Assign any unassigned tasks to available workshop staff.',
      'Re-run validation after closing the pending items.',
    ],
  },
  subcategory: {
    success: true,
    detailsType: 'subcategory-tasks',
    summary: {
      title: 'Subcategory Is In Use',
      description: 'This subcategory cannot be deleted because active tasks still reference it.',
      count: 2,
    },
    items: [
      {
        id: 'task-1',
        title: 'Replace rear lights',
        status: 'logged',
        vehicle: { reg_number: 'AB12 CDE', nickname: 'Unit 42' },
        created_at: new Date().toISOString(),
        url: '/workshop-tasks?task=task-1',
      },
      {
        id: 'task-2',
        title: 'Hydraulic leak inspection',
        status: 'pending',
        vehicle: { reg_number: 'XY98 ZZZ', nickname: null },
        created_at: new Date().toISOString(),
        url: '/workshop-tasks?task=task-2',
      },
    ],
    actions: [
      { id: 'view-task-board', label: 'View Tasks', type: 'primary' },
      { id: 'cancel', label: 'Cancel', type: 'secondary' },
    ],
    resolutionGuide: [
      'Move existing tasks to another subcategory.',
      'Archive or complete linked tasks first.',
    ],
  },
};

export const DEMO_TIMESHEET_ENTRIES: Record<'normal' | 'warning', TimesheetEntryFixture[]> = {
  normal: [
    {
      day_of_week: 1,
      time_started: '07:30',
      time_finished: '16:00',
      job_number: 'JOB-1001',
      working_in_yard: false,
      did_not_work: false,
      daily_total: 8.5,
      remarks: '',
    },
    {
      day_of_week: 2,
      time_started: '07:30',
      time_finished: '16:00',
      job_number: 'JOB-1002',
      working_in_yard: false,
      did_not_work: false,
      daily_total: 8.5,
      remarks: '',
    },
    {
      day_of_week: 3,
      time_started: '07:30',
      time_finished: '16:00',
      job_number: 'YARD',
      working_in_yard: true,
      did_not_work: false,
      daily_total: 8,
      remarks: 'Tooling prep',
    },
    {
      day_of_week: 4,
      time_started: '',
      time_finished: '',
      job_number: '',
      working_in_yard: false,
      did_not_work: true,
      daily_total: null,
      remarks: 'Holiday',
    },
    {
      day_of_week: 5,
      time_started: '08:00',
      time_finished: '16:00',
      job_number: 'JOB-1003',
      working_in_yard: false,
      did_not_work: false,
      daily_total: 8,
      remarks: '',
    },
    {
      day_of_week: 6,
      time_started: '',
      time_finished: '',
      job_number: '',
      working_in_yard: false,
      did_not_work: true,
      daily_total: null,
      remarks: '',
    },
    {
      day_of_week: 0,
      time_started: '',
      time_finished: '',
      job_number: '',
      working_in_yard: false,
      did_not_work: true,
      daily_total: null,
      remarks: '',
    },
  ],
  warning: [
    {
      day_of_week: 1,
      time_started: '06:00',
      time_finished: '20:00',
      job_number: '',
      working_in_yard: false,
      did_not_work: false,
      daily_total: 14,
      remarks: 'Long haul',
      night_shift: true,
    },
    {
      day_of_week: 2,
      time_started: '06:00',
      time_finished: '19:00',
      job_number: '',
      working_in_yard: false,
      did_not_work: false,
      daily_total: 13,
      remarks: '',
    },
    {
      day_of_week: 3,
      time_started: '06:30',
      time_finished: '18:00',
      job_number: '',
      working_in_yard: false,
      did_not_work: false,
      daily_total: 11.5,
      remarks: '',
    },
    {
      day_of_week: 4,
      time_started: '07:00',
      time_finished: '18:00',
      job_number: '',
      working_in_yard: false,
      did_not_work: false,
      daily_total: 11,
      remarks: '',
    },
    {
      day_of_week: 5,
      time_started: '07:00',
      time_finished: '17:00',
      job_number: '',
      working_in_yard: false,
      did_not_work: false,
      daily_total: 10,
      remarks: '',
      bank_holiday: true,
    },
    {
      day_of_week: 6,
      time_started: '',
      time_finished: '',
      job_number: '',
      working_in_yard: false,
      did_not_work: true,
      daily_total: null,
      remarks: '',
    },
    {
      day_of_week: 0,
      time_started: '',
      time_finished: '',
      job_number: '',
      working_in_yard: false,
      did_not_work: true,
      daily_total: null,
      remarks: '',
    },
  ],
};

export const DEMO_CUSTOMERS = [
  {
    id: 'customer-1',
    company_name: 'Acme Logistics Ltd',
    short_name: 'Acme',
    contact_name: 'Jordan Smith',
    contact_email: 'jordan.smith@example.com',
    address_line_1: '1 Demo Street',
    address_line_2: 'Industrial Estate',
    city: 'Nottingham',
    county: 'Nottinghamshire',
    postcode: 'NG1 1AA',
    default_validity_days: 30,
  },
  {
    id: 'customer-2',
    company_name: 'Northfield Construction',
    short_name: 'Northfield',
    contact_name: 'Taylor Brown',
    contact_email: 'taylor.brown@example.com',
    address_line_1: '42 Sample Road',
    address_line_2: '',
    city: 'Lincoln',
    county: 'Lincolnshire',
    postcode: 'LN1 2BC',
    default_validity_days: 21,
  },
];

export const DEMO_CUSTOMER_FORM = {
  id: 'customer-edit-1',
  company_name: 'Acme Logistics Ltd',
  short_name: 'Acme',
  contact_name: 'Jordan Smith',
  contact_email: 'jordan.smith@example.com',
  contact_phone: '01234 567890',
  contact_job_title: 'Transport Manager',
  address_line_1: '1 Demo Street',
  address_line_2: 'Industrial Estate',
  city: 'Nottingham',
  county: 'Nottinghamshire',
  postcode: 'NG1 1AA',
  payment_terms_days: 30,
  default_validity_days: 30,
  status: 'active' as const,
  notes: 'Demo customer for modal styling.',
};

export const DEMO_MAINTENANCE_CATEGORY = {
  id: 'maint-cat-1',
  name: 'Tax Due Date',
  description: 'Annual road tax reminder',
  type: 'date' as const,
  period_value: 12,
  alert_threshold_days: 30,
  alert_threshold_miles: null,
  alert_threshold_hours: null,
  applies_to: ['van', 'hgv'] as ('van' | 'plant' | 'hgv')[],
  is_active: true,
  sort_order: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  responsibility: 'office' as const,
  show_on_overview: true,
  reminder_in_app_enabled: true,
  reminder_email_enabled: false,
};

export const DEMO_REMINDER_MESSAGE = {
  id: 'message-1',
  recipient_id: 'recipient-1',
  subject: 'Reminder: PPE compliance check',
  body: 'Please complete PPE compliance checks before end of shift.',
  sender_name: 'Safety Team',
  created_at: new Date().toISOString(),
};
