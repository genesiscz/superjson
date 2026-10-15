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

const instance = (Lib: SuperJSONCtor, fixture: Fixture) => {
  const sj = new Lib({ dedupe: fixture.dedupe });
  fixture.setup?.(sj);

  return sj;
};

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
 * Byte-equal check. Serialization outputs must match exactly. Deserialized values are compared by
 * re-serializing both with the baseline, which captures types and referential identity.
 */
export function checkIdentical(libs: Libs, c: Case): { identical: boolean; bytes: number } {
  const b = instance(libs.baseline, c.fixture);
  const cur = instance(libs.current, c.fixture);
  const data = dataOf(c.fixture) as any;
  const text = b.stringify(data);

  switch (c.op) {
    case 'serialize':
    case 'stringify':
      return { identical: text === cur.stringify(data), bytes: text.length };
    case 'deserialize':
    case 'parse':
    case 'roundtrip': {
      const viaBaseline = b.deserialize(b.serialize(data));
      const viaCurrent = cur.deserialize(b.serialize(data));
      const parsedBaseline = b.parse(text);
      const parsedCurrent = cur.parse(text);
      const canon = (v: any) => JSON.stringify(b.serialize(v), stableBigint);

      return {
        identical:
          canon(viaBaseline) === canon(viaCurrent) &&
          canon(parsedBaseline) === canon(parsedCurrent),
        bytes: text.length,
      };
    }
  }
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
