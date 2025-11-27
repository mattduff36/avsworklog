import { z } from 'zod';

/**
 * Common validation schemas for API routes
 */

// UUID validation
export const UUIDSchema = z.string().uuid('Invalid ID format');

// Common ID params
export const IdParamsSchema = z.object({
  id: UUIDSchema,
});

// Timesheet adjustment schema
export const TimesheetAdjustSchema = z.object({
  comments: z.string()
    .min(1, 'Comments are required')
    .max(500, 'Comments must be less than 500 characters'),
  notifyManagerIds: z.array(UUIDSchema).optional(),
});

// Timesheet rejection schema
export const TimesheetRejectSchema = z.object({
  comments: z.string()
    .min(1, 'Comments are required')
    .max(500, 'Comments must be less than 500 characters'),
});

// User creation/update schemas
export const CreateUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  full_name: z.string().min(1, 'Name is required').max(100),
  employee_id: z.string().optional(),
  role: z.enum(['admin', 'manager', 'employee-civils', 'employee-plant', 'employee-transport', 'employee-office', 'employee-workshop']),
  phone_number: z.string().optional(),
  annual_holiday_allowance_days: z.number().int().min(0).max(365).optional(),
});

export const UpdateUserSchema = CreateUserSchema.partial();

// Vehicle schemas
export const CreateVehicleSchema = z.object({
  reg_number: z.string()
    .min(1, 'Registration number is required')
    .max(20, 'Registration number too long')
    .regex(/^[A-Z0-9\s]+$/i, 'Invalid registration format'),
  vehicle_type: z.string().optional(),
  category_id: UUIDSchema.optional(),
  status: z.enum(['active', 'inactive']).default('active'),
});

export const UpdateVehicleSchema = CreateVehicleSchema.partial();

// Message schemas
export const CreateMessageSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required').max(5000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  recipient_ids: z.array(UUIDSchema).min(1, 'At least one recipient required'),
  requires_signature: z.boolean().default(false),
});

// Absence schemas
export const CreateAbsenceSchema = z.object({
  user_id: UUIDSchema,
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  absence_type: z.string().min(1, 'Absence type is required'),
  reason: z.string().max(500).optional(),
});

// Generic pagination schema
export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

// Date range schema
export const DateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid start date format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid end date format'),
}).refine(data => new Date(data.startDate) <= new Date(data.endDate), {
  message: 'Start date must be before or equal to end date',
  path: ['startDate'],
});

/**
 * Helper function to validate request body
 * Usage: const result = await validateRequest(req, schema);
 */
export async function validateRequest<T>(
  req: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const body = await req.json();
    const data = schema.parse(body);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      return {
        success: false,
        error: `${firstError.path.join('.')}: ${firstError.message}`,
      };
    }
    return { success: false, error: 'Invalid request data' };
  }
}

/**
 * Helper function to validate URL params
 */
export function validateParams<T>(
  params: unknown,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    const data = schema.parse(params);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      return {
        success: false,
        error: `${firstError.path.join('.')}: ${firstError.message}`,
      };
    }
    return { success: false, error: 'Invalid parameters' };
  }
}

