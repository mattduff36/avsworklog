import {
  RolloutInterruptedError,
  runInterruptibleActivation,
  type RolloutSnapshot,
} from '../../scripts/manage-daily-allocation-v2-rollout';

let boardEnabled = false;
let writesEnabled = false;
let captureCalls = 0;
let activationCalls = 0;
let disableCalls = 0;
let cancelCalls = 0;

function snapshot(): RolloutSnapshot {
  return {
    runtime: {
      boardEnabled,
      writesEnabled,
      updatedAt: '2026-08-14T16:00:00.000Z',
    },
    permissionFingerprint: 'stable-permissions',
    v1Fingerprint: 'stable-v1',
    v2ContentFingerprint: 'stable-v2',
    v2Counts: { plan_days: 0 },
  };
}

async function main(): Promise<void> {
  try {
    await runInterruptibleActivation({
      captureSnapshot: async () => {
        captureCalls += 1;
        if (captureCalls === 1) {
          setTimeout(() => {
            if (process.platform === 'win32') {
              process.emit('SIGTERM', 'SIGTERM');
            } else {
              process.kill(process.pid, 'SIGTERM');
            }
          }, 5);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return snapshot();
      },
      executeActivation: async () => {
        activationCalls += 1;
        boardEnabled = true;
        writesEnabled = true;
      },
      executeDisable: async () => {
        disableCalls += 1;
        boardEnabled = false;
        writesEnabled = false;
      },
      runSmokeChecks: async () => undefined,
      cancelSmoke: async () => {
        cancelCalls += 1;
      },
    }, 500);
    throw new Error('Signal test unexpectedly completed activation.');
  } catch (error) {
    if (!(error instanceof RolloutInterruptedError)) throw error;
    console.log(JSON.stringify({
      boardEnabled,
      writesEnabled,
      captureCalls,
      activationCalls,
      disableCalls,
      cancelCalls,
      exitCode: error.exitCode,
    }));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
