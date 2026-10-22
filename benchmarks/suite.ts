import { fixtures, type Fixture, type SuperJSONCtor } from './fixtures.js';

export const OPS = ['serialize', 'deserialize', 'stringify', 'parse', 'roundtrip'] as const;
export type Op = (typeof OPS)[number];

export interface Libs {
  baseline: SuperJSONCtor;
  current: SuperJSONCtor;
}

export interface Case {
  id: string;
  fixture: Fixture;
  op: Op;
}

export interface Stats {
  hz: number;
  rme: number;
  samples: number;
}

export interface CaseResult {
  id: string;
  group: string;
  fixture: string;
  op: Op;
  baseline: Stats;
  current: Stats;
  speedup: number;
  identical: boolean | null;
  bytes: number;
}

export const cases: Case[] = fixtures.flatMap(fixture =>
  OPS.map(op => ({ id: `${fixture.name} · ${op}`, fixture, op }))
);

const dataCache = new Map<Fixture, unknown>();
const dataOf = (fixture: Fixture) => {
  if (!dataCache.has(fixture)) {
    dataCache.set(fixture, fixture.make());
  }

  return dataCache.get(fixture);
};

/** devalue exposes `format = 'devalue'` and has no registries, so it skips fixture setup and fidelity is checked instead of bytes. */
export const isDevalue = (Lib: SuperJSONCtor): boolean => 'format' in Lib && Lib.format === 'devalue';

const instance = (Lib: SuperJSONCtor, fixture: Fixture) => {
  const sj = new Lib({ dedupe: fixture.dedupe });
  if (!isDevalue(Lib)) {
    fixture.setup?.(sj);
  }

  return sj;
};

/** devalue's text differs from superjson's, so it counts as identical when its round trip keeps superjson's canonical form. */
export function fidelityMatches(reference: SuperJSONCtor, lib: SuperJSONCtor, c: Case): boolean {
  const ref = instance(reference, c.fixture);
  const sj = instance(lib, c.fixture);
  const data = dataOf(c.fixture) as any;
  const canon = (v: any) => JSON.stringify(ref.serialize(v), stableBigint);
  try {
    return canon(sj.parse(sj.stringify(data))) === canon(data);
  } catch {
    return false;
  }
}

/** Returns the function to time. All inputs are prepared up front so only the op itself is measured. */
export function prepare(Lib: SuperJSONCtor, c: Case): () => unknown {
  const sj = instance(Lib, c.fixture);
  const data = dataOf(c.fixture) as any;

  switch (c.op) {
    case 'serialize':
      return () => sj.serialize(data);
    case 'deserialize': {
      const payload = sj.serialize(data);

      return () => sj.deserialize(payload);
    }
    case 'stringify':
      return () => sj.stringify(data);
    case 'parse': {
      const text = sj.stringify(data);

      return () => sj.parse(text);
    }
    case 'roundtrip':
      return () => sj.deserialize(sj.serialize(data));
  }
}

const stableBigint = (_: string, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v);

/**
 * What `lib` produces for the case, in a form that compares byte for byte. Deserialized values are
 * re-serialized with `reference`, which captures types and referential identity.
 */
export function outputSignature(reference: SuperJSONCtor, lib: SuperJSONCtor, c: Case): string {
  const ref = instance(reference, c.fixture);
  const sj = instance(lib, c.fixture);
  const data = dataOf(c.fixture) as any;
  const canon = (v: any) => JSON.stringify(ref.serialize(v), stableBigint);
  try {
    switch (c.op) {
      case 'serialize':
      case 'stringify':
        return sj.stringify(data);
      default:
        return `${canon(sj.deserialize(ref.serialize(data)))}|${canon(sj.parse(ref.stringify(data)))}`;
    }
  } catch (error) {
    return `throws ${(error as Error).message}`;
  }
}

/** Byte-equal check of the current version against the baseline. */
export function checkIdentical(libs: Libs, c: Case): { identical: boolean; bytes: number } {
  const bytes = instance(libs.baseline, c.fixture).stringify(dataOf(c.fixture)).length;

  return {
    identical: outputSignature(libs.baseline, libs.baseline, c) === outputSignature(libs.baseline, libs.current, c),
    bytes,
  };
}

