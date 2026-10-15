import type SuperJSONClass from '../src/index.js';

export type SuperJSONCtor = typeof SuperJSONClass;
export type SuperJSONInstance = InstanceType<SuperJSONCtor>;

export interface Fixture {
  name: string;
  group: string;
  make: () => unknown;
  /** Registrations (classes, symbols, custom transformers) applied to every instance. */
  setup?: (sj: SuperJSONInstance) => void;
  dedupe?: boolean;
}

let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;

  return seed / 4294967296;
};
const int = (max: number) => Math.floor(rand() * max);
const word = () => rand().toString(36).slice(2, 2 + 3 + int(8));
const words = (n: number) => Array.from({ length: n }, word).join(' ');
const date = () => new Date(1_600_000_000_000 + int(200_000_000_000));

export class Point {
  constructor(public x: number, public y: number) {}
}

export class Money {
  constructor(public amount: string, public currency: string) {}
}

const sym = Symbol('bench-symbol');

const user = (i: number) => ({
  id: `user_${i}`,
  name: words(2),
  email: `${word()}@example.com`,
  age: 18 + int(60),
  active: rand() > 0.5,
  score: rand() * 1000,
  tags: [word(), word(), word()],
  address: { street: words(3), city: word(), zip: String(10000 + int(89999)) },
});

const deepChain = (depth: number, leaf: unknown) => {
  let node: any = { value: leaf };
  for (let i = 0; i < depth; i++) {
    node = { level: i, next: node };
  }

  return node;
};

