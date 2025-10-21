export type InspectionStatus = 'ok' | 'defect' | 'na';

export interface VehicleInspection {
  id: string;
  vehicle_id: string;
  user_id: string;
  inspection_date: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
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
  'Windscreen & glass',
  'Wipers & washers',
  'Mirrors',
  'Horn',
  'Lights - Front',
  'Lights - Rear',
  'Reflectors & markers',
  'Direction indicators',
  'Stop lights',
  'Number plates',
  'Seat belts',
  'Windscreen & sun visors',
  'Speedometer',
  'Steering',
  'Brakes',
  'Tyres',
  'Wheels & wheel nuts',
  'Bodywork',
  'Fuel system',
  'Exhaust system',
  'Engine oil level',
  'Coolant level',
  'Battery',
  'Fifth wheel / coupling',
  'Trailer connection',
  'Fire extinguisher',
];
