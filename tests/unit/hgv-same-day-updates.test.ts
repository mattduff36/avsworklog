import { describe, expect, it } from 'vitest';
import { canCorrectHgvCheck, londonDate } from '@/lib/inspections/hgv-updates';
import { HgvInspectionSaveBodySchema } from '@/lib/server/hgv-inspection-save';
import { TRUCK_CHECKLIST_ITEMS } from '@/lib/checklists/vehicle-checklists';
const owner = '11111111-1111-4111-8111-111111111111';
const base = { user_id: owner, status: 'submitted', inspection_date: '2026-07-02', submitted_at: '2026-07-01T23:05:00Z' };
describe('HGV same-day rules', () => {
  it('uses the London day across BST midnight rather than UTC or device time', () => {
    expect(londonDate('2026-07-01T23:05:00Z')).toBe('2026-07-02');
    expect(canCorrectHgvCheck(base, owner, new Date('2026-07-01T23:30:00Z'))).toBe(true);
    expect(canCorrectHgvCheck(base, owner, new Date('2026-07-02T23:00:00Z'))).toBe(false);
  });
  it('handles winter midnight and rejects differing check/submission days and other owners', () => {
    const winter = { ...base, inspection_date: '2026-11-16', submitted_at: '2026-11-16T23:59:00Z' };
    expect(canCorrectHgvCheck(winter, owner, new Date('2026-11-16T23:59:59Z'))).toBe(true);
    expect(canCorrectHgvCheck(winter, owner, new Date('2026-11-17T00:00:00Z'))).toBe(false);
    expect(canCorrectHgvCheck({ ...base, inspection_date: '2026-07-01' }, owner, new Date('2026-07-01T23:30:00Z'))).toBe(false);
    expect(canCorrectHgvCheck(base, 'another-user', new Date('2026-07-01T23:30:00Z'))).toBe(false);
    expect(canCorrectHgvCheck({ ...base, status: 'draft' }, owner, new Date('2026-07-01T23:30:00Z'))).toBe(false);
  });
  it('accepts legacy payloads but requires full-check coverage and a fresh signature', () => {
    const body = { requestId: owner, hgvId: owner, userId: owner, inspectionDate: '2026-11-16', currentMileage: 100, status: 'submitted', inspectorComments: null, signatureData: 'data:image/png;base64,test', items: TRUCK_CHECKLIST_ITEMS.map((item,index) => ({ item_number:index+1,item_description:item,day_of_week:1,status:'ok',comments:null })) };
    expect(HgvInspectionSaveBodySchema.safeParse(body).success).toBe(true);
    expect(HgvInspectionSaveBodySchema.safeParse({ ...body, requestId: undefined }).success).toBe(true);
    expect(HgvInspectionSaveBodySchema.safeParse({ ...body, items: body.items.slice(0,1) }).success).toBe(false);
    expect(HgvInspectionSaveBodySchema.safeParse({ ...body, signatureData: null }).success).toBe(false);
  });
  it('accepts explicit defect-only reports and rejects pretending partial answers are a full check', () => {
    const body = { requestId: owner, hgvId: owner, userId: owner, inspectionDate:'2026-11-16', currentMileage:null, status:'submitted', inspectorComments:null, recordKind:'defect_report', parentCheckId:owner, discoveredAt:'2026-11-16T10:00:00Z', signatureData:'data:image/png;base64,test',items:[{item_number:1,item_description:TRUCK_CHECKLIST_ITEMS[0],day_of_week:1,status:'attention',comments:'New leak'}] };
    expect(HgvInspectionSaveBodySchema.safeParse(body).success).toBe(true);
    expect(HgvInspectionSaveBodySchema.safeParse({ ...body, discoveredAt: undefined }).success).toBe(true);
    expect(HgvInspectionSaveBodySchema.safeParse({ ...body, parentCheckId: null }).success).toBe(false);
    expect(HgvInspectionSaveBodySchema.safeParse({ ...body, items:[{...body.items[0],status:'ok'}] }).success).toBe(false);
  });
});