export const fixtures: Fixture[] = [
  {
    name: 'toy example',
    group: 'classic',
    make: () => ({
      a: new Map<number, unknown>([
        [1, NaN],
        [2, null],
        [3, 'Hurray'],
      ]),
      r: /regexp/g,
      b: [new Set([1, 2, 3])],
    }),
  },
  {
    name: 'user graph',
    group: 'classic',
    make: () => ({
      users: new Map(
        ['abcde', 'dasdfa', 'hu-ha-hu', 'umphrey'].map((id, i) => [
          id,
          {
            id,
            created: new Date(2020 - i),
            friendIds: new Set(['a', 'b', 'c'].slice(0, 3 - (i % 3))),
          },
        ])
      ),
    }),
  },
  {
    name: 'deep nested dates (100×20)',
    group: 'classic',
    make: () =>
      Array.from({ length: 100 }, () => {
        const inner = () =>
          Array.from({ length: 10 }, () => ({
            createdAt: date(),
            updatedAt: date(),
            innerNested: { createdAt: date(), updatedAt: date() },
          }));

        return {
          createdAt: date(),
          updatedAt: date(),
          nested1: inner(),
          nested2: inner(),
        };
      }),
  },
  {
    name: 'plain JSON small (1 user)',
    group: 'plain',
    make: () => user(1),
  },
  {
    name: 'plain JSON 100 users',
    group: 'plain',
    make: () => Array.from({ length: 100 }, (_, i) => user(i)),
  },
  {
    name: 'plain JSON 1000 users',
    group: 'plain',
    make: () => Array.from({ length: 1000 }, (_, i) => user(i)),
  },
  {
    name: '10k numbers',
    group: 'plain',
    make: () => Array.from({ length: 10_000 }, () => rand() * 1e6),
  },
  {
    name: '10k strings',
    group: 'plain',
    make: () => Array.from({ length: 10_000 }, word),
  },
  {
    name: 'wide object 5k keys',
    group: 'plain',
    make: () =>
      Object.fromEntries(
        Array.from({ length: 5000 }, (_, i) => [`key_${i}`, i])
      ),
  },
  {
    name: 'big strings (10×100KB)',
    group: 'plain',
    make: () =>
      Array.from({ length: 10 }, () => 'x'.repeat(100_000) + word()),
  },
  {
    name: 'keys with dots and backslashes',
    group: 'plain',
    make: () =>
      Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [
          `a.b\\c.${i}`,
          { 'x.y': date(), 'p\\q': i },
        ])
      ),
  },
  {
    name: 'deep chain depth 500',
    group: 'deep',
    make: () => deepChain(500, 'leaf'),
  },
  {
    name: 'deep chain depth 200 + Date leaf',
    group: 'deep',
    make: () => deepChain(200, new Date(0)),
  },
  {
    name: '50 chains depth 50 + Date leaves',
    group: 'deep',
    make: () => Array.from({ length: 50 }, () => deepChain(50, date())),
  },
  {
    name: '1000 users with 2 Dates each',
    group: 'dates',
    make: () =>
      Array.from({ length: 1000 }, (_, i) => ({
        ...user(i),
        createdAt: date(),
        updatedAt: date(),
      })),
  },
  {
    name: '10k Dates array',
    group: 'dates',
    make: () => Array.from({ length: 10_000 }, date),
  },
  {
    name: 'undefined-heavy records (1000)',
    group: 'special',
    make: () =>
      Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        a: undefined,
        b: i % 2 ? undefined : 'x',
        c: undefined,
      })),
  },
  {
    name: 'NaN / ±Infinity / -0 (3000)',
    group: 'special',
    make: () =>
      Array.from({ length: 3000 }, (_, i) =>
        [NaN, Infinity, -Infinity, -0, i][i % 5]
      ),
  },
  {
    name: 'bigint array (1000)',
    group: 'special',
    make: () => Array.from({ length: 1000 }, (_, i) => BigInt(i) * 10n ** 20n),
  },
  {
    name: 'regexps (500)',
    group: 'special',
    make: () => Array.from({ length: 500 }, (_, i) => new RegExp(`a${i}b+`, 'gi')),
  },
  {
    name: 'URLs (500)',
    group: 'special',
    make: () =>
      Array.from({ length: 500 }, (_, i) => new URL(`https://ex.com/p/${i}?q=${i}`)),
  },
  {
    name: 'errors (200)',
    group: 'special',
    make: () =>
      Array.from({ length: 200 }, (_, i) =>
        i % 2 ? new Error(`boom ${i}`, { cause: 'x' }) : new TypeError(`t ${i}`)
      ),
  },
  {
    name: 'Float64Array 10k',
    group: 'typed',
    make: () => Float64Array.from({ length: 10_000 }, () => rand()),
  },
  {
    name: 'Uint8Array 64k',
    group: 'typed',
    make: () => Uint8Array.from({ length: 65_536 }, (_, i) => i & 255),
  },
  {
    name: 'Map<string, user> 1000',
    group: 'collections',
    make: () => new Map(Array.from({ length: 1000 }, (_, i) => [`k${i}`, user(i)])),
  },
  {
    name: 'Map<string, Date> 1000',
    group: 'collections',
    make: () => new Map(Array.from({ length: 1000 }, (_, i) => [`k${i}`, date()])),
  },
  {
    name: 'Map<Date, number> 300 (Date keys)',
    group: 'collections',
    make: () => new Map(Array.from({ length: 300 }, (_, i) => [date(), i])),
  },
  {
    name: 'Set<number> 5000',
    group: 'collections',
    make: () => new Set(Array.from({ length: 5000 }, (_, i) => i)),
  },
  {
    name: 'Set<object> 500',
    group: 'collections',
    make: () => new Set(Array.from({ length: 500 }, (_, i) => ({ id: i, at: date() }))),
  },
  {
    name: 'nested Map<string, Set<string>> 200×10',
    group: 'collections',
    make: () =>
      new Map(
        Array.from({ length: 200 }, (_, i) => [
          `k${i}`,
          new Set(Array.from({ length: 10 }, word)),
        ])
      ),
  },
  {
    name: 'shared refs: 1000 → 10 objects',
    group: 'references',
    make: () => {
      const shared = Array.from({ length: 10 }, (_, i) => ({ id: i, name: word() }));

      return Array.from({ length: 1000 }, (_, i) => ({ i, ref: shared[i % 10] }));
    },
  },
  {
    name: 'shared refs (dedupe): 1000 → 10 objects',
    group: 'references',
    dedupe: true,
    make: () => {
      const shared = Array.from({ length: 10 }, (_, i) => ({ id: i, name: word() }));

      return Array.from({ length: 1000 }, (_, i) => ({ i, ref: shared[i % 10] }));
    },
  },
  {
    name: 'self-reference cycles (200)',
    group: 'references',
    make: () =>
      Array.from({ length: 200 }, (_, i) => {
        const o: any = { i, at: date() };
        o.self = o;

        return o;
      }),
  },
  {
    name: 'registered class Point (1000)',
    group: 'registries',
    setup: sj => sj.registerClass(Point, 'Point'),
    make: () => Array.from({ length: 1000 }, (_, i) => new Point(i, i * 2)),
  },
  {
    name: 'custom transformer Money (1000)',
    group: 'registries',
    setup: sj =>
      sj.registerCustom<Money, string>(
        {
          isApplicable: (v): v is Money => v instanceof Money,
          serialize: v => `${v.amount} ${v.currency}`,
          deserialize: v => {
            const [amount, currency] = v.split(' ');

            return new Money(amount, currency);
          },
        },
        'money'
      ),
    make: () =>
      Array.from({ length: 1000 }, (_, i) => ({ id: i, price: new Money(`${i}.99`, 'CZK') })),
  },
  {
    name: 'plain 1000 users + custom transformer registered',
    group: 'registries',
    setup: sj =>
      sj.registerCustom<Money, string>(
        {
          isApplicable: (v): v is Money => v instanceof Money,
          serialize: v => `${v.amount} ${v.currency}`,
          deserialize: v => new Money(v.split(' ')[0], v.split(' ')[1]),
        },
        'money'
      ),
    make: () => Array.from({ length: 1000 }, (_, i) => user(i)),
  },
  {
    name: 'registered symbols (1000)',
    group: 'registries',
    setup: sj => sj.registerSymbol(sym, 'bench-symbol'),
    make: () => Array.from({ length: 1000 }, () => sym),
  },
  {
    name: 'tRPC-like page: 50 posts',
    group: 'realistic',
    make: () => ({
      items: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        title: words(6),
        body: words(80),
        createdAt: date(),
        updatedAt: rand() > 0.5 ? date() : undefined,
        author: { id: int(1000), name: words(2), joined: date() },
        tags: new Set(Array.from({ length: 4 }, word)),
        comments: Array.from({ length: 5 }, (_, j) => ({
          id: `${i}-${j}`,
          text: words(20),
          at: date(),
          likes: BigInt(int(1e6)),
        })),
      })),
      nextCursor: 'abc',
      total: 12345,
    }),
  },
  {
    name: 'dashboard: mixed everything',
    group: 'realistic',
    setup: sj => sj.registerClass(Point, 'Point'),
    make: () => ({
      generatedAt: date(),
      series: new Map(
        Array.from({ length: 20 }, (_, i) => [
          `s${i}`,
          Array.from({ length: 50 }, () => ({ at: date(), v: rand(), p: new Point(i, i) })),
        ])
      ),
      filters: new Set(['a', 'b', 'c']),
      pattern: /^ab+c$/i,
      link: new URL('https://example.com/x'),
      missing: undefined,
      ratio: NaN,
      big: 2n ** 70n,
    }),
  },
];
