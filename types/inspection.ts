export type InspectionStatus = 'ok' | 'attention' | 'na';

export interface VehicleInspection {
  id: string;
  vehicle_id: string;
  user_id: string;
  week_ending: string;
  mileage: number | null;
  checked_by: string | null;
  defects_comments: string | null;
  action_taken: string | null;
  status: 'in_progress' | 'submitted' | 'reviewed';
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
  created_at: string;
  updated_at: string;
  // Added for compatibility
  inspection_date?: string;
  inspection_end_date?: string;
  signature_data?: string | null;
  signed_at?: string | null;
}

export interface InspectionItem {
  id: string;
  inspection_id: string;
  item_number: number;
  day_of_week: number;
  status: InspectionStatus;
  comments: string | null;
  created_at: string;
  // Added for compatibility
  item_description?: string;
}

export interface InspectionPhoto {
  id: string;
  inspection_id: string;
  item_number: number;
  photo_url: string;
  caption: string | null;
  created_at: string;
}

export const INSPECTION_ITEMS = [
  'Fuel - and ad-blu',
  'Mirrors - includes Class V & Class VI',
  'Safety Equipment - Cameras & Audible Alerts',
  'Warning Signage - VRU Sign',
  'FORS Stickers',
  'Oil',
  'Water',
  'Battery',
  'Tyres',
  'Brakes',
  'Steering',
  'Lights',
  'Reflectors',
  'Indicators',
  'Wipers',
  'Washers',
  'Horn',
  'Markers',
  'Sheets / Ropes / Chains',
  'Security of Load',
  'Side underbar/Rails',
  'Brake Hoses',
  'Couplings Secure',
  'Electrical Connections',
  'Trailer No. Plate',
  'Nil Defects',
];
