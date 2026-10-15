import type { SuperJSONCtor } from './fixtures.js';
import {
  type CaseResult,
  type Libs,
  type Op,
  OPS,
  cases,
  geomean,
  prepare,
  runCase,
  selectCases,
} from './suite.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

const loadLib = async (url: string): Promise<SuperJSONCtor> => (await import(/* @vite-ignore */ url)).default;

const libs: Libs = {
  baseline: await loadLib('/lib/baseline.js'),
  current: await loadLib('/lib/current.js'),
};
const info = await (await fetch('/api/info')).json();
const engine = navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? navigator.userAgent;
$('meta').textContent =
  `baseline ${info.baseline.ref} (${info.baseline.sha}) vs current ${info.current.head}` +
  `${info.current.dirty ? ' + uncommitted src/ changes' : ''} · ${engine} · ` +
  `timer ${crossOriginIsolated ? 'cross-origin isolated (5µs)' : 'coarse (100µs)'}`;

const filter = $<HTMLInputElement>('filter');
const time = $<HTMLInputElement>('time');
const sample = $<HTMLInputElement>('sample');
filter.value = params.get('filter') ?? '';
time.value = params.get('time') ?? time.value;

const selectedOps = new Set<Op>((params.get('ops')?.split(',') as Op[]) ?? OPS);
$('ops').append(
  ...OPS.map(op => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selectedOps.has(op);
    box.onchange = () => (box.checked ? selectedOps.add(op) : selectedOps.delete(op));
    label.append(box, ` ${op} `);

    return label;
  })
);

const profileCase = $<HTMLSelectElement>('profileCase');
profileCase.append(...cases.map(c => new Option(c.id, c.id)));

let results: CaseResult[] = [];
let stopRequested = false;
let sortKey: string | null = null;

const fmtHz = (hz: number) =>
  hz >= 1e6 ? `${(hz / 1e6).toFixed(2)}M` : hz >= 1e3 ? `${(hz / 1e3).toFixed(1)}k` : hz.toFixed(1);
const fmtBytes = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

function row(r: CaseResult) {
  const tr = document.createElement('tr');
  const cls = r.speedup > 1.05 ? 'faster' : r.speedup < 0.95 ? 'slower' : '';
  tr.innerHTML = `
    <td>${r.group}</td><td>${r.fixture}</td><td>${r.op}</td>
    <td class="num">${fmtHz(r.baseline.hz)} <span class="rme">±${r.baseline.rme.toFixed(1)}%</span></td>
    <td class="num">${fmtHz(r.current.hz)} <span class="rme">±${r.current.rme.toFixed(1)}%</span></td>
    <td class="num ${cls}">${r.speedup.toFixed(2)}×</td>
    <td>${r.identical === null ? '' : r.identical ? '✓' : '<span class="slower">✗ differs</span>'}</td>
    <td class="num">${fmtBytes(r.bytes)}</td>`;

  return tr;
}

const sortValue = (r: CaseResult, k: string): string | number =>
  k === 'baseline' ? r.baseline.hz : k === 'current' ? r.current.hz : (r as any)[k];

function render() {
  const list = sortKey
    ? [...results].sort((a, b) => {
        const x = sortValue(a, sortKey!);
        const y = sortValue(b, sortKey!);

        return typeof x === 'number' ? (y as number) - x : String(x).localeCompare(String(y));
      })
    : results;
  $('rows').replaceChildren(...list.map(row));

  const parts = [`<span>all: <b>${geomean(results.map(r => r.speedup)).toFixed(2)}×</b> geomean (${results.length} cases)</span>`];
  for (const op of OPS) {
    const xs = results.filter(r => r.op === op).map(r => r.speedup);
    if (xs.length) {
      parts.push(`<span>${op}: <b>${geomean(xs).toFixed(2)}×</b></span>`);
    }
  }

  const differing = results.filter(r => r.identical === false).length;
  parts.push(`<span class="${differing ? 'slower' : 'faster'}">${differing} with different output</span>`);
  $('summary').innerHTML = results.length ? parts.join('') : '';
}

document.querySelectorAll<HTMLElement>('th[data-k]').forEach(th => {
  th.onclick = () => {
    sortKey = sortKey === th.dataset.k ? null : th.dataset.k!;
    render();
  };
});

