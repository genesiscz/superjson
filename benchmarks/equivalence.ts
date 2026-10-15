import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH, currentEntry, ensureBaseline, writeBundle } from './build.js';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string', default: 'origin/main' },
    engine: { type: 'string', default: 'bun,node' },
    runs: { type: 'string', default: '20000' },
    seed: { type: 'string', default: '1' },
  },
});

const baseline = await ensureBaseline(values.baseline!);
console.error(`baseline ${baseline.ref} (${baseline.sha}) vs working tree`);
let failed = false;
for (const engine of values.engine!.split(',') as ('bun' | 'node')[]) {
  const [b, c, runner] = await Promise.all([
    writeBundle(`baseline-eq-${engine}`, baseline.entry, engine),
    writeBundle(`current-eq-${engine}`, currentEntry, engine),
    writeBundle(`equivalence-${engine}`, join(BENCH, 'equivalence-run.ts'), engine),
  ]);
  const bin = engine === 'bun' ? process.execPath : 'node';
  const proc = Bun.spawn(
    [bin, runner, '--baseline', b, '--current', c, '--runs', values.runs!, '--seed', values.seed!],
    { stdout: 'inherit', stderr: 'inherit' }
  );
  failed = (await proc.exited) !== 0 || failed;
}

process.exit(failed ? 1 : 0);
