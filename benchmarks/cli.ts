import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH, CACHE, currentEntry, ensureBaseline, writeBundle } from './build.js';
import { startServer } from './server.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const { values } = parseArgs({
  options: {
    engine: { type: 'string', default: 'chrome' },
    baseline: { type: 'string', default: 'origin/main' },
    filter: { type: 'string', default: '' },
    ops: { type: 'string' },
    time: { type: 'string', default: '300' },
    sample: { type: 'string', default: '10' },
  },
});

const baseline = await ensureBaseline(values.baseline!);
const passArgs = [
  '--filter', values.filter!,
  '--time', values.time!,
  '--sample', values.sample!,
  ...(values.ops ? ['--ops', values.ops] : []),
];
const resultsDir = join(BENCH, '.results');
mkdirSync(resultsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

async function runProcess(name: string, cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'inherit' });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${name} exited with ${code}`);
  }

  await Bun.write(join(resultsDir, `${stamp}-${name}.json`), out);
  await Bun.write(join(resultsDir, `latest-${name}.json`), out);
}

for (const engine of values.engine!.split(',')) {
  if (engine === 'bun' || engine === 'node') {
    // The TS sources re-export types, which only a bundler strips; both engines get bundles.
    const [b, c, runner] = await Promise.all([
      writeBundle(`baseline-${engine}`, baseline.entry, engine),
      writeBundle(`current-${engine}`, currentEntry, engine),
      writeBundle(`run-${engine}`, join(BENCH, 'run.ts'), engine),
    ]);
    const bin = engine === 'bun' ? process.execPath : 'node';
    await runProcess(engine, [bin, runner, '--baseline', b, '--current', c, ...passArgs]);
  } else if (engine === 'chrome') {
    const { promise, resolve } = Promise.withResolvers<any>();
    const server = await startServer({ port: 0, baselineRef: values.baseline!, onResults: resolve });
    const url = new URL(server.url);
    url.search = new URLSearchParams({
      autorun: '1',
      post: '1',
      filter: values.filter!,
      time: values.time!,
      ...(values.ops ? { ops: values.ops } : {}),
    }).toString();
    const chrome = Bun.spawn(
      [CHROME, '--headless=new', `--user-data-dir=${join(CACHE, 'chrome-profile')}`, '--no-first-run', url.href],
      { stdout: 'ignore', stderr: 'ignore' }
    );
    console.error(`# chrome headless: ${url.href}`);
    const body = await promise;
    chrome.kill();
    server.stop(true);
    const speedups = body.results.map((r: any) => r.speedup);
    const geo = Math.exp(speedups.reduce((a: number, x: number) => a + Math.log(x), 0) / speedups.length);
    for (const r of body.results) {
      console.error(`${r.fixture.padEnd(44).slice(0, 44)} ${r.op.padEnd(11)} ${r.speedup.toFixed(2).padStart(5)}×${r.identical ? '' : '  ✗ OUTPUT DIFFERS'}`);
    }

    console.error(`# chrome geomean ${geo.toFixed(2)}× · differing outputs: ${body.results.filter((r: any) => !r.identical).length}`);
  }
}
