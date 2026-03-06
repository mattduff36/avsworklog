export interface Vehicle {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
  category_id: string;
  van_categories?: { name: string; id: string } | null;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  applies_to?: string[];
}

export interface HgvCategory {
  id: string;
  name: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface HgvAsset {
  id: string;
  reg_number: string | null;
  nickname: string | null;
  status: string;
  category_id: string | null;
  hgv_categories?: { name: string; id: string } | null;
}

export interface PlantAsset {
  id: string;
  plant_id: string;
  nickname: string | null;
  status: string;
  category_id: string | null;
  van_categories?: { name: string; id: string } | null;
}
