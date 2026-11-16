import { afterEach, describe, expect, it, vi } from 'vitest';
import { HgvInspectionSaveBodySchema, mapHgvSaveRpcError, saveHgvInspectionForActor } from '@/lib/server/hgv-inspection-save';
import { hgvDailyCheckUpdatesEnabled } from '@/lib/server/hgv-update-capabilities';

const id='11111111-1111-4111-8111-111111111111';
const body=HgvInspectionSaveBodySchema.parse({ requestId:id, hgvId:id,userId:id,inspectionDate:'2026-11-16',currentMileage:100,status:'draft',inspectorComments:null,items:[] });
function admin() { return {from:vi.fn(),rpc:vi.fn().mockResolvedValue({data:{id,status:'draft',items:[],revision:0},error:null})}; }
afterEach(()=>vi.unstubAllEnvs());
describe('HGV production compatibility rollout',()=>{
  it('defaults off and keeps ordinary saves on the locked adapter',async()=>{
    vi.stubEnv('HGV_DAILY_CHECK_UPDATES_ENABLED','');
    expect(hgvDailyCheckUpdatesEnabled()).toBe(false);
    const db=admin(); await saveHgvInspectionForActor({actorId:id,canManageOthers:false,body,admin:db});
    expect(db.rpc).toHaveBeenCalledWith('save_hgv_inspection_compat',expect.objectContaining({p_request_id:id}));
  });
  it('rejects new write modes while allowing future-aware readers',async()=>{
    vi.stubEnv('HGV_DAILY_CHECK_UPDATES_ENABLED','false');
    for(const change of [{recordKind:'defect_report' as const},{correctionReason:'Fix my answers'}]){
      const db=admin();
      await expect(saveHgvInspectionForActor({actorId:id,canManageOthers:false,body:{...body,...change},admin:db})).rejects.toMatchObject({status:403,code:'FEATURE_DISABLED'});
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });
  it('enables identified preview requests but routes stale cached payloads through compatibility',async()=>{
    vi.stubEnv('HGV_DAILY_CHECK_UPDATES_ENABLED','true');
    const db=admin();
    await saveHgvInspectionForActor({actorId:id,canManageOthers:false,body,admin:db});
    expect(db.rpc).toHaveBeenLastCalledWith('save_hgv_inspection_v2',expect.objectContaining({p_request_id:id}));
    await saveHgvInspectionForActor({actorId:id,canManageOthers:false,body:{...body,requestId:undefined},admin:db});
    expect(db.rpc).toHaveBeenLastCalledWith('save_hgv_inspection_compat',expect.objectContaining({p_request_id:expect.any(String)}));
  });
  it('does not return the legacy client false-success conflict code',()=>{
    for(const code of ['COMPAT_CHECK_EXISTS','COMPAT_REFRESH_REQUIRED']){
      const mapped=mapHgvSaveRpcError(`HGV_SAVE:${code}`);
      expect(mapped.status).toBe(409);expect(mapped.code).toBe(code);expect(mapped.error).toContain('not been saved');
    }
  });
});
