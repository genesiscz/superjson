import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { runEquivalence } from './equivalence-core.js';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    current: { type: 'string' },
    runs: { type: 'string', default: '20000' },
    seed: { type: 'string', default: '1' },
  },
});

const load = async (path: string) => (await import(pathToFileURL(path).href)).default;
const runs = Number(values.runs);
const failures = runEquivalence(
  await load(values.baseline!),
  await load(values.current!),
  { runs, seed: Number(values.seed) },
  line => console.error(line)
);
const engine = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`;
console.error(`${engine}: ${runs - failures}/${runs} identical`);
process.exit(failures ? 1 : 0);
