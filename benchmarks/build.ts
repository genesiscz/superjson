import { $ } from 'bun';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '..');
export const BENCH = import.meta.dir;
export const CACHE = join(BENCH, '.cache');

export interface BaselineInfo {
  ref: string;
  sha: string;
  entry: string;
}

/** Extracts `src/` of a git ref into benchmarks/.cache/baseline-<sha>/ (inside the repo, so node_modules resolves). */
export async function ensureBaseline(ref: string): Promise<BaselineInfo> {
  const sha = (await $`git -C ${ROOT} rev-parse --short=10 ${ref}`.text()).trim();
  const dir = join(CACHE, `baseline-${sha}`);
  const entry = join(dir, 'src', 'index.ts');
  if (!existsSync(entry)) {
    mkdirSync(dir, { recursive: true });
    await $`git -C ${ROOT} archive ${sha} src | tar -x -C ${dir}`;
  }

  return { ref, sha, entry };
}

export const currentEntry = join(ROOT, 'src', 'index.ts');

export async function bundle(
  entry: string,
  target: 'browser' | 'node' | 'bun',
  minify = false
): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entry],
    target,
    format: 'esm',
    minify,
    sourcemap: 'inline',
  });
  if (!result.success) {
    throw new AggregateError(result.logs, `bundle failed: ${entry}`);
  }

  return result.outputs[0].text();
}

export async function writeBundle(name: string, entry: string, target: 'browser' | 'node' | 'bun') {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${name}.js`);
  await Bun.write(file, await bundle(entry, target));

  return file;
}
