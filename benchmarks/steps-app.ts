import type { SuperJSONCtor } from './fixtures.js';
import type { StepMeta } from './ledger.js';
import { type Op, type StepResult, runSteps, selectCases } from './suite.js';

interface LedgerCase {
  id: string;
  fixture: string;
  group: string;
  op: Op;
  bytes: number;
  results: StepResult[];
}

interface Ledger {
  createdAt: string;
  engine: string;
  throttle: number;
  calibrationMs: number;
  crossOriginIsolated: boolean;
  timeMs: number;
  steps: StepMeta[];
  cases: LedgerCase[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
const fmtMs = (ms: number) => (ms === 0 ? '0' : ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms >= 1 ? ms.toFixed(2) : ms.toFixed(3));
const engineName = (ua: string) => ua.match(/(HeadlessChrome|Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? ua;
const brand = (ua: string) => (/Brave/.test(ua) ? 'Brave ' : '') + engineName(ua);

let ledger: Ledger | null = null;
let selectedCase = 0;
let selectedStep: number | null = null;

/** Step number as shown: 1 for the first commit after the baseline; references show their role. */
const stepLabel = (steps: StepMeta[], i: number) => {
  const s = steps[i];
  if (s.kind === 'reference') {
    return 'ref';
  }

  if (s.kind === 'baseline') {
    return 'base';
  }

  return String(i - steps.filter(x => x.kind === 'reference' || x.kind === 'baseline').length + 1);
};

/** Index of the step a step is compared against: its git parent among the measured steps. */
const parentIndex = (steps: StepMeta[], i: number) =>
  steps[i].parent ? steps.findIndex(s => s.sha === steps[i].parent) : -1;
const baselineIndex = (steps: StepMeta[]) => steps.findIndex(s => s.kind === 'baseline');
const lastKeptIndex = (steps: StepMeta[]) => {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind === 'step') {
      return i;
    }
  }

  return baselineIndex(steps);
};

function delta(c: LedgerCase, steps: StepMeta[], i: number) {
  const p = parentIndex(steps, i);
  if (p < 0) {
    return '';
  }

  const change = c.results[i].ms / c.results[p].ms - 1;
  if (Math.abs(change) < 0.03) {
    return `<span class="small">${change >= 0 ? '+' : ''}${(change * 100).toFixed(0)}%</span>`;
  }

  return change < 0
    ? `<span class="good">▼ ${(change * 100).toFixed(0)}%</span>`
    : `<span class="critical">▲ +${(change * 100).toFixed(0)}%</span>`;
}

function renderChart() {
  const svg = $('chart') as unknown as SVGSVGElement;
  const tooltip = $('tooltip');
  if (!ledger) {
    svg.innerHTML = '';
    return;
  }

  const { steps } = ledger;
  const c = ledger.cases[selectedCase];
  const width = svg.clientWidth || 900;
  const height = 300;
  const pad = { top: 28, right: 12, bottom: 30, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...c.results.map(r => r.ms * (1 + r.rme / 100))) * 1.08;
  const y = (ms: number) => pad.top + plotH - (ms / max) * plotH;
  const slot = plotW / steps.length;
  const barW = Math.max(6, Math.min(36, slot - 2));
  const ticks = 4;
  const base = baselineIndex(steps);

  let out = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface-1)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--reference)" stroke-width="2.5"/></pattern></defs>`;
  for (let t = 0; t <= ticks; t++) {
    const v = (max / ticks) * t;
    out += `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)" />`;
    out += `<text x="${pad.left - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">${fmtMs(v)} ms</text>`;
  }

  if (base >= 0) {
    const by = y(c.results[base].ms);
    out += `<line x1="${pad.left}" x2="${width - pad.right}" y1="${by}" y2="${by}" stroke="var(--text-muted)" stroke-dasharray="4 4" />`;
  }

