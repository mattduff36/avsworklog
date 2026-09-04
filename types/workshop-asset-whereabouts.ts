import type { AssetMeterUnit } from '@/lib/workshop-tasks/asset-meter';

export type WorkshopAssetType = 'van' | 'plant' | 'hgv';
export type WhereaboutsEventSource = 'allocation' | 'inspection';
export type WhereaboutsMeterSource = 'maintenance' | 'inspection';

export interface WorkshopAssetWhereaboutsAsset {
  id: string;
  type: WorkshopAssetType;
  label: string;
  plantId: string | null;
  regNumber: string | null;
}

export interface WorkshopAssetWhereaboutsMeter {
  value: number;
  unit: AssetMeterUnit;
  source: WhereaboutsMeterSource;
}

export interface WorkshopAssetWhereaboutsEvent {
  id: string;
  source: WhereaboutsEventSource;
  occurredAt: string;
  jobCode: string | null;
  siteAddress: string | null;
  customerName: string | null;
  jobTitle: string | null;
  driverName: string | null;
  inspectionId: string | null;
}

export interface WorkshopAssetWhereaboutsPayload {
  asset: WorkshopAssetWhereaboutsAsset;
  lastCheckAt: string | null;
  lastDriverName: string | null;
  lastDriverPhone: string | null;
  meter: WorkshopAssetWhereaboutsMeter | null;
  fleetHistoryHref: string;
  canOpenFleetHistory: boolean;
  events: WorkshopAssetWhereaboutsEvent[];
}

export interface WhereaboutsCatalogueFill {
  customerName: string | null;
  jobTitle: string | null;
  siteAddress: string | null;
}

export interface WhereaboutsJobRef {
  jobCode: string | null;
  sourceType: 'live_quote' | 'legacy_quote' | 'project_number' | null;
  sourceId: string | null;
}