let sink: unknown;

export const consume = () => sink;

function timeIt(fn: () => unknown, iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    sink = fn();
  }

  return performance.now() - start;
}

function calibrate(fn: () => unknown, minSampleMs: number): number {
  let n = 1;
  for (;;) {
    const t = timeIt(fn, n);
    if (t >= minSampleMs) {
      return Math.max(1, Math.round((n * minSampleMs) / t));
    }

    n = t < minSampleMs / 10 ? n * 10 : n * 2;
  }
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mad = sorted.map(s => Math.abs(s - median)).sort((a, b) => a - b)[mid] ?? 0;
  const rme = median ? (1.4826 * mad * 100) / median / Math.sqrt(sorted.length) : 0;

  return { hz: median, rme, samples: sorted.length };
}

export interface RunOptions {
  /** Time budget per case, split evenly between baseline and current. */
  timeMs: number;
  minSampleMs: number;
}

/** Interleaves baseline and current samples so thermal and GC drift hits both equally. */
export async function runCase(libs: Libs, c: Case, opts: RunOptions): Promise<CaseResult> {
  const fb = prepare(libs.baseline, c);
  const fc = prepare(libs.current, c);
  const { identical, bytes } = (() => {
    try {
      return checkIdentical(libs, c);
    } catch {
      return { identical: false, bytes: 0 };
    }
  })();

  timeIt(fb, 3);
  timeIt(fc, 3);
  const nb = calibrate(fb, opts.minSampleMs);
  const nc = calibrate(fc, opts.minSampleMs);
  const sb: number[] = [];
  const sc: number[] = [];
  const deadline = performance.now() + opts.timeMs;
  while (sb.length < 5 || (performance.now() < deadline && sb.length < 500)) {
    sb.push((nb * 1000) / timeIt(fb, nb));
    sc.push((nc * 1000) / timeIt(fc, nc));
    if (sb.length % 8 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const baseline = stats(sb);
  const current = stats(sc);

  return {
    id: c.id,
    group: c.fixture.group,
    fixture: c.fixture.name,
    op: c.op,
    baseline,
    current,
    speedup: current.hz / baseline.hz,
    identical,
    bytes,
  };
}

export interface StepResult {
  /** Median milliseconds per operation. */
  ms: number;
  rme: number;
  samples: number;
  identical: boolean;
}

/**
 * Measures one case for every version. Each round samples every version once, starting at a
 * different version each round, so drift and GC hit all of them alike.
 */
export async function runSteps(
  versions: SuperJSONCtor[],
  referenceIndex: number,
  c: Case,
  opts: RunOptions
): Promise<{ bytes: number; results: StepResult[] }> {
  const reference = versions[referenceIndex];
  const expected = outputSignature(reference, reference, c);
  const identical = versions.map(v =>
    isDevalue(v) ? fidelityMatches(reference, v, c) : outputSignature(reference, v, c) === expected
  );
  const fns = versions.map(v => prepare(v, c));
  fns.forEach(fn => timeIt(fn, 2));
  const counts = fns.map(fn => calibrate(fn, opts.minSampleMs));
  const samples: number[][] = fns.map(() => []);
  const deadline = performance.now() + opts.timeMs;
  for (let round = 0; round < 5 || (performance.now() < deadline && round < 200); round++) {
    for (let k = 0; k < fns.length; k++) {
      const i = (round + k) % fns.length;
      samples[i].push((counts[i] * 1000) / timeIt(fns[i], counts[i]));
    }

    await new Promise(r => setTimeout(r, 0));
  }

  return {
    bytes: instance(reference, c.fixture).stringify(dataOf(c.fixture)).length,
    results: samples.map((xs, i) => {
      const st = stats(xs);

      return { ms: 1000 / st.hz, rme: st.rme, samples: st.samples, identical: identical[i] };
    }),
  };
}

export const geomean = (xs: number[]) =>
  xs.length ? Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length) : NaN;

export function selectCases(filter: string, ops: readonly Op[]): Case[] {
  const terms = filter
    .toLowerCase()
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  return cases.filter(
    c =>
      ops.includes(c.op) &&
      (!terms.length || terms.some(t => `${c.fixture.group} ${c.id}`.toLowerCase().includes(t)))
  );
}
