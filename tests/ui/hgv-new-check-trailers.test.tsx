/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewHgvInspectionPage from '@/app/(dashboard)/hgv-inspections/new/page';
import { requestHgvInspectionSave } from '@/lib/client/hgv-inspection-save';

const auth = {user:{id:'driver'},loading:false};
const router = {push: vi.fn(), replace: vi.fn()};
let query: URLSearchParams;
const photos = {photoMap:{}, photos:[], refresh:vi.fn(), loading:false, error:null};
const assets = [
  {id:'tractor',reg_number:'TRACTOR',nickname:null,current_mileage:100,classification:'artic'},
  {id:'rigid',reg_number:'RIGID',nickname:null,current_mileage:100,classification:'rigid'},
  {id:'trailer',reg_number:'C517773',nickname:'Nooteboom',current_mileage:null,classification:'trailer'},
];

vi.mock('next/navigation', () => ({useRouter: () => router, useSearchParams: () => query}));
vi.mock('@/lib/hooks/useAuth', () => ({useAuth: () => auth}));
vi.mock('@/lib/hooks/usePermissionCheck', () => ({usePermissionCheck: () => ({loading:false,hasPermission:true})}));
vi.mock('@/components/layout/tablet-mode-context', () => ({useTabletMode: () => ({tabletModeEnabled:true})}));
vi.mock('@/lib/hooks/useInspectionPhotos', () => ({useInspectionPhotos: () => photos}));
vi.mock('@/lib/client/hgv-inspection-save', () => ({requestHgvInspectionSave: vi.fn(),isHgvSubmittedConflictError: () => false}));
vi.mock('@/lib/supabase/client', () => ({createClient: () => ({from: (table: string) => {
  if (table === 'inspection_items') return {select: () => ({eq: async () => ({data:[{item_number:23,item_description:'Brake Hoses',status:'ok',comments:null}]})})};
  const builder = {select: () => builder,eq: () => builder,limit: () => builder,maybeSingle: async () => ({data: query.has('id') ? {
    id:'saved',user_id:'driver',hgv_id:'tractor',inspection_date:'2026-11-01',current_mileage:100,record_kind:'full_check',trailer_kind:'fleet',trailer_hgv_id:'trailer'
  } : null})};
  return builder;
}})}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(requestHgvInspectionSave).mockResolvedValue({id:'saved',items:[],status:'draft'});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/assets')) return Response.json({assets});
    if (url.includes('locked-defects')) return Response.json({lockedItems:[]});
    if (url.includes('recent-completed-defects')) return Response.json({recentlyCompletedItems:[]});
    throw new Error('Unexpected URL: ' + url);
  }));
});
afterEach(() => {cleanup();vi.clearAllMocks();vi.unstubAllGlobals();});

async function start(id: string) {
  query = new URLSearchParams({hgvId:id});
  render(<NewHgvInspectionPage />);
  await waitFor(() => expect((screen.getByLabelText(/Current KM/) as HTMLInputElement).placeholder).toBe('e.g. 100'));
  fireEvent.change(screen.getByLabelText(/Daily Check Date/),{target:{value:'2026-11-01'}});
  fireEvent.change(screen.getByLabelText(/Current KM/),{target:{value:'100'}});
  fireEvent.click(screen.getByRole('button',{name:'Start Daily Check'}));
  await screen.findByText('26-Point HGV Safety Check');
}

describe('trailer handling from the driver Daily Check form', () => {
  it('silently records the four N/A answers for a rigid HGV', async () => {
    await start('rigid');
    expect(screen.queryByText('Select trailer')).toBeNull();
    fireEvent(window,new Event('pagehide'));
    await waitFor(() => expect(requestHgvInspectionSave).toHaveBeenCalledWith(expect.objectContaining({
      status:'draft', hgvId:'rigid', trailerSelection:{kind:'none'},
      items:[23,24,25,26].map(item_number => expect.objectContaining({item_number,status:'na'})),
    })));
  });

  it('restores a tractor draft and keeps its trailer and answers on the next save', async () => {
    query = new URLSearchParams({id:'saved'});
    render(<NewHgvInspectionPage />);
    await screen.findAllByText('Trailer · C517773 (Nooteboom)');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('trailerHgvId=trailer'))).toBe(true);
    fireEvent(window,new Event('pagehide'));
    await waitFor(() => expect(requestHgvInspectionSave).toHaveBeenCalledWith(expect.objectContaining({
      hintInspectionId:'saved', hgvId:'tractor', trailerSelection:{kind:'fleet',trailerHgvId:'trailer'},
      items:[expect.objectContaining({item_number:23,status:'ok'})],
    })));
  });
});
