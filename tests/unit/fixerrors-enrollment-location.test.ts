import { afterEach, describe, expect, it, vi } from 'vitest';
const command = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>(() => '{}'));
vi.mock('child_process', () => ({ execFileSync: command }));
vi.mock('@/lib/server/fixerrors/store', () => ({ localFixerrorsStore: {} }));
import { readProtectedEnrollment } from '@/scripts/automation/fixerrors-companion';
import { writeProtectedFixerrorsEnrollment } from '@/scripts/automation/provision-fixerrors-local-device';

afterEach(() => { command.mockClear(); vi.unstubAllGlobals(); });
describe('shared enrollment across packaged desktop and SCM service', () => {
  it('reads and provisions the same profile location without AppData read fallback', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    readProtectedEnrollment('production-device.dpapi');
    const read = String(command.mock.calls[0]?.[1]);
    expect(read).toContain("$env:USERPROFILE '.codex\\cursor-worker\\squires-device-secrets\\production-device.dpapi'");
    expect(read).not.toContain('LOCALAPPDATA');
    writeProtectedFixerrorsEnrollment('production-device.dpapi', { fixture: true });
    const write = String(command.mock.calls[1]?.[1]);
    expect(write).toContain("$env:USERPROFILE '.codex\\cursor-worker\\squires-device-secrets'");
    expect(write).toContain('Existing legacy enrollment requires migration, not replacement');
    expect(write).toContain('SetAccessRuleProtection($true,$false)');
  });
  it('does not retry a failed canonical read against a different enrollment', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    command.mockImplementationOnce(() => { throw new Error('missing canonical enrollment'); });
    expect(() => readProtectedEnrollment('production-device.dpapi')).toThrow('missing canonical enrollment');
    expect(command).toHaveBeenCalledTimes(1);
  });
});
