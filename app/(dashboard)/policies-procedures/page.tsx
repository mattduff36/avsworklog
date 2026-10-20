'use client';
import { ModuleBetaBadge } from '@/components/ui/module-beta-badge';
import { PoliciesWorkspace } from '@/components/policies-procedures/PoliciesWorkspace';
import { policyHttpAdapter } from '@/lib/client/policies-procedures';
import { useModuleAccessLevel } from '@/lib/hooks/useModuleAccessLevel';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';

const adapter = policyHttpAdapter();
export default function PoliciesPage() {
  const { accessLevel, isLoading } = useModuleAccessLevel('policies-procedures');
  const access = useSensitiveModuleAccess('policies-procedures', { enabled: !isLoading && accessLevel > 0 });
  if (isLoading || (accessLevel > 0 && access.loading)) return <AppPageLoadingShell title="Policies and Procedures" titleMeta={<ModuleBetaBadge accent="policies-procedures" />} />;
  if (accessLevel > 0 && !access.canAccess) return <SensitiveModuleGate moduleLabel="Policies and Procedures" access={access} />;
  return <><SensitiveModuleSessionManager moduleLabel="Policies and Procedures" access={access} /><PoliciesWorkspace key={accessLevel} adapter={adapter} accessLevel={accessLevel} /></>;
}
