/** @vitest-environment happy-dom */
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { TestFleetDebugPanel } from '@/app/(dashboard)/debug/components/TestFleetDebugPanel';
vi.mock('sonner',()=>({toast:{success:vi.fn()}}));
const asset={id:'11111111-1111-4111-8111-111111111111',kind:'hgv',label:'TE57 HGV'};
const otherAsset={id:'22222222-2222-4222-8222-222222222222',kind:'van',label:'TE57 VAN'};
const preview={assets:[asset],counts:{'public.hgv_inspections':2},blockers:[],fingerprint:'a'.repeat(64),total:2};
let requests:Record<string,unknown>[];
let blockers:string[];
beforeEach(()=>{
  requests=[];blockers=[];
  global.fetch=vi.fn(async(_url,init)=>{
    if(!init)return {ok:true,json:async()=>({assets:[asset,otherAsset]})} as Response;
    const body=JSON.parse(String(init.body));requests.push(body);
    return {ok:true,json:async()=>({...preview,blockers,receiptId:'receipt'})} as Response;
  });
});
describe('Test Fleet reset',()=>{
  it('requires selection, fresh preview and exact typed confirmation',async()=>{
    render(<TestFleetDebugPanel/>);
    fireEvent.click(await screen.findByRole('radio',{name:/TE57 HGV/}));
    expect(screen.queryByRole('button',{name:'Reset test records'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Preview records to reset'}));
    const reset=await screen.findByRole('button',{name:'Reset test records'});
    expect(reset).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type RESET TEST RECORDS to confirm'),{target:{value:'RESET TEST RECORDS'}});
    fireEvent.click(reset);
    await waitFor(()=>expect(requests).toHaveLength(2));
    expect(requests[0]).toEqual({mode:'preview',assetIds:[asset.id]});
    expect(requests[1]).toEqual({mode:'execute',assetIds:[asset.id],fingerprint:preview.fingerprint,confirmation:'RESET TEST RECORDS'});
  });
  it('invalidates preview when selection changes and explains retained storage',async()=>{
    render(<TestFleetDebugPanel/>);
    fireEvent.click(await screen.findByRole('radio',{name:/TE57 HGV/}));
    fireEvent.click(screen.getByRole('button',{name:'Preview records to reset'}));
    await screen.findByRole('button',{name:'Reset test records'});fireEvent.click(screen.getByRole('radio',{name:/TE57 VAN/}));
    expect(screen.queryByRole('region',{name:'Reset preview'})).toBeNull();
    expect(screen.getByText(/Stored photo and attachment files are retained/)).toBeTruthy();
  });
  it('shows blockers without offering destructive confirmation',async()=>{
    blockers=['Unsupported related records: public.inventory_locations'];
    render(<TestFleetDebugPanel/>);fireEvent.click(await screen.findByRole('radio',{name:/TE57 HGV/}));
    fireEvent.click(screen.getByRole('button',{name:'Preview records to reset'}));
    await screen.findByText(blockers[0]);
    expect(screen.queryByRole('button',{name:'Reset test records'})).toBeNull();
  });
});
