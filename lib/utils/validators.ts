import { z } from 'zod';

// Timesheet validation schemas
export const timesheetEntrySchema = z.object({
  day_of_week: z.number().min(1).max(7),
  time_started: z.string().nullable(),
  time_finished: z.string().nullable(),
  working_in_yard: z.boolean().default(false),
  remarks: z.string().nullable(),
}).refine(
  (data) => {
    // If one time is provided, both must be provided
    if (data.time_started || data.time_finished) {
      return data.time_started && data.time_finished;
    }
    return true;
  },
  {
    message: 'Both start and finish times are required',
    path: ['time_finished'],
  }
);

export const timesheetFormSchema = z.object({
  reg_number: z.string().min(1, 'Registration number is required'),
  week_ending: z.date(),
  entries: z.array(timesheetEntrySchema),
});

// Vehicle inspection validation schemas
export const inspectionItemSchema = z.object({
  item_number: z.number().min(1).max(26),
  day_of_week: z.number().min(1).max(7),
  status: z.enum(['ok', 'attention', 'na']),
});

export const vehicleInspectionFormSchema = z.object({
  vehicle_id: z.string().uuid('Valid vehicle is required'),
  week_ending: z.date(),
  mileage: z.number().nullable(),
  checked_by: z.string().min(1, 'Checked by name is required'),
  defects_comments: z.string().nullable(),
  items: z.array(inspectionItemSchema),
});

// User profile validation
export const profileSchema = z.object({
  employee_id: z.string().nullable(),
  full_name: z.string().min(2, 'Full name is required'),
  role: z.enum(['admin', 'manager', 'employee']),
});

// Login validation
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// Registration validation
export const registrationSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  full_name: z.string().min(2, 'Full name is required'),
  employee_id: z.string().nullable(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

