import { $ } from 'bun';
import { join } from 'node:path';
import { BENCH, ROOT } from './build.js';

export type StepKind = 'reference' | 'baseline' | 'step' | 'rejected';

export interface StepMeta {
  id: string;
  sha: string;
  ref: string;
  kind: StepKind;
  subject: string;
  body: string;
  /** Short sha the diff is taken against. */
  parent: string | null;
  files: { path: string; added: number; removed: number }[];
  diff: string;
}

const git = async (...args: string[]) => (await $`git -C ${ROOT} ${args}`.quiet().text()).trim();

async function describe(ref: string, kind: StepKind, title?: string, parentRef?: string): Promise<StepMeta> {
  const sha = await git('rev-parse', '--short=10', ref);
  const [subject, ...body] = (await git('log', '-1', '--format=%s%n%b', sha)).split('\n');
  const parent = parentRef ? await git('rev-parse', '--short=10', parentRef) : null;
  const numstat = parent ? await git('diff', '--numstat', parent, sha, '--', 'src', 'package.json') : '';

  return {
    id: sha,
    sha,
    ref,
    kind,
    subject: title ?? subject,
    body: title ? `${ref}: ${subject}` : body.join('\n').trim(),
    parent,
    files: numstat
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [added, removed, path] = line.split('\t');

        return { path, added: Number(added), removed: Number(removed) };
      }),
    diff: parent ? await git('diff', parent, sha, '--', 'src', 'package.json') : '',
  };
}

/** The ordered step list from benchmarks/steps.json: references, baseline, kept steps, rejected ones after their parent. */
export async function resolveSteps(): Promise<StepMeta[]> {
  const config = await Bun.file(join(BENCH, 'steps.json')).json();
  const out: StepMeta[] = [];
  for (const r of config.references) {
    out.push(await describe(r.ref, 'reference', r.title));
  }

  out.push(await describe(config.baseline.ref, 'baseline', config.baseline.title));
  const kept = (await git('rev-list', '--reverse', config.steps)).split('\n').filter(Boolean);
  const rejected = await Promise.all(
    config.rejected.map((ref: string) => describe(ref, 'rejected', undefined, `${ref}~1`))
  );
  let previous = config.baseline.ref;
  for (const sha of kept) {
    out.push(await describe(sha, 'step', undefined, previous));
    previous = sha;
  }

  for (const r of rejected) {
    const at = out.findIndex(s => s.sha === r.parent);
    out.splice(at === -1 ? out.length : at + 1, 0, r);
  }

  return out;
}
