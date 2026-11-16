import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({role:vi.fn(),reset:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/utils/view-as',()=>({getEffectiveRole:mocks.role}));
vi.mock('@/lib/server/inspection-deletion',()=>({withInspectionDeletionDatabase:(work:(db:unknown)=>unknown)=>work({})}));
vi.mock('@/lib/server/test-fleet-reset',()=>({
  resetTestFleet:mocks.reset,listTestAssets:mocks.list,
  TestFleetResetError:class extends Error{status=409;},
}));
import { GET,POST,DELETE } from '@/app/api/debug/test-vehicles/route';
const id='11111111-1111-4111-8111-111111111111';
const request=(body:unknown,origin='https://squires.test')=>new NextRequest('https://squires.test/api/debug/test-vehicles',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.role.mockResolvedValue({user_id:id,is_actual_super_admin:true,is_viewing_as:false});mocks.reset.mockResolvedValue({total:1});mocks.list.mockResolvedValue([]);});
describe('Test Fleet reset API',()=>{
  it('denies non-superadmins and View As without database access',async()=>{
    mocks.role.mockResolvedValue({user_id:id,is_actual_super_admin:false,is_viewing_as:false});expect((await GET()).status).toBe(403);
    mocks.role.mockResolvedValue({user_id:id,is_actual_super_admin:true,is_viewing_as:true});expect((await POST(request({mode:'preview',assetIds:[id]}))).status).toBe(403);
    expect(mocks.reset).not.toHaveBeenCalled();expect(mocks.list).not.toHaveBeenCalled();
  });
  it('rejects cross-origin, arbitrary prefix, and unconfirmed execution',async()=>{
    expect((await POST(request({mode:'preview',assetIds:[id]},'https://other.test'))).status).toBe(403);
    expect((await POST(request({mode:'preview',assetIds:[id],prefix:''}))).status).toBe(400);
    expect((await POST(request({mode:'preview',assetIds:[id,id]}))).status).toBe(400);
    expect((await POST(request({mode:'execute',assetIds:[id]}))).status).toBe(400);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it('binds confirmed execution to actor and fingerprint; removes master-delete endpoint',async()=>{
    const fingerprint='a'.repeat(64);
    expect((await POST(request({mode:'execute',assetIds:[id],fingerprint,confirmation:'RESET TEST RECORDS'}))).status).toBe(200);
    expect(mocks.reset).toHaveBeenCalledWith({}, {assetIds:[id],actorId:id,fingerprint,execute:true});
    expect((await DELETE()).status).toBe(405);
  });
});
