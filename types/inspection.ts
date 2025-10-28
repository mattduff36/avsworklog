export type InspectionStatus = 'ok' | 'defect';

export interface VehicleInspection {
  id: string;
  vehicle_id: string;
  user_id: string;
  inspection_date: string;
  inspection_end_date: string;
  current_mileage: number | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
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
