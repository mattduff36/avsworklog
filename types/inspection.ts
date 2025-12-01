export type InspectionStatus = 'ok' | 'attention' | 'na';

export interface VehicleInspection {
  id: string;
  vehicle_id: string;
  user_id: string;
  inspection_date: string;
  inspection_end_date: string;
  current_mileage: number | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
  signature_data?: string | null;
  signed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionItem {
  id: string;
  inspection_id: string;
  item_number: number;
  item_description: string;
  status: InspectionStatus;
  comments: string | null;
  created_at: string;
}

export interface InspectionPhoto {
  id: string;
  inspection_id: string;
  item_number: number;
  photo_url: string;
  caption: string | null;
  created_at: string;
}

// Re-export checklist utilities from the centralized configuration
export { 
  INSPECTION_ITEMS,
  getChecklistForCategory,
  isVanCategory,
  type VehicleCategory,
  TRUCK_CHECKLIST_ITEMS,
  VAN_CHECKLIST_ITEMS,
} from '@/lib/checklists/vehicle-checklists';
