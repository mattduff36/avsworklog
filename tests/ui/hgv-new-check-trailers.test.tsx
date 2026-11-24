/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import NewHgvInspectionPage from '@/app/(dashboard)/hgv-inspections/new/page';
import { requestHgvInspectionSave } from '@/lib/client/hgv-inspection-save';

const auth = {user:{id:'driver'},loading:false};
const router = {push: vi.fn(), replace: vi.fn()};
let query: URLSearchParams;
let matchingDraft = false;
let failDraftItems = false;
let outstanding: (url: string) => Promise<Response>;
const photos = {photoMap:{}, photos:[], refresh:vi.fn(), loading:false, error:null};
const assets = [
  {id:'tractor',reg_number:'TRACTOR',nickname:null,current_mileage:100,classification:'artic'},
  {id:'rigid',reg_number:'RIGID',nickname:null,current_mileage:100,classification:'rigid'},
  {id:'second',reg_number:'T2',nickname:'Second trailer',current_mileage:null,classification:'trailer'},
  {id:'trailer',reg_number:'C517773',nickname:'Nooteboom',current_mileage:null,classification:'trailer'},
];

vi.mock('next/navigation', () => ({useRouter: () => router, useSearchParams: () => query}));
vi.mock('@/lib/hooks/useAuth', () => ({useAuth: () => auth}));
vi.mock('@/lib/hooks/usePermissionCheck', () => ({usePermissionCheck: () => ({loading:false,hasPermission:true})}));
vi.mock('@/components/layout/tablet-mode-context', () => ({useTabletMode: () => ({tabletModeEnabled:true})}));
vi.mock('@/lib/hooks/useInspectionPhotos', () => ({useInspectionPhotos: (id: string) => id === 'saved' && matchingDraft ? {...photos, photos:[{id:'photo',item_number:23,day_of_week:7}]} : photos}));
vi.mock('@/lib/client/hgv-inspection-save', () => ({requestHgvInspectionSave: vi.fn(),isHgvSubmittedConflictError: () => false}));
vi.mock('@/lib/supabase/client', () => ({createClient: () => ({from: (table: string) => {
  if (table === 'inspection_items') return {select: () => ({eq: async () => failDraftItems ? {data:null,error:{message:'Failed'}} : {
    data:[{item_number:23,item_description:'Brake Hoses',status:'ok',comments:'Existing trailer note'}]
  }})};
  const filters = new Map<string, string>();
  const builder = {
    select: () => builder, eq: (key: string, value: string) => { filters.set(key,value); return builder; },
    order: () => builder, limit: () => builder,
    maybeSingle: async () => {
      if (filters.get('id') === 'saved') return {data:{
        id:'saved',user_id:'driver',hgv_id:'tractor',inspection_date:'2026-11-01',current_mileage:100,record_kind:'full_check',trailer_kind:'fleet',trailer_hgv_id:'trailer'
      }};
      const matches = matchingDraft && filters.get('hgv_id') === 'tractor' && filters.get('user_id') === 'driver' &&
        filters.get('inspection_date') === '2026-11-01' && filters.get('status') === 'draft' && filters.get('record_kind') === 'full_check';
      return {data: matches ? {id:'saved',status:'draft'} : null};
    }
  };
  return builder;
}})}));

beforeEach(() => {
  matchingDraft = false;
  failDraftItems = false;
  outstanding = async () => Response.json({lockedItems:[],trailerWarnings:[]});
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(requestHgvInspectionSave).mockResolvedValue({id:'saved',items:[],status:'draft',revision:0});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/assets')) return Response.json({assets});
    if (url.includes('locked-defects')) return outstanding(url);
    if (url.includes('recent-completed-defects')) return Response.json({recentlyCompletedItems:[]});
    throw new Error('Unexpected URL: ' + url);
  }));
});
afterEach(() => {cleanup();vi.clearAllMocks();vi.unstubAllGlobals();});

