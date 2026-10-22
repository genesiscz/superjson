import { $ } from 'bun';
import { mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH, ROOT, bundle, currentEntry, ensureBaseline } from './build.js';
import { resolveSteps } from './ledger.js';

export interface ServerOptions {
  port: number;
  baselineRef: string;
  onResults?: (results: unknown) => void;
  onLedger?: (ledger: unknown) => void;
}

// Cross-origin isolation lifts the performance.now() clamp from 100µs to 5µs in Chromium.
const headers = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const js = (code: string) =>
  new Response(code, { headers: { ...headers, 'Content-Type': 'text/javascript' } });

export async function startServer({ port, baselineRef, onResults, onLedger }: ServerOptions) {
  const baseline = await ensureBaseline(baselineRef);
  const resultsDir = join(BENCH, '.results');
  const ledgersDir = join(resultsDir, 'ledgers');
  const compareDir = join(resultsDir, 'compare');
  mkdirSync(ledgersDir, { recursive: true });
  const savedFile = async (dir: string, encoded: string) => {
    const name = basename(decodeURIComponent(encoded));
    const file = Bun.file(join(dir, name));

    return name.endsWith('.json') && (await file.exists())
      ? new Response(file, { headers: { ...headers, 'Content-Type': 'application/json' } })
      : new Response('not found', { status: 404, headers });
  };

  return Bun.serve({
    port,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      try {
        if (pathname.startsWith('/api/results/')) {
          return savedFile(resultsDir, pathname.slice('/api/results/'.length));
        }

        if (pathname.startsWith('/api/ledgers/')) {
          return savedFile(ledgersDir, pathname.slice('/api/ledgers/'.length));
        }

        const libRef = pathname.match(/^\/lib\/ref\/([0-9a-f]{7,40})\.js$/);
        if (libRef) {
          return js(await bundle((await ensureBaseline(libRef[1])).entry, 'browser'));
        }

        switch (pathname) {
          case '/':
            return new Response(Bun.file(join(BENCH, 'index.html')), { headers });
          case '/steps':
            return new Response(Bun.file(join(BENCH, 'steps.html')), { headers });
          case '/steps.js':
            return js(await bundle(join(BENCH, 'steps-app.ts'), 'browser'));
          case '/compare':
            return new Response(Bun.file(join(BENCH, 'compare.html')), { headers });
          case '/compare.js':
            return js(await bundle(join(BENCH, 'compare-app.ts'), 'browser'));
          case '/lib/devalue.js':
            return js(await bundle(join(BENCH, 'devalue-lib.ts'), 'browser'));
          case '/api/compare/libs': {
            const ours = (await $`git -C ${ROOT} rev-parse perf/faster-serialize`.text()).trim();
            const raw = (await $`git -C ${ROOT} rev-list -n 1 v2.2.3`.text()).trim();
            const devalueVersion = JSON.parse(await Bun.file(join(ROOT, 'node_modules/devalue/package.json')).text()).version;

            return Response.json(
              [
                { id: 'raw', label: 'superjson 2.2.3 (col-web)', url: `/lib/ref/${raw}.js`, sha: raw, ref: 'v2.2.3', kind: 'baseline', subject: 'superjson 2.2.3, the version col-web ships' },
                { id: 'base', label: 'superjson origin/main', url: `/lib/ref/${baseline.sha}.js`, sha: baseline.sha, ref: baseline.ref, kind: 'reference', subject: 'superjson origin/main (2.2.5)' },
                { id: 'ours', label: 'superjson PR #364', url: `/lib/ref/${ours}.js`, sha: ours, ref: 'perf/faster-serialize', kind: 'step', subject: 'superjson perf/faster-serialize (PR #364)' },
                { id: 'devalue', label: `devalue ${devalueVersion}`, url: '/lib/devalue.js', sha: `devalue@${devalueVersion}`, ref: `npm devalue ${devalueVersion}`, kind: 'lib', subject: `devalue ${devalueVersion} through a SuperJSON-shaped adapter` },
              ],
              { headers }
            );
          }
          case '/api/compare': {
            const body = await req.json();
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const name = `${stamp}-x${body.throttle ?? 1}.json`;
            mkdirSync(compareDir, { recursive: true });
            await Bun.write(join(compareDir, name), JSON.stringify(body));
            onLedger?.(body);

            return Response.json({ ok: true, name }, { headers });
          }
          case '/api/steps':
            return Response.json(await resolveSteps(), { headers });
          case '/api/ledgers': {
            if (req.method === 'POST') {
              const body = await req.json();
              const stamp = new Date().toISOString().replace(/[:.]/g, '-');
              const name = `${stamp}-x${body.throttle ?? 1}.json`;
              await Bun.write(join(ledgersDir, name), JSON.stringify(body));
              onLedger?.(body);

              return Response.json({ ok: true, name }, { headers });
            }

            const ledgers = await Promise.all(
              readdirSync(ledgersDir)
                .filter(name => name.endsWith('.json'))
                .map(async name => {
                  const ledger = await Bun.file(join(ledgersDir, name)).json();

                  return {
                    name,
                    engine: ledger.engine,
                    throttle: ledger.throttle,
                    series: ledger.series ?? null,
                    run: ledger.run ?? null,
                    cases: ledger.cases.length,
                    steps: ledger.steps.length,
                  };
                })
            );

            return Response.json(ledgers.sort((a, b) => b.name.localeCompare(a.name)), { headers });
          }
          case '/app.js':
            return js(await bundle(join(BENCH, 'app.ts'), 'browser'));
          case '/lib/current.js':
            return js(await bundle(currentEntry, 'browser'));
          case '/lib/baseline.js':
            return js(await bundle(baseline.entry, 'browser'));
          case '/api/info': {
            const head = (await $`git -C ${ROOT} rev-parse --short=10 HEAD`.text()).trim();
            const dirty = (await $`git -C ${ROOT} status --porcelain src`.text()).trim() !== '';

            return Response.json(
              { baseline: { ref: baseline.ref, sha: baseline.sha }, current: { head, dirty } },
              { headers }
            );
          }
          case '/api/results': {
            if (req.method === 'GET') {
              const runs = await Promise.all(
                readdirSync(resultsDir)
                  .filter(name => name.endsWith('.json') && !name.startsWith('latest-'))
                  .map(async name => {
                    const run = await Bun.file(join(resultsDir, name)).json();

                    return {
                      name,
                      engine: run.engine,
                      baseline: run.info?.baseline ?? null,
                      cases: run.results?.length ?? 0,
                    };
                  })
              );

              return Response.json(runs.sort((a, b) => b.name.localeCompare(a.name)), { headers });
            }

            if (req.method !== 'POST') {
              break;
            }

            const body = await req.json();
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            await Bun.write(join(resultsDir, `${stamp}-browser.json`), JSON.stringify(body, null, 2));
            await Bun.write(join(resultsDir, 'latest-browser.json'), JSON.stringify(body, null, 2));
            onResults?.(body);

            return Response.json({ ok: true }, { headers });
          }
        }
      } catch (error) {
        console.error(error);

        return new Response(String(error), { status: 500, headers });
      }

      return new Response('not found', { status: 404, headers });
    },
  });
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: process.env.PORT ?? '4173' },
      baseline: { type: 'string', default: 'origin/main' },
    },
  });
  const server = await startServer({ port: Number(values.port), baselineRef: values.baseline! });
  console.log(`superjson benchmarks: ${server.url}  (baseline ${values.baseline} vs working tree src/)`);
}
