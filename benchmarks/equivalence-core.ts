import { Money, Point, type SuperJSONCtor } from './fixtures.js';

export interface EquivalenceOptions {
  runs: number;
  seed: number;
}

/** Serializes random edge-case values with both versions and compares the output byte for byte. */
export function runEquivalence(
  Baseline: SuperJSONCtor,
  Current: SuperJSONCtor,
  options: EquivalenceOptions,
  log: (line: string) => void
): number {
  let seed = options.seed;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;

    return seed / 4294967296;
  };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const sym = Symbol('eq');
  const keys = ['a', 'b', '0', '1', '10', '01', '-1', '4294967294', '4294967295', 'x.y', 'p\\q', 'a.b\\.c', '', 'length', 'ü'];

  function gen(depth: number, pool: object[]): any {
    const leafs = [
      () => pick([0, -0, 1.5, -7, NaN, Infinity, -Infinity, 2 ** 53]),
      () => pick(['', 'str', 'with.dot', '\\']),
      () => pick([true, false, null, undefined]),
      () => BigInt(Math.floor(rand() * 1e9)),
      () => new Date(Math.floor(rand() * 2e12)),
      () => new Date(NaN),
      () => /re.?x/gi,
      () => new URL('https://e.com/a?b=c'),
      () => new Error('e'),
      () => new Point(1, 2),
      () => new Money('1', 'CZK'),
      () => sym,
      () => new Float64Array([1, NaN, -Infinity]),
      () => (pool.length ? pick(pool) : {}),
    ];
    if (depth <= 0 || rand() < 0.3) {
      return pick(leafs)();
    }

    const kind = pick(['object', 'array', 'map', 'set', 'sparse', 'nullproto', 'cycle']);
    let out: any;
    const n = Math.floor(rand() * 5);
    switch (kind) {
      case 'array':
      case 'sparse':
        out = [];
        for (let i = 0; i < n; i++) {
          if (kind === 'array' || rand() < 0.5) {
            out[i] = gen(depth - 1, pool);
          }
        }

        if (kind === 'sparse') {
          out.length = n + 1;
        }

        break;
      case 'map':
        out = new Map();
        for (let i = 0; i < n; i++) {
          out.set(rand() < 0.5 ? pick(keys) : gen(depth - 1, pool), gen(depth - 1, pool));
        }

        break;
      case 'set':
        out = new Set();
        for (let i = 0; i < n; i++) {
          out.add(gen(depth - 1, pool));
        }

        break;
      default:
        out = kind === 'nullproto' ? Object.create(null) : {};
        for (let i = 0; i < n; i++) {
          out[pick(keys)] = gen(depth - 1, pool);
        }

        if (kind === 'cycle') {
          out.self = out;
        }
    }

    pool.push(out);

    return out;
  }

  const setup = (sj: InstanceType<SuperJSONCtor>) => {
    sj.registerClass(Point, 'Point');
    sj.registerSymbol(sym, 'eq');
    sj.registerCustom<Money, string>(
      {
        isApplicable: (v): v is Money => v instanceof Money,
        serialize: v => `${v.amount} ${v.currency}`,
        deserialize: v => new Money(v.split(' ')[0], v.split(' ')[1]),
      },
      'money'
    );
  };

  const bigints = (_: string, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v);
  const attempt = (fn: () => string) => {
    try {
      return fn();
    } catch (error) {
      return `throws ${(error as Error).message}`;
    }
  };

  let failures = 0;
  const runs = options.runs;
  for (let i = 0; i < runs; i++) {
    const dedupe = rand() < 0.3;
    const registered = rand() < 0.7;
    const b = new Baseline({ dedupe });
    const c = new Current({ dedupe });
    if (registered) {
      setup(b);
      setup(c);
    }

    const startSeed = seed;
    const value = gen(4, []);
    const out = attempt(() => JSON.stringify(b.serialize(value), bigints));
    const outCurrent = attempt(() => JSON.stringify(c.serialize(value), bigints));
    let same = out === outCurrent;
    if (same && !out.startsWith('throws')) {
      const canon = (make: () => unknown) => attempt(() => JSON.stringify(b.serialize(make()), bigints));
      same =
        canon(() => b.deserialize(b.serialize(value))) === canon(() => c.deserialize(b.serialize(value))) &&
        canon(() => b.parse(b.stringify(value))) === canon(() => c.parse(b.stringify(value)));
    }

    if (!same) {
      failures++;
      if (failures <= 5) {
        log(`✗ run ${i} (seed ${startSeed}, dedupe ${dedupe}, registered ${registered})`);
        let at = 0;
        while (at < out.length && out[at] === outCurrent[at]) {
          at++;
        }

        const from = Math.max(0, at - 120);
        log(`  ${out === outCurrent ? 'deserialized values differ' : `serialized output differs at ${at}`}`);
        log(`  baseline: …${out.slice(from, at + 200)}`);
        log(`  current:  …${outCurrent.slice(from, at + 200)}`);
      }
    }
  }

  return failures;
}
