import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { type CaseResult, type Op, OPS, geomean, runCase, selectCases } from './suite.js';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    current: { type: 'string' },
    filter: { type: 'string', default: '' },
    ops: { type: 'string', default: OPS.join(',') },
    time: { type: 'string', default: '300' },
    sample: { type: 'string', default: '10' },
  },
});

const load = async (path: string) => (await import(pathToFileURL(path).href)).default;
const libs = { baseline: await load(values.baseline!), current: await load(values.current!) };
const selected = selectCases(values.filter!, values.ops!.split(',') as Op[]);
const engine = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`;

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const hz = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : x.toFixed(1));

console.error(`# ${engine}: ${selected.length} cases`);
const results: CaseResult[] = [];
for (const c of selected) {
  const r = await runCase(libs, c, { timeMs: Number(values.time), minSampleMs: Number(values.sample) });
  results.push(r);
  console.error(
    `${pad(r.fixture, 44)} ${pad(r.op, 11)} ${hz(r.baseline.hz).padStart(9)} → ${hz(r.current.hz).padStart(9)}  ` +
      `${r.speedup.toFixed(2).padStart(5)}×${r.identical ? '' : '  ✗ OUTPUT DIFFERS'}`
  );
}

const summary: Record<string, number> = { all: geomean(results.map(r => r.speedup)) };
for (const op of OPS) {
  const xs = results.filter(r => r.op === op).map(r => r.speedup);
  if (xs.length) {
    summary[op] = geomean(xs);
  }
}

console.error(
  `# geomean ${Object.entries(summary)
    .map(([k, v]) => `${k} ${v.toFixed(2)}×`)
    .join(' · ')} · differing outputs: ${results.filter(r => !r.identical).length}`
);
console.log(JSON.stringify({ engine, summary, results }));
