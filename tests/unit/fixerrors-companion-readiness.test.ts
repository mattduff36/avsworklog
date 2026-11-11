import { describe, expect, it, vi } from 'vitest';
import { prepareCompanionChecks, UncertainReadinessStop } from '@/scripts/automation/fixerrors-companion-readiness';

const checkout = { head: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true as const };
describe('companion check readiness before admission', () => {
  it('revalidates a source-stale cache before reporting readiness', async () => {
    const run = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    expect(await prepareCompanionChecks(checkout, () => checkout, async () => {}, run)).toBe(true);
    expect(run.mock.calls.map(call => call[0])).toEqual(['ready', 'check', 'ready']);
  });
  it('does not rebuild an already valid cache', async () => {
    const run = vi.fn().mockResolvedValue(true);
    expect(await prepareCompanionChecks(checkout, () => checkout, async () => {}, run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('holds failed checks and never falls back to privileged warmup', async () => {
    const run = vi.fn().mockResolvedValue(false);
    expect(await prepareCompanionChecks(checkout, () => checkout, async () => {}, run)).toBe(false);
    expect(run.mock.calls.map(call => call[0])).toEqual(['ready', 'check']);
  });
  it('rejects checkout changes while checks run', async () => {
    expect(await prepareCompanionChecks(checkout, () => ({ ...checkout, head: 'c'.repeat(40) }), async () => {}, async () => true)).toBe(false);
  });
  it('propagates an uncertain child stop so companion ownership remains held', async () => {
    await expect(prepareCompanionChecks(checkout, () => checkout, async () => {}, async () => {
      throw new UncertainReadinessStop('fixture');
    })).rejects.toThrow(UncertainReadinessStop);
  });
});
