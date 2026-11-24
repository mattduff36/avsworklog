import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from '@/app/api/workshop-tasks/tasks/[taskId]/assign-hgv-repair/route';

const { access, rpc } = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/server/workshop-tasks/auth', () => ({ requireWorkshopTasksAccess: access }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({rpc}) }));

const taskId = 'f45aa243-b062-429f-88cc-8782968b5949';
function assign(side = 'trailer') {
  return PATCH(new NextRequest('http://localhost/api/workshop-tasks/tasks/' + taskId + '/assign-hgv-repair', {
    method:'PATCH', body: JSON.stringify({side,expectedSide:'pair',p_actor_id:'client-spoof'}),
  }), {params:Promise.resolve({taskId})});
}

describe('workshop repair assignment', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it.each([401,403])('enforces workshop access (%i)',async status => {
    access.mockResolvedValue({ok:false,status});
    expect((await assign()).status).toBe(status);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('accepts only a repair side and uses the session identity',async () => {
    access.mockResolvedValue({ok:true,userId:'mechanic'});
    expect((await assign('unrelated-asset')).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({error:null});
    expect((await assign()).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('assign_hgv_trailer_repair',{
      p_task_id:taskId,p_actor_id:'mechanic',p_side:'trailer',p_expected_side:'pair',
    });
  });
});
