import type { InspectionPhoto } from '@/types/inspection';

export type InspectionPhotoMap = Record<string, InspectionPhoto[]>;

export function getInspectionPhotoKey(itemNumber: number, dayOfWeek?: number | null): string {
  return `${dayOfWeek ?? 0}-${itemNumber}`;
}

export function groupInspectionPhotosByItem(photos: InspectionPhoto[]): InspectionPhotoMap {
  return photos.reduce<InspectionPhotoMap>((acc, photo) => {
    if (photo.item_number === null) {
      return acc;
    }

    const key = getInspectionPhotoKey(photo.item_number, photo.day_of_week);
    if (!acc[key]) {
      acc[key] = [];
    }

    acc[key].push(photo);
    return acc;
  }, {});
}

export function sortInspectionPhotos(photos: InspectionPhoto[]): InspectionPhoto[] {
  return [...photos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
