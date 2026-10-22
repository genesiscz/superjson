/**
 * Round-trips one value per feature through superjson (current src) and devalue, and prints ok, lossy or throws.
 * Run: bun benchmarks/devalue-features.ts
 */
import { isDeepStrictEqual } from 'node:util';
import { currentEntry, writeBundle } from './build.js';
import { parse, stringify } from 'devalue';

const SuperJSON = (await import(await writeBundle('probe-features', currentEntry, 'bun'))).default;

class Point {
  constructor(public x: number, public y: number) {}
}

const cyclic: Record<string, unknown> = { name: 'loop' };
cyclic.self = cyclic;
const shared = { id: 1 };

const cases: [string, unknown][] = [
  ['Date', new Date('2026-10-22T10:00:00.000Z')],
  ['undefined in object and array', { a: undefined, b: [undefined, 1] }],
  ['NaN, Infinity, -0', { n: NaN, i: Infinity, z: -0 }],
  ['BigInt', { big: 12345678901234567890n }],
  ['Map and Set', { m: new Map([[1, 'a']]), s: new Set([1, 2]) }],
  ['RegExp', /ab+c/gi],
  ['URL', new URL('https://example.com/a?b=1')],
  ['URLSearchParams', new URLSearchParams('a=1&b=2')],
  ['ArrayBuffer', new ArrayBuffer(4)],
  ['Uint8Array and Float64Array', { u: new Uint8Array([1, 2]), f: new Float64Array([1.5]) }],
  ['BigInt64Array', new BigInt64Array([1n, -1n])],
  ['Error with message', new Error('boom')],
  ['Error with cause', new Error('outer', { cause: new Error('inner') })],
  ['class instance (not registered)', new Point(1, 2)],
  ['symbol (unregistered)', { s: Symbol.for('app.key') }],
  ['cycle', cyclic],
  ['shared references', { a: shared, b: shared }],
  ['own __proto__ key', JSON.parse('{"__proto__": {"polluted": true}, "x": 1}')],
  ['sparse array', [1, , 3]],
  ['Promise', Promise.resolve(1)],
  ['Temporal.Instant', globalThis.Temporal ? globalThis.Temporal.Instant.from('2026-10-22T10:00:00Z') : 'no Temporal in this runtime'],
];

const rows: string[] = [];
for (const [name, value] of cases) {
  let sj: string;
  try {
    const sjs = new SuperJSON({ dedupe: true });
    const back = sjs.parse(sjs.stringify(value));
    sj = isDeepStrictEqual(back, value) ? 'ok' : 'lossy';
  } catch (error) {
    sj = `throws: ${(error as Error).message.split('\n')[0].slice(0, 70)}`;
  }
  let dv: string;
  try {
    const back = parse(stringify(value));
    dv = isDeepStrictEqual(back, value) ? 'ok' : 'lossy';
  } catch (error) {
    dv = `throws: ${(error as Error).message.split('\n')[0].slice(0, 70)}`;
  }
  rows.push(`${name}\t${sj}\t${dv}`);
}

const custom = { p: new Point(3, 4) };
let dvCustom: string;
try {
  const text = stringify(custom, { Point: (v: unknown) => v instanceof Point && [v.x, v.y] });
  const back = parse(text, { Point: ([x, y]: number[]) => new Point(x, y) });
  dvCustom = isDeepStrictEqual(back, custom) ? 'ok (reducer and reviver)' : 'lossy';
} catch (error) {
  dvCustom = `throws: ${(error as Error).message.split('\n')[0].slice(0, 70)}`;
}
let sjCustom: string;
try {
  const sjs = new SuperJSON();
  sjs.registerClass(Point);
  const back = sjs.parse(sjs.stringify(custom));
  sjCustom = isDeepStrictEqual(back, custom) ? 'ok (registerClass)' : 'lossy';
} catch (error) {
  sjCustom = `throws: ${(error as Error).message.split('\n')[0].slice(0, 70)}`;
}
rows.push(`custom class with registration (superjson) or reducer and reviver (devalue)\t${sjCustom}\t${dvCustom}`);

console.log(rows.join('\n'));
