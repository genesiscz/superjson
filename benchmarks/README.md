# superjson benchmarks

A/B benchmarks: a git ref (the baseline, default `origin/main`) against the working tree `src/`.
Every case also checks that both versions produce byte-identical output.

```sh
bun benchmarks/server.ts                     # http://localhost:4173, the HTML runner
bun benchmarks/server.ts --baseline v2.2.5   # any git ref as the baseline
bun benchmarks/cli.ts --engine bun,node,chrome --filter dates,collections --ops serialize --time 500
```

- `fixtures.ts`: the data sets. `suite.ts`: cases, timing harness, output check.
- The page loads both versions as bundles built on request from the TypeScript source, so a
  reload picks up every edit in `src/`.
- The server sends COOP/COEP headers, so `performance.now()` has 5µs resolution in Chromium.
- "Profile" wraps one case in `console.profile()`; open DevTools before you click it.
- Results go to `benchmarks/.results/` (`latest-<engine>.json`).

## Results on this branch (2026-10-15 21:16, headless Chrome 155, Apple Silicon)

Baseline `origin/main` (`aaa65e36e8`), 200 cases, 0 with different output:

| | serialize | stringify | deserialize | parse | roundtrip | all |
|---|--:|--:|--:|--:|--:|--:|
| geomean speedup | 3.54× | 2.75× | 1.84× | 1.08× | 2.84× | 2.23× |

`RQ persisted cache ~400KB` against `v2.2.3`: stringify 9.62 ms → 2.17 ms, parse 2.02 ms → 1.56 ms.
