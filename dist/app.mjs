import {reconcile, pairMatrix, csv, round2} from './engine.mjs';
import {sampleLines, rates, closeDate, entities, categories} from './data.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const codes = entities.map(e => e.code);
const fresh = () => ({view: 'overview', tolerance: 1000, pair: '', status: 'all', entity: 'all'});
let state = fresh();
let cache = null;
function result() {
  if (!cache || cache.tolerance !== state.tolerance) {
    const r = reconcile(sampleLines, {rates, closeDate, tolerance: state.tolerance});
    cache = {tolerance: state.tolerance, r, matrix: pairMatrix(r, codes)};
  }
  return cache;
}

const num = (n, d = 2) => new Intl.NumberFormat('en-GB', {minimumFractionDigits: d, maximumFractionDigits: d}).format(n);
const eur = (n, d = 0) => (n < 0 ? '−€' : '€') + num(Math.abs(n), d);
const signedEur = n => (n > 0 ? '+' : '') + eur(n);
const signedNum = n => (n < 0 ? '−' : n > 0 ? '+' : '') + num(Math.abs(n));
const date = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'});
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
function download(name, body) { const url = URL.createObjectURL(new Blob([body], {type: 'text/csv;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
const head = (kicker, title, sub, action = '') => `<div class="pagehead"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="sub">${sub}</p></div>${action}</div>`;
const metric = (label, value, meta, accent = false) => `<div class="metric ${accent ? 'accent' : ''}"><div class="label">${label}</div><div class="value">${value}</div><div class="meta">${meta}</div></div>`;
const button = (label, action, cls = '') => `<button class="button ${cls}" data-action="${action}">${label}</button>`;
const pairLabel = (c, d) => `${c} → ${d}`;
const statusPill = s => `<span class="pill ${s === 'Open' ? 'red' : 'amber'}">${s}</span>`;
const kindHelp = {
  'Unmatched': 'Booked by one side only.',
  'Amount difference': 'Both sides booked the document; the amounts differ.',
  'FX translation': 'Amounts agree in transaction currency; the local-currency values translate to different EUR amounts.',
};

function overview() {
  const {r, matrix} = result(), s = r.summary;
  const cell = c => {
    if (!c) return '<td class="mx-none" aria-label="No intercompany balance">—</td>';
    const label = c.status === 'matched' ? '✓ Matched' : signedEur(c.diffEUR);
    const sub = c.status === 'matched' ? `${eur(c.balanceEUR)} balance` : `${c.open ? `${c.open} open` : ''}${c.open && c.tolerance ? ' · ' : ''}${c.tolerance ? `${c.tolerance} in tolerance` : ''}`;
    return `<td><button class="mx mx-${c.status}" data-pair="${c.creditor}>${c.debtor}" aria-label="${pairLabel(c.creditor, c.debtor)}: ${esc(label)}"><strong>${label}</strong><small>${sub}</small></button></td>`;
  };
  return head('STEP 01 / PAIR MATRIX', 'Every intercompany pair, reconciled.', `Halmrode Industrial Group · close ${date(closeDate)} · ${s.lines} lines from six entities in five currencies`, `<div class="actions">${button('Review exceptions →', 'go-exceptions')}</div>`) + `
<div class="metrics">${metric('Lines matched automatically', `${s.matchedLines} of ${s.lines}`, `${num(s.matchRate * 100, 1)}% across three matching passes`, true)}${metric('Open exceptions', String(s.open), `${s.withinTolerance} more within the ${eur(state.tolerance)} tolerance`)}${metric('Gross difference', eur(s.grossEUR), 'All exceptions, EUR at closing rates')}${metric('Entities', '6', '5 currencies · 5 local GAAPs')}</div>
<section class="card"><div class="cardhead"><h2>Pair matrix</h2><span class="pill neutral">EUR at closing rates</span></div>
<p class="small muted" style="margin-top:-6px">Rows are who is owed; columns are who owes. Each cell is the creditor's receivable minus the debtor's payable, across all account types. Select a cell to see its exceptions.</p>
<div class="tablewrap"><table class="matrix"><thead><tr><th>Owed to ↓ · Owed by →</th>${codes.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${codes.map((c, i) => `<tr><th scope="row">${c}<small>${esc(entities[i].currency)} · ${esc(entities[i].gaap)}</small></th>${matrix[i].map((x, j) => (i === j ? '<td class="mx-self"></td>' : cell(x))).join('')}</tr>`).join('')}</tbody></table></div>
<div class="legend mxlegend"><span><i class="lg lg-matched"></i>Matched</span><span><i class="lg lg-tolerance"></i>Within tolerance only</span><span><i class="lg lg-open"></i>Open exceptions</span><span><i class="lg lg-none"></i>No balance</span></div></section>
<section class="card"><div class="cardhead"><h2>How the lines matched</h2></div><div class="tablewrap"><table><thead><tr><th>Pass</th><th>Rule</th><th class="num">Pairs matched</th></tr></thead><tbody>
<tr><td>1 · Exact</td><td>Same pair, account type, document, currency and amount</td><td class="num">${s.byPass[0]}</td></tr>
<tr><td>2 · Close</td><td>Same pair, account type, document and currency; amounts differ</td><td class="num">${s.byPass[1]}</td></tr>
<tr><td>3 · No reference</td><td>Same pair, account type, currency and amount within 5 days; documents differ</td><td class="num">${s.byPass[2]}</td></tr>
<tr><td>Translation check</td><td>Local-currency balances, translated to EUR, must agree once the differences above are explained</td><td class="num">${r.exceptions.filter(e => e.kind === 'FX translation').length} flagged</td></tr></tbody></table></div></section>`;
}

function exceptions() {
  const {r} = result();
  const rows = r.exceptions.filter(e => (!state.pair || `${e.creditor}>${e.debtor}` === state.pair) && (state.status === 'all' || e.status === state.status));
  const pairs = [...new Set(r.exceptions.map(e => `${e.creditor}>${e.debtor}`))];
  const total = rows.reduce((t, e) => t + e.eur, 0);
  return head('STEP 02 / EXCEPTIONS', 'Every difference, with the document behind it.', `${r.summary.open} open and ${r.summary.withinTolerance} within tolerance. Amounts are the creditor's view minus the debtor's.`, `<div class="actions">${button('Download exceptions CSV', 'export-exceptions', 'secondary')}</div>`) + `
<section class="card"><div class="toolbar"><div class="field"><label for="pairFilter">Pair</label><select id="pairFilter" data-control="pair"><option value="">All pairs</option>${pairs.map(p => `<option value="${p}" ${state.pair === p ? 'selected' : ''}>${pairLabel(...p.split('>'))}</option>`).join('')}</select></div><div class="field"><label for="statusFilter">Status</label><select id="statusFilter" data-control="status"><option value="all">All</option><option value="Open" ${state.status === 'Open' ? 'selected' : ''}>Open</option><option value="Within tolerance" ${state.status === 'Within tolerance' ? 'selected' : ''}>Within tolerance</option></select></div></div>
${rows.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Pair</th><th>Type</th><th>Document</th><th>Booked by</th><th class="num">Difference</th><th class="num">Age</th><th>Status</th></tr></thead><tbody>${rows.map(e => `<tr><td>${e.id}</td><td>${pairLabel(e.creditor, e.debtor)}</td><td>${e.kind}<small class="cellnote">${esc(categories[e.category])}</small></td><td><span class="mono">${esc(e.doc)}</span><small class="cellnote">${esc(e.desc)}</small></td><td>${e.kind === 'Unmatched' ? `${e.foundIn} only<small class="cellnote">missing in ${e.missingIn}</small>` : `<span class="cellwrap">${esc(e.foundIn)}</span>`}</td><td class="num"><span class="${e.status === 'Open' ? 'diff' : ''}">${signedEur(e.eur)}</span><small class="cellnote right">${e.cur} ${signedNum(e.diffTC)}</small></td><td class="num">${e.age} d</td><td>${statusPill(e.status)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5">Net of rows shown</td><td class="num">${signedEur(total)}</td><td colspan="2"></td></tr></tfoot></table></div>` : '<div class="note success"><strong>No exceptions for this selection.</strong></div>'}
<div class="kinds">${Object.entries(kindHelp).map(([k, v]) => `<div><strong>${k}</strong><span>${v}</span></div>`).join('')}</div></section>`;
}

function lines() {
  const {r} = result();
  const status = new Map();
  r.matches.forEach(m => { status.set(m.r.id, `Pass ${m.pass}`); status.set(m.p.id, `Pass ${m.pass}`); });
  const rows = r.lines.filter(l => state.entity === 'all' || l.entity === state.entity);
  return head('STEP 03 / TRANSACTIONS', 'The data behind the reconciliation.', `${r.summary.lines} intercompany lines, as each entity booked them. R = receivable side, P = payable side.`, `<div class="actions">${button('Download sample data CSV', 'export-lines', 'secondary')}</div>`) + `
<section class="card"><div class="toolbar"><div class="field"><label for="entityFilter">Booked by</label><select id="entityFilter" data-control="entity"><option value="all">All entities</option>${entities.map(e => `<option value="${e.code}" ${state.entity === e.code ? 'selected' : ''}>${e.code} · ${esc(e.name)}</option>`).join('')}</select></div></div>
<div class="tablewrap"><table><thead><tr><th>Line</th><th>Entity</th><th>Partner</th><th>Side</th><th>Account</th><th>Document</th><th>Date</th><th class="num">Transaction amount</th><th class="num">Local amount</th><th>Match</th></tr></thead><tbody>${rows.map(l => `<tr><td>${l.id}</td><td>${l.entity}</td><td>${l.partner}</td><td>${l.side}</td><td>${esc(categories[l.category])}</td><td class="mono">${esc(l.doc)}</td><td>${date(l.docDate)}</td><td class="num">${l.cur} ${l.amt < 0 ? '−' : ''}${num(Math.abs(l.amt))}</td><td class="num">${l.lcur} ${l.lamt < 0 ? '−' : ''}${num(Math.abs(l.lamt))}</td><td>${status.has(l.id) ? `<span class="pill">${status.get(l.id)}</span>` : '<span class="pill red">Unmatched</span>'}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function rules() {
  return head('STEP 04 / RATES AND RULES', 'The settings behind every number.', 'Change the tolerance to see how exceptions are classed. Rates are illustrative, not market data.') + `
<div class="grid2"><section class="card"><div class="cardhead"><h2>FX rates</h2><span class="pill neutral">Per EUR 1</span></div><div class="tablewrap"><table><thead><tr><th>Currency</th><th class="num">Closing, ${date(closeDate)}</th><th class="num">Q1 average</th></tr></thead><tbody>${Object.entries(rates).filter(([c]) => c !== 'EUR').map(([c, v]) => `<tr><td>${c}</td><td class="num">${num(v.close, 4)}</td><td class="num">${num(v.avg, 4)}</td></tr>`).join('')}</tbody></table></div><p class="small muted" style="margin:12px 0 0">Balances translate at the closing rate. The average rate is kept for P&amp;L eliminations.</p></section>
<section class="card"><div class="cardhead"><h2>Tolerance</h2></div><div class="field"><label for="tolerance">Escalate differences above (EUR)</label><input id="tolerance" type="number" min="0" step="100" value="${state.tolerance}" data-control="tolerance"></div><p class="small muted" style="margin:12px 0 0">A difference at or below this amount is listed as within tolerance and is not escalated. It is never hidden.</p></section></div>
<section class="card"><div class="cardhead"><h2>Entities</h2></div><div class="tablewrap"><table><thead><tr><th>Code</th><th>Entity</th><th>Country</th><th>Currency</th><th>Local GAAP</th><th>Role</th></tr></thead><tbody>${entities.map(e => `<tr><td>${e.code}</td><td>${esc(e.name)}</td><td>${esc(e.country)}</td><td>${e.currency}</td><td>${esc(e.gaap)}</td><td>${esc(e.role)}</td></tr>`).join('')}</tbody></table></div><p class="small muted" style="margin:12px 0 0">Each entity keeps a local book in its own currency and GAAP and a group book under IFRS in EUR. The reconciliation runs on the group book.</p></section>`;
}

function casePage() {
  return head('PORTFOLIO / SORABH GUPTA', 'Intercompany close, made explainable.', 'A working demonstration of multi-entity, multi-currency intercompany reconciliation for a group shared services centre.') + `
<section class="card"><div class="cardhead"><h2>The problem</h2></div><p>In a multinational group, every intercompany document is booked twice, by two entities, in different currencies, under different local GAAPs. At close, the two sides rarely agree, and finding why takes days of spreadsheet work.</p><p>This demo matches both sides automatically, translates every balance to the group currency, and lists each difference with the document behind it.</p></section>
<div class="scopegrid"><section class="card"><h2>Working in this demonstration</h2><ul><li>Six fictional entities, five currencies and five local GAAPs, with 143 intercompany lines.</li><li>Three-pass matching: exact, close, and no-reference within a date window.</li><li>A translation check that catches balances not revalued at the closing rate.</li><li>An entity-pair matrix, an exception list with ageing and a configurable tolerance.</li><li>CSV exports of exceptions and the sample data.</li></ul></section><section class="card"><h2>Not connected or automated here</h2><ul><li>No ERP connection; the sample data is fictional.</li><li>No posting of adjusting or elimination entries.</li><li>No upload of your own data in this release.</li></ul></section></div>`;
}

function render() {
  document.querySelectorAll('[data-view]').forEach(b => { const on = b.dataset.view === state.view; b.classList.toggle('active', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  $('#main').innerHTML = {overview, exceptions, lines, rules, case: casePage}[state.view]();
}
function go(view) { state.view = view; render(); window.scrollTo({top: 0, behavior: 'smooth'}); }

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) { go(b.dataset.view); return; }
  if (b.dataset.pair) { state.pair = b.dataset.pair; state.status = 'all'; go('exceptions'); return; }
  const a = b.dataset.action;
  if (a === 'go-exceptions') { state.pair = ''; go('exceptions'); }
  if (a === 'reset') { state = fresh(); cache = null; render(); toast('Demo reset.'); }
  if (a === 'export-exceptions') {
    const {r} = result();
    download('InterCo_exceptions.csv', csv(r.exceptions.map(x => ({id: x.id, creditor: x.creditor, debtor: x.debtor, type: x.kind, account: categories[x.category], document: x.doc, bookedBy: x.foundIn, missingIn: x.missingIn, currency: x.cur, difference: x.diffTC, differenceEUR: x.eur, ageDays: x.age, status: x.status}))));
    toast('Exceptions downloaded.');
  }
  if (a === 'export-lines') { download('InterCo_sample_data.csv', csv(sampleLines.map(({id, ...l}) => ({line: id, ...l})))); toast('Sample data downloaded.'); }
});
document.addEventListener('change', e => {
  const el = e.target, c = el.dataset.control; if (!c) return;
  if (c === 'tolerance') { const v = Number(el.value); if (!Number.isFinite(v) || v < 0 || v > 1e9) { toast('Enter a tolerance from 0 to 1 billion.'); return; } state.tolerance = round2(v); toast(`Tolerance set to ${eur(state.tolerance)}.`); }
  else state[c] = el.value;
  render();
});
render();
