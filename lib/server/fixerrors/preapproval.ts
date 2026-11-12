import 'server-only';
import { expirePreapprovals, fulfillPreapprovedDeploy, type QueueStore } from '@/lib/fixerrors/control';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { getEffectiveRoleForUser } from '@/lib/utils/view-as';
import { isDeletedProfile } from '@/lib/users/deleted-user';

// Device requests can trigger fulfillment, but cannot supply or change its authority.
export async function fulfillFixerrorsPreapprovals(store: QueueStore, deviceId: string): Promise<void> {
  const pending = await store.transact(tx => {
    expirePreapprovals(tx, Date.now());
    return tx.state.jobs.filter(job => job.deviceId === deviceId && job.autoDeployPreapproval?.state === 'pending')
      .map(job => ({ id: job.id, actorId: job.autoDeployPreapproval!.actorId }));
  });
  for (const job of pending) {
    const profile = await getAppAuthProfile(job.actorId, null);
    const role = await getEffectiveRoleForUser(job.actorId);
    const authorized = profile.id === job.actorId && !isDeletedProfile(profile) &&
      role.user_id === job.actorId && role.is_actual_super_admin && !role.is_viewing_as;
    await store.transact(tx => fulfillPreapprovedDeploy(tx, job.id, authorized, Date.now()));
  }
}
