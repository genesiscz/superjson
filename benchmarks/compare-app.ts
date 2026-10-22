import type { SuperJSONCtor } from './fixtures.js';
import { isDevalue, prepare, runSteps, selectCases, type Case, type Op } from './suite.js';

interface LibMeta {
  id: string;
  label: string;
  url: string;
  sha: string;
  ref: string;
  kind: string;
  subject: string;
}

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);

  return el;
};

const params = new URLSearchParams(location.search);

function calibrate() {
  const start = performance.now();
  let x = 0;
  for (let i = 0; i < 3e7; i++) {
    x = (x + (i & 7)) | 0;
  }
  (globalThis as { __sink?: number }).__sink = x;

  return performance.now() - start;
}

/** null when the library can run the case, otherwise the first line of its error. */
function refusal(Lib: SuperJSONCtor, c: Case): string | null {
  try {
    prepare(Lib, c)();

    return null;
  } catch (error) {
    return (error as Error).message.split('\n')[0];
  }
}

async function runCompare(opts: { filter: string; ops: Op[]; timeMs: number; throttle: number; series?: string; run?: string }) {
  $('status').textContent = 'loading versions…';
  const libs: LibMeta[] = await (await fetch('/api/compare/libs')).json();
  const versions: SuperJSONCtor[] = await Promise.all(
    libs.map(async l => (await import(/* @vite-ignore */ l.url)).default)
  );
  const selected = selectCases(opts.filter, opts.ops);
  const calibrationMs = calibrate();
  const started = performance.now();
  const cases = [];
  for (const [i, c] of selected.entries()) {
    $('status').textContent = `${i + 1}/${selected.length} ${c.id}`;
    const refused = versions.map(v => (isDevalue(v) ? refusal(v, c) : null));
    const timed = versions.flatMap((_, k) => (refused[k] === null ? [k] : []));
    const { bytes, results } = await runSteps(
      timed.map(k => versions[k]),
      0,
      c,
      { timeMs: opts.timeMs, minSampleMs: 25 }
    );
    const full = versions.map((_, k) => {
      const at = timed.indexOf(k);
      if (at < 0) {
        return { ms: null, rme: null, samples: 0, identical: false, refused: refused[k] };
      }

      return { ...results[at], refused: null };
    });
    cases.push({ id: c.id, fixture: c.fixture.name, group: c.fixture.group, op: c.op, bytes, results: full });
  }

  const next = {
    createdAt: new Date().toISOString(),
    engine: navigator.userAgent,
    throttle: opts.throttle,
    calibrationMs,
    crossOriginIsolated,
    timeMs: opts.timeMs,
    series: opts.series,
    run: opts.run,
    steps: libs.map(l => ({ id: l.id, sha: l.sha, ref: l.ref, kind: l.kind, subject: l.subject, body: '', parent: null, files: [], diff: '' })),
    cases,
  };
  const saved = await (await fetch('/api/compare', { method: 'POST', body: JSON.stringify(next) })).json();
  $('status').textContent = `done in ${((performance.now() - started) / 1000).toFixed(0)} s, saved as ${saved.name}`;
}

if (params.get('autorun') === '1') {
  runCompare({
    filter: params.get('filter') ?? '',
    ops: (params.get('ops') ?? 'stringify,parse,serialize,deserialize').split(',').map(s => s.trim()) as Op[],
    timeMs: Number(params.get('time') ?? 6000),
    throttle: Number(params.get('throttle') ?? 1),
    series: params.get('series') ?? undefined,
    run: params.get('run') ?? undefined,
  });
}