  steps.forEach((s, i) => {
    const r = c.results[i];
    const x = pad.left + slot * i + (slot - barW) / 2;
    const top = y(r.ms);
    const h = Math.max(1, pad.top + plotH - top);
    const fill = s.kind === 'step' ? 'var(--series-1)' : s.kind === 'rejected' ? 'url(#hatch)' : 'var(--reference)';
    const stroke = s.kind === 'rejected' ? 'var(--reference)' : 'none';
    const rx = Math.min(4, barW / 2);
    out += `<path d="M${x},${top + h} V${top + rx} Q${x},${top} ${x + rx},${top} H${x + barW - rx} Q${x + barW},${top} ${x + barW},${top + rx} V${top + h} Z" fill="${fill}" stroke="${stroke}" ${selectedStep === i ? 'stroke-width="2" style="stroke: var(--text-primary)"' : ''} />`;
    const e = (r.ms * r.rme) / 100;
    out += `<line x1="${x + barW / 2}" x2="${x + barW / 2}" y1="${y(r.ms + e)}" y2="${y(Math.max(0, r.ms - e))}" stroke="var(--text-secondary)" />`;
    out += `<text x="${x + barW / 2}" y="${height - 12}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${stepLabel(steps, i)}</text>`;
    if (i === base || i === lastKeptIndex(steps)) {
      out += `<text x="${x + barW / 2}" y="${top - 6}" text-anchor="middle" font-size="11" fill="var(--text-primary)">${fmtMs(r.ms)}</text>`;
    }

    out += `<rect class="hit" data-i="${i}" x="${pad.left + slot * i}" y="${pad.top}" width="${slot}" height="${plotH}" fill="transparent" />`;
  });