async function start(id: string, waitForChecklist = true) {
  query = new URLSearchParams({hgvId:id});
  render(<NewHgvInspectionPage />);
  await waitFor(() => expect((screen.getByLabelText(/Current KM/) as HTMLInputElement).placeholder).toBe('e.g. 100'));
  fireEvent.change(screen.getByLabelText(/Daily Check Date/),{target:{value:'2026-11-01'}});
  fireEvent.change(screen.getByLabelText(/Current KM/),{target:{value:'100'}});
  fireEvent.click(screen.getByRole('button',{name:'Start Daily Check'}));
  if (waitForChecklist) await screen.findByText('26-Point HGV Safety Check');
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

  it('shows the selected trailer warning without answering tractor Tyres, and clears it immediately when changing trailers', async () => {
    let releaseSecond: (() => void) | undefined;
    outstanding = async url => {
      if (url.includes('trailerHgvId=second')) {
        await new Promise<void>(resolve => { releaseSecond = resolve; });
        return Response.json({lockedItems:[], trailerWarnings:[]});
      }
      return Response.json({lockedItems:[], trailerWarnings:url.includes('trailerHgvId=trailer') ? [
        {actionId:'trailer-fault',item_description:'Tyres',comment:'Nooteboom tyre wall split'}
      ] : []});
    };
    await start('tractor');
    async function choose(label: string) {
      const area = document.querySelector<HTMLElement>('[data-trailer-picker]')!;
      const picker = within(area).getByRole('combobox');
      await waitFor(() => expect(picker.hasAttribute('disabled')).toBe(false));
      fireEvent.keyDown(picker,{key:'ArrowDown'});
      fireEvent.click(await screen.findByRole('option',{name:label}));
    }
    await choose('C517773 (Nooteboom)');
    expect((await screen.findAllByText(/Nooteboom tyre wall split/)).length).toBeGreaterThan(0);
    fireEvent(window,new Event('pagehide'));
    await waitFor(() => expect(requestHgvInspectionSave).toHaveBeenCalledWith(expect.objectContaining({
      trailerSelection:{kind:'fleet',trailerHgvId:'trailer'}, items:[],
    })));
    const pickerArea = within(document.querySelector<HTMLElement>('[data-trailer-picker]')!);
    fireEvent.click(pickerArea.getByRole('button',{name:'Change selection'}));
    await choose('T2 (Second trailer)');
    await waitFor(() => expect(releaseSecond).toBeTypeOf('function'));
    expect(screen.queryByText(/Nooteboom tyre wall split/)).toBeNull();
    releaseSecond!();
    await waitFor(() => expect(pickerArea.getByRole('button',{name:'Change selection'}).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByText(/Nooteboom tyre wall split/)).toBeNull();
  }, 15000);

  it('opens a matching tractor draft without an initial write and preserves its pairing, note and photos', async () => {
    matchingDraft = true;
    await start('tractor');
    await screen.findAllByText('Trailer · C517773 (Nooteboom)');
    expect(await screen.findAllByRole('button', {name:'Manage photos for Brake Hoses'})).not.toHaveLength(0);
    expect(requestHgvInspectionSave).not.toHaveBeenCalled();
    fireEvent(window,new Event('pagehide'));
    await waitFor(() => expect(requestHgvInspectionSave).toHaveBeenCalledWith(expect.objectContaining({
      hintInspectionId:'saved', trailerSelection:{kind:'fleet',trailerHgvId:'trailer'},
      items:[expect.objectContaining({item_number:23,status:'ok',comments:'Existing trailer note'})],
    })));
  });

  it('leaves saved evidence untouched if hydration fails and allows reopening it', async () => {
    matchingDraft = true; failDraftItems = true;
    await start('tractor',false);
    const retry = await screen.findByRole('button',{name:'Retry opening draft'});
    fireEvent(window,new Event('pagehide'));
    expect(requestHgvInspectionSave).not.toHaveBeenCalled();
    failDraftItems = false;
  outstanding = async () => Response.json({lockedItems:[],trailerWarnings:[]});
    fireEvent.click(retry);
    await screen.findAllByText('Trailer · C517773 (Nooteboom)');
    expect(requestHgvInspectionSave).not.toHaveBeenCalled();
  });

  it('resumes a draft discovered during photo or page-hide saving before accepting new evidence', async () => {
    await start('tractor');
    matchingDraft = true;
    fireEvent(window,new Event('pagehide'));
    await screen.findAllByText('Trailer · C517773 (Nooteboom)');
    expect(requestHgvInspectionSave).not.toHaveBeenCalled();
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
