import { readFileSync, writeSync } from 'node:fs';
import { executeNativeBatch, nativeBatchLineReader, verifyBatchContributions } from '../../scripts/automation/fixerrors-batch-engine';

async function main() {
  if (process.argv[2] === '--verify-contributions') {
    verifyBatchContributions(JSON.parse(readFileSync(0, 'utf8')));
    return;
  }
  const line = nativeBatchLineReader();
  const input = line() as Parameters<typeof executeNativeBatch>[0];
  let id = 0;
  const result = await executeNativeBatch(input, {
    call(method, value) {
      writeSync(1, `${JSON.stringify({ id: ++id, method, value })}\n`);
      const response = line() as { id: number; ok: boolean; value: unknown };
      if (response.id !== id || !response.ok) throw new Error('Native fixture refused operation');
      return response.value;
    },
  }, process.cwd());
  writeSync(1, `${JSON.stringify({ result })}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 2; });
