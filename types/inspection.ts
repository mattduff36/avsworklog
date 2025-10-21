export interface InspectionItem {
  id?: string;
  inspection_id: string;
  item_number: number; // 1-26
  day_of_week: number; // 1-7 (Monday-Sunday)
  status: 'ok' | 'attention' | 'na'; // ✓, X, 0
  created_at?: string;
}

export interface InspectionPhoto {
  id?: string;
  inspection_id: string;
  item_number: number | null;
  day_of_week: number | null;
  photo_url: string;
  caption: string | null;
  created_at?: string;
}

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
  created_at: string;
  updated_at: string;
  items?: InspectionItem[];
  photos?: InspectionPhoto[];
}

export const INSPECTION_ITEMS = [
  // Standard checks (1-21)
  { number: 1, name: 'Fuel - and ad-blu' },
  { number: 2, name: 'Mirrors - includes Class V & Class VI' },
  { number: 3, name: 'Safety Equipment - Cameras & Audible Alerts' },
  { number: 4, name: 'Warning Signage - VRU Sign' },
  { number: 5, name: 'FORS Stickers' },
  { number: 6, name: 'Oil' },
  { number: 7, name: 'Water' },
  { number: 8, name: 'Battery' },
  { number: 9, name: 'Tyres' },
  { number: 10, name: 'Brakes' },
  { number: 11, name: 'Steering' },
  { number: 12, name: 'Lights' },
  { number: 13, name: 'Reflectors' },
  { number: 14, name: 'Indicators' },
  { number: 15, name: 'Wipers' },
  { number: 16, name: 'Washers' },
  { number: 17, name: 'Horn' },
  { number: 18, name: 'Markers' },
  { number: 19, name: 'Sheets / Ropes / Chains' },
  { number: 20, name: 'Security of Load' },
  { number: 21, name: 'Side underbar/Rails' },
] as const;

export const ARTIC_TRAILER_ITEMS = [
  // ARTIC/TRAILER COMBINATIONS (22-26)
  { number: 22, name: 'Brake Hoses' },
  { number: 23, name: 'Couplings Secure' },
  { number: 24, name: 'Electrical Connections' },
  { number: 25, name: 'Trailer No. Plate' },
  { number: 26, name: 'Nil Defects' },
] as const;

export const ALL_INSPECTION_ITEMS = [...INSPECTION_ITEMS, ...ARTIC_TRAILER_ITEMS] as const;