  svg.innerHTML = out;
  svg.querySelectorAll<SVGRectElement>('rect.hit').forEach(hit => {
    const i = Number(hit.dataset.i);
    hit.onmousemove = event => {
      const s = steps[i];
      const r = c.results[i];
      const vsBase = base >= 0 ? `${(c.results[base].ms / r.ms).toFixed(2)}× vs baseline` : '';
      tooltip.innerHTML = `<b>${s.kind === 'step' || s.kind === 'rejected' ? `#${stepLabel(steps, i)} ` : ''}${esc(s.subject)}</b><br><code>${s.sha}</code> · ${s.kind}<br>${fmtMs(r.ms)} ms ±${r.rme.toFixed(1)}% · ${vsBase}<br>${delta(c, steps, i) || ''}${r.identical ? '' : '<br><span class="critical">✗ output differs from baseline</span>'}`;
      const box = (svg.parentElement as HTMLElement).getBoundingClientRect();
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(event.clientX - box.left + 12, box.width - 370)}px`;
      tooltip.style.top = `${event.clientY - box.top + 12}px`;
    };
    hit.onmouseleave = () => (tooltip.style.display = 'none');
    hit.onclick = () => selectStep(i);
  });
}

function diffHtml(diff: string) {
  return diff
    .split('\n')
    .map(line => {
      const cls = line.startsWith('diff --git')
        ? 'file'
        : line.startsWith('@@')
          ? 'hunk'
          : line.startsWith('+') && !line.startsWith('+++')
            ? 'add'
            : line.startsWith('-') && !line.startsWith('---')
              ? 'del'
              : '';

      return `<span class="${cls}">${esc(line) || ' '}</span>`;
    })
    .join('');
}

function renderLedger() {
  const table = $('ledger');
  if (!ledger) {
    table.innerHTML = '';
    return;
  }

  const { steps } = ledger;
  const c = ledger.cases[selectedCase];
  const base = baselineIndex(steps);
  let html = `<tr><th>#</th><th>Kind</th><th>Commit</th><th>What changed</th><th>Files</th><th class="num">${esc(c.op)} ms</th><th class="num">Δ</th><th class="num">vs baseline</th><th>Same output (all cases)</th></tr>`;
  steps.forEach((s, i) => {
    const r = c.results[i];
    const same = ledger!.cases.every(x => x.results[i].identical);
    const files = s.files.map(f => `${f.path.replace('src/', '')} <span class="good">+${f.added}</span> <span class="critical">−${f.removed}</span>`).join('<br>');
    html += `<tr class="step-row ${s.kind} ${selectedStep === i ? 'selected' : ''}" data-i="${i}">
      <td>${s.kind === 'step' || s.kind === 'rejected' ? stepLabel(steps, i) : ''}</td>
      <td><span class="badge ${s.kind}">${s.kind}</span></td>
      <td><code>${s.sha}</code></td>
      <td class="subject">${esc(s.subject.replace(/^perf: /, '').replace(/ \(rejected\)$/, ''))}</td>
      <td class="small">${files}</td>
      <td class="num">${fmtMs(r.ms)} <span class="small">±${r.rme.toFixed(1)}%</span></td>
      <td class="num">${delta(c, steps, i)}</td>
      <td class="num">${base >= 0 ? `${(c.results[base].ms / r.ms).toFixed(2)}×` : ''}</td>
      <td>${same ? '✓' : '<span class="critical">✗ differs</span>'}</td></tr>`;
    if (selectedStep === i) {
      html += `<tr><td></td><td colspan="8"><pre class="body">${esc(s.body)}</pre>${s.diff ? `<pre class="diff">${diffHtml(s.diff)}</pre>` : ''}</td></tr>`;
    }
  });
  table.innerHTML = html;
  table.querySelectorAll<HTMLTableRowElement>('tr.step-row').forEach(tr => {
    tr.onclick = () => selectStep(Number(tr.dataset.i));
  });
}

function renderMatrix() {
  const table = $('matrix');
  if (!ledger) {
    table.innerHTML = '';
    return;
  }

  const { steps } = ledger;
  const base = baselineIndex(steps);
  const last = lastKeptIndex(steps);
  let html = `<tr><th>Case</th>${steps
    .map((s, i) => `<th class="stepcol" title="${esc(s.subject)}">${stepLabel(steps, i)}${s.kind === 'rejected' ? '✗' : ''}</th>`)
    .join('')}<th class="num">total</th></tr>`;
  ledger.cases.forEach((c, ci) => {
    html += `<tr class="${ci === selectedCase ? 'selected' : ''}"><td><a href="#" data-case="${ci}">${esc(c.fixture)} · ${c.op}</a></td>${c.results
      .map((r, i) => `<td class="cell">${fmtMs(r.ms)}${r.identical ? '' : '<span class="critical">✗</span>'}<br>${delta(c, steps, i)}</td>`)
      .join('')}<td class="num"><b>${(c.results[base].ms / c.results[last].ms).toFixed(2)}×</b></td></tr>`;
  });
  table.innerHTML = html;
  table.querySelectorAll<HTMLAnchorElement>('a[data-case]').forEach(a => {
    a.onclick = event => {
      event.preventDefault();
      selectCase(Number(a.dataset.case));
    };
  });
}

function selectCase(i: number) {
  selectedCase = i;
  $<HTMLSelectElement>('case').value = String(i);
  renderAll();
}

function selectStep(i: number) {
  selectedStep = selectedStep === i ? null : i;
  renderAll();
}

function renderAll() {
  renderChart();
  renderLedger();
  renderMatrix();
}

function show(next: Ledger, label: string) {
  ledger = next;
  const caseSelect = $<HTMLSelectElement>('case');
  caseSelect.replaceChildren(...next.cases.map((c, i) => new Option(`${c.fixture} · ${c.op} (${(c.bytes / 1024).toFixed(0)} KB JSON)`, String(i))));
  const preferred = next.cases.findIndex(c => c.fixture.startsWith('RQ') && c.op === 'stringify');
  selectedCase = preferred >= 0 ? preferred : 0;
  caseSelect.value = String(selectedCase);
  caseSelect.onchange = () => selectCase(Number(caseSelect.value));
  const when = new Date(next.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  $('runInfo').textContent =
    `${label} · ${when} · ${brand(next.engine)} · CPU throttle ${next.throttle}× · ` +
    `fixed loop ${next.calibrationMs.toFixed(0)} ms · ${next.cases.length} cases × ${next.steps.length} versions`;
  renderAll();
}

async function listLedgers() {
  const list: { name: string; engine: string; throttle: number; cases: number; steps: number }[] = await (await fetch('/api/ledgers')).json();
  $<HTMLSelectElement>('ledgers').replaceChildren(
    ...list.map(l => {
      const iso = l.name.slice(0, 24).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
      const when = new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

      return new Option(`${when} · ${brand(l.engine)} · ${l.throttle}× CPU · ${l.cases} cases`, l.name);
    })
  );

  return list;
}

async function loadLedger(name: string) {
  show(await (await fetch(`/api/ledgers/${encodeURIComponent(name)}`)).json(), 'saved run');
}

function calibrate() {
  const start = performance.now();
  let x = 0;
  for (let i = 0; i < 3e7; i++) {
    x = (x + (i & 7)) | 0;
  }

  (globalThis as any).__sink = x;

  return performance.now() - start;
}

async function runLedger(opts: { filter: string; ops: Op[]; timeMs: number; throttle: number }) {
  const status = $('status');
  status.textContent = 'loading versions…';
  const steps: StepMeta[] = await (await fetch('/api/steps')).json();
  const versions: SuperJSONCtor[] = await Promise.all(
    steps.map(async s => (await import(/* @vite-ignore */ `/lib/ref/${s.sha}.js`)).default)
  );
  const reference = baselineIndex(steps);
  const selected = selectCases(opts.filter, opts.ops);
  const calibrationMs = calibrate();
  const cases: LedgerCase[] = [];
  const started = performance.now();
  for (const [i, c] of selected.entries()) {
    status.textContent = `${i + 1}/${selected.length} ${c.id}`;
    const { bytes, results } = await runSteps(versions, reference, c, { timeMs: opts.timeMs, minSampleMs: 25 });
    cases.push({ id: c.id, fixture: c.fixture.name, group: c.fixture.group, op: c.op, bytes, results });
  }

  const next: Ledger = {
    createdAt: new Date().toISOString(),
    engine: navigator.userAgent + ((navigator as any).brave ? ' Brave' : ''),
    throttle: opts.throttle,
    calibrationMs,
    crossOriginIsolated,
    timeMs: opts.timeMs,
    steps,
    cases,
  };
  const saved = await (await fetch('/api/ledgers', { method: 'POST', body: JSON.stringify(next) })).json();
  status.textContent = `done in ${((performance.now() - started) / 1000).toFixed(0)} s, saved as ${saved.name}`;
  await listLedgers();
  $<HTMLSelectElement>('ledgers').value = saved.name;
  show(next, 'this run');
}

$('load').onclick = () => loadLedger($<HTMLSelectElement>('ledgers').value);
$('run').onclick = () =>
  runLedger({
    filter: $<HTMLInputElement>('filter').value,
    ops: $<HTMLInputElement>('ops').value.split(',').map(s => s.trim()) as Op[],
    timeMs: Number($<HTMLInputElement>('time').value),
    throttle: Number($<HTMLInputElement>('throttle').value),
  });
window.addEventListener('resize', () => renderChart());

const saved = await listLedgers();
if (params.has('run')) {
  await runLedger({
    filter: params.get('filter') ?? 'RQ persisted',
    ops: (params.get('ops') ?? 'stringify,parse,serialize,deserialize').split(',') as Op[],
    timeMs: Number(params.get('time') ?? 6000),
    throttle: Number(params.get('throttle') ?? 1),
  });
} else if (params.has('ledger')) {
  await loadLedger(params.get('ledger')!);
} else if (saved.length) {
  await loadLedger(saved[0].name);
}