async function run() {
  const selected = selectCases(filter.value, [...selectedOps]);
  results = [];
  stopRequested = false;
  $<HTMLButtonElement>('run').disabled = true;
  $<HTMLButtonElement>('stop').disabled = false;
  render();
  const started = performance.now();
  for (const [i, c] of selected.entries()) {
    if (stopRequested) {
      break;
    }

    $('status').textContent = `${i + 1}/${selected.length} ${c.id}`;
    await new Promise(r => setTimeout(r, 0));
    results.push(
      await runCase(libs, c, { timeMs: Number(time.value), minSampleMs: Number(sample.value) })
    );
    render();
  }

  $('status').textContent = `done in ${((performance.now() - started) / 1000).toFixed(1)}s`;
  $<HTMLButtonElement>('run').disabled = false;
  $<HTMLButtonElement>('stop').disabled = true;
}

const exportPayload = () => ({ engine: navigator.userAgent, info, crossOriginIsolated, results });

function markdown() {
  const lines = [
    `baseline ${info.baseline.ref} (${info.baseline.sha}) vs current ${info.current.head}${info.current.dirty ? '+dirty' : ''}, ${engine}`,
    '',
    '| Group | Fixture | Op | Baseline ops/s | Current ops/s | Speedup | Same |',
    '|---|---|---|--:|--:|--:|:-:|',
    ...results.map(
      r =>
        `| ${r.group} | ${r.fixture} | ${r.op} | ${fmtHz(r.baseline.hz)} | ${fmtHz(r.current.hz)} | ${r.speedup.toFixed(2)}× | ${r.identical ? '✓' : '✗'} |`
    ),
    '',
    `Geomean speedup: ${geomean(results.map(r => r.speedup)).toFixed(2)}×`,
  ];

  return lines.join('\n');
}

$('run').onclick = run;
$('stop').onclick = () => (stopRequested = true);
$('md').onclick = () => navigator.clipboard.writeText(markdown());
$('json').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(exportPayload(), null, 2)]));
  a.download = `superjson-bench-${Date.now()}.json`;
  a.click();
};
$('profile').onclick = () => {
  const c = cases.find(x => x.id === profileCase.value)!;
  const lib = $<HTMLSelectElement>('profileLib').value as keyof Libs;
  const fn = prepare(libs[lib], c);
  const end = performance.now() + Number($<HTMLInputElement>('profileSecs').value) * 1000;
  const label = `${lib}: ${c.id}`;
  console.profile(label);
  let n = 0;
  while (performance.now() < end) {
    fn();
    n++;
  }

  console.profileEnd(label);
  $('status').textContent = `profiled ${n} iterations of ${label}`;
};

const savedRuns = $<HTMLSelectElement>('savedRuns');
const engineName = (ua: string) =>
  ua.match(/(HeadlessChrome|Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? ua;

function showRun(label: string, run: { engine?: string; info?: typeof info; results: CaseResult[] }) {
  results = run.results;
  sortKey = null;
  render();
  const baseline = run.info?.baseline ? ` · baseline ${run.info.baseline.ref} (${run.info.baseline.sha})` : '';
  $('loaded').textContent = `showing ${label} · ${engineName(run.engine ?? '?')}${baseline} · ${results.length} cases`;
}

const runTime = (name: string) => {
  const iso = name.slice(0, 24).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? name.replace('.json', '')
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
};

async function listRuns() {
  const runs: { name: string; engine: string; baseline: { ref: string; sha: string } | null; cases: number }[] =
    await (await fetch('/api/results')).json();
  savedRuns.replaceChildren(
    ...runs.map(r => {
      const baseline = r.baseline ? ` vs ${r.baseline.ref}` : '';

      return new Option(`${runTime(r.name)} · ${engineName(r.engine ?? '?')}${baseline} · ${r.cases} cases`, r.name);
    })
  );
}

const loadSaved = async (name: string) =>
  showRun(runTime(name), await (await fetch(`/api/results/${encodeURIComponent(name)}`)).json());

$('loadRun').onclick = () => savedRuns.value && loadSaved(savedRuns.value);
$<HTMLInputElement>('importFile').onchange = async event => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    showRun(file.name, JSON.parse(await file.text()));
  }
};
await listRuns();
if (params.has('run')) {
  savedRuns.value = params.get('run')!;
  await loadSaved(params.get('run')!);
}

if (params.has('autorun')) {
  await run();
  if (params.has('post')) {
    await fetch('/api/results', { method: 'POST', body: JSON.stringify(exportPayload()) });
    await listRuns();
  }
}
