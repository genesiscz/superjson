import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CACHE } from './build.js';
import { startServer } from './server.js';

const BROWSERS: Record<string, string> = {
  brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
};

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'brave' },
    throttle: { type: 'string', default: '4' },
    filter: { type: 'string', default: 'RQ persisted' },
    ops: { type: 'string', default: 'stringify,parse,serialize,deserialize' },
    time: { type: 'string', default: '6000' },
    headed: { type: 'boolean', default: false },
  },
});

const rate = Number(values.throttle);
const { promise: ledgerPosted, resolve } = Promise.withResolvers<any>();
const server = await startServer({ port: 0, baselineRef: 'origin/main', onLedger: resolve });

const profile = join(CACHE, `${values.browser}-ledger-profile`);
mkdirSync(profile, { recursive: true });
const portFile = join(profile, 'DevToolsActivePort');
const launchedAt = Date.now();
const browser = Bun.spawn(
  [
    BROWSERS[values.browser!],
    ...(values.headed ? [] : ['--headless=new']),
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' }
);

let port = 0;
for (let i = 0; i < 100 && !port; i++) {
  await Bun.sleep(100);
  try {
    if (statSync(portFile).mtimeMs >= launchedAt - 1000) {
      port = Number((await Bun.file(portFile).text()).split('\n')[0]);
    }
  } catch {}
}

if (!port) {
  browser.kill();
  throw new Error('the browser did not open a DevTools port');
}

const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let nextId = 1;
const pending = new Map<number, (msg: any) => void>();
ws.onmessage = event => {
  const msg = JSON.parse(String(event.data));
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
};
const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
  new Promise((ok, fail) => {
    const id = nextId++;
    pending.set(id, msg => (msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result)));
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const loopMs = async () =>
  (
    await send(
      'Runtime.evaluate',
      {
        expression:
          '(() => { const s = performance.now(); let x = 0; for (let i = 0; i < 3e7; i++) x = (x + (i & 7)) | 0; globalThis.__x = x; return performance.now() - s; })()',
        returnByValue: true,
      },
      sessionId
    )
  ).result.value as number;

await loopMs();
const unthrottled = await loopMs();
await send('Emulation.setCPUThrottlingRate', { rate }, sessionId);
const throttled = await loopMs();
console.error(
  `# ${values.browser}: fixed loop ${unthrottled.toFixed(0)} ms unthrottled, ${throttled.toFixed(0)} ms at rate ${rate} (${(throttled / unthrottled).toFixed(2)}× measured)`
);

const url = new URL('/steps', server.url);
url.search = new URLSearchParams({
  run: '1',
  throttle: String(rate),
  filter: values.filter!,
  ops: values.ops!,
  time: values.time!,
}).toString();
await send('Page.navigate', { url: url.href }, sessionId);
console.error(`# running ${url.href}`);

const ledger = await ledgerPosted;
ws.close();
browser.kill();
server.stop(true);

const { steps, cases } = ledger;
const base = steps.findIndex((s: any) => s.kind === 'baseline');
for (const c of cases) {
  console.error(`\n${c.fixture} · ${c.op}`);
  steps.forEach((s: any, i: number) => {
    const r = c.results[i];
    console.error(
      `  ${String(i).padStart(2)} ${s.kind.padEnd(9)} ${s.sha} ${r.ms.toFixed(2).padStart(8)} ms  ${(c.results[base].ms / r.ms).toFixed(2)}×${r.identical ? '' : '  ✗ OUTPUT DIFFERS'}  ${s.subject.slice(0, 70)}`
    );
  });
}
