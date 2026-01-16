/**
 * Types for workshop task completion maintenance field updates
 */

export type CompletionUpdateValueType = 'mileage' | 'date' | 'text' | 'boolean';

export interface CompletionUpdateConfig {
  target: 'vehicle_maintenance';
  field_name: string;
  value_type: CompletionUpdateValueType;
  label: string;
  required: boolean;
  help_text?: string | null;
}

export type CompletionUpdatesArray = CompletionUpdateConfig[];

export interface CompletionFieldValues {
  [fieldName: string]: string | number | boolean | null;
}
