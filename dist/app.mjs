import {reconcile, pairMatrix, csv, round2} from './engine.mjs';
import {sampleLines, rates as sampleRates, closeDate as sampleClose, entities as sampleEntities, categories} from './data.mjs';
import {explain, applyFixes, byBucket} from './explain.mjs';
import {COLUMNS, importLines, toTemplateRows, monthEnd, MAX_LINES} from './io.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fresh = () => ({view: 'overview', tolerance: 1000, pair: '', status: 'all', entity: 'all'});
// The data being reconciled: the fictional sample group, or a file the user loaded in this browser.
const sample = () => ({source: 'sample', label: 'Halmrode Industrial Group', fileName: '', entities: sampleEntities.map(e => ({...e})),
  rates: structuredClone(sampleRates), closeDate: sampleClose, lines: sampleLines});
let state = fresh(), data = sample(), version = 0, cache = null, lastLoad = null;
const codes = () => data.entities.map(e => e.code);
const catLabel = c => categories[c] || c;
const currenciesUsed = () => [...new Set(data.lines.flatMap(l => [l.cur, l.lcur]))].sort();
const missingRates = () => currenciesUsed().filter(c => !(data.rates[c]?.close > 0));
function result() {
  if (missingRates().length) return null;
  if (!cache || cache.tolerance !== state.tolerance || cache.version !== version) {
    const r = reconcile(data.lines, {rates: data.rates, closeDate: data.closeDate, tolerance: state.tolerance});
    const items = explain(r, {rates: data.rates, closeDate: data.closeDate});
    cache = {tolerance: state.tolerance, version, r, matrix: pairMatrix(r, codes()), items, gross: round2(items.reduce((t, i) => t + i.gross, 0))};
  }
  return cache;
}
const needRates = () => `<section class="card"><div class="note warn" style="margin:0"><strong>Enter closing rates to run the reconciliation.</strong><br>No closing rate yet for ${missingRates().map(esc).join(', ')}. Every balance is translated to EUR before the two sides are compared.</div><div class="actions" style="margin-top:16px">${button('Enter rates', 'go-rules')}</div></section>`;
const plural = (n, one, many = one + 's') => `${num(n, 0)} ${n === 1 ? one : many}`;

const num = (n, d = 2) => new Intl.NumberFormat('en-GB', {minimumFractionDigits: d, maximumFractionDigits: d}).format(n);
const eur = (n, d = 0) => (Math.abs(n) >= 0.5 / 10 ** d && n < 0 ? '−€' : '€') + num(Math.abs(n), d);
const signedEur = n => (n > 0 ? '+' : '') + eur(n);
const signedNum = n => (n < 0 ? '−' : n > 0 ? '+' : '') + num(Math.abs(n));
const date = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'});
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
function download(name, body) { const url = URL.createObjectURL(new Blob(['\uFEFF' + body], {type: 'text/csv;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
const head = (kicker, title, sub, action = '') => `<div class="pagehead"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="sub">${sub}</p></div>${action}</div>`;
const metric = (label, value, meta, accent = false) => `<div class="metric ${accent ? 'accent' : ''}"><div class="label">${label}</div><div class="value">${value}</div><div class="meta">${meta}</div></div>`;
const button = (label, action, cls = '') => `<button class="button ${cls}" data-action="${action}">${label}</button>`;
const pairLabel = (c, d) => `${esc(c)} → ${esc(d)}`;
const statusPill = s => `<span class="pill ${s === 'Open' ? 'red' : 'amber'}">${s}</span>`;
const kindHelp = {
  'Unmatched': 'Booked by one side only.',
  'Amount difference': 'Both sides booked the document; the amounts differ.',
  'FX translation': 'Amounts agree in transaction currency; the local-currency values translate to different EUR amounts.',
};

function overview() {
  const intro = head('STEP 02 / PAIR MATRIX', 'Every intercompany pair, reconciled.', `${esc(data.label)} · close ${date(data.closeDate)} · ${plural(data.lines.length, 'line')} from ${plural(data.entities.length, 'entity', 'entities')} in ${plural(currenciesUsed().length, 'currency', 'currencies')}`, `<div class="actions">${button('Review exceptions →', 'go-exceptions')}</div>`);
  if (!result()) return intro + needRates();
  const {r, matrix} = result(), s = r.summary, ents = data.entities, cs = codes();
  const cell = c => {
    if (!c) return '<td class="mx-none" aria-label="No intercompany balance">—</td>';
    const label = c.status === 'matched' ? '✓ Matched' : signedEur(c.diffEUR);
    const sub = c.status === 'matched' ? `${eur(c.balanceEUR)} balance` : `${c.open ? `${c.open} open` : ''}${c.open && c.tolerance ? ' · ' : ''}${c.tolerance ? `${c.tolerance} in tolerance` : ''}`;
    return `<td><button class="mx mx-${c.status}" data-pair="${esc(c.creditor)}>${esc(c.debtor)}" aria-label="${pairLabel(c.creditor, c.debtor)}: ${esc(label)}"><strong>${label}</strong><small>${sub}</small></button></td>`;
  };
  const gaaps = new Set(ents.map(e => e.gaap).filter(Boolean)).size;
  return intro + `
<div class="metrics">${metric('Lines matched automatically', `${num(s.matchedLines, 0)} of ${num(s.lines, 0)}`, `${num(s.matchRate * 100, 1)}% across three matching passes`, true)}${metric('Open exceptions', num(s.open, 0), `${s.withinTolerance} more within the ${eur(state.tolerance)} tolerance`)}${metric('Gross difference', eur(result().gross), `${plural(result().items.length, 'item')} to resolve, EUR at closing rates`)}${metric('Entities', String(ents.length), `${plural(currenciesUsed().length, 'currency', 'currencies')}${gaaps ? ` · ${gaaps} local GAAPs` : ''}`)}</div>
<section class="card"><div class="cardhead"><h2>Pair matrix</h2><span class="pill neutral">EUR at closing rates</span></div>
<p class="small muted" style="margin-top:-6px">Rows are who is owed; columns are who owes. Each cell is the creditor's receivable minus the debtor's payable, across all account types. Select a cell to see its exceptions.</p>
<div class="tablewrap"><table class="matrix"><thead><tr><th>Owed to ↓ · Owed by →</th>${cs.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${cs.map((c, i) => `<tr><th scope="row">${esc(c)}<small>${esc([ents[i].currency, ents[i].gaap].filter(Boolean).join(' · ') || '—')}</small></th>${matrix[i].map((x, j) => (i === j ? '<td class="mx-self"></td>' : cell(x))).join('')}</tr>`).join('')}</tbody></table></div>
<div class="legend mxlegend"><span><i class="lg lg-matched"></i>Matched</span><span><i class="lg lg-tolerance"></i>Within tolerance only</span><span><i class="lg lg-open"></i>Open exceptions</span><span><i class="lg lg-none"></i>No balance</span></div></section>
<section class="card"><div class="cardhead"><h2>How the lines matched</h2></div><div class="tablewrap"><table><thead><tr><th>Pass</th><th>Rule</th><th class="num">Pairs matched</th></tr></thead><tbody>
<tr><td>1 · Exact</td><td>Same pair, account type, document, currency and amount</td><td class="num">${s.byPass[0]}</td></tr>
<tr><td>2 · Close</td><td>Same pair, account type, document and currency; amounts differ</td><td class="num">${s.byPass[1]}</td></tr>
<tr><td>3 · No reference</td><td>Same pair, account type, currency and amount within 5 days; documents differ</td><td class="num">${s.byPass[2]}</td></tr>
<tr><td>Translation check</td><td>Local-currency balances, translated to EUR, must agree once the differences above are explained</td><td class="num">${r.exceptions.filter(e => e.kind === 'FX translation').length} flagged</td></tr></tbody></table></div></section>`;
}

function exceptions() {
  if (!result()) return head('STEP 03 / EXCEPTIONS', 'Every difference, with the document behind it.', 'Exceptions appear once every currency has a closing rate.') + needRates();
  const {r} = result();
  const rows = r.exceptions.filter(e => (!state.pair || `${e.creditor}>${e.debtor}` === state.pair) && (state.status === 'all' || e.status === state.status));
  const pairs = [...new Set(r.exceptions.map(e => `${e.creditor}>${e.debtor}`))];
  const total = rows.reduce((t, e) => t + e.eur, 0);
  return head('STEP 03 / EXCEPTIONS', 'Every difference, with the document behind it.', `${r.summary.open} open and ${r.summary.withinTolerance} within tolerance. Amounts are the creditor's view minus the debtor's.`, `<div class="actions">${button('Download exceptions CSV', 'export-exceptions', 'secondary')}${button('See causes and entries →', 'go-resolution')}</div>`) + `
<section class="card"><div class="toolbar"><div class="field"><label for="pairFilter">Pair</label><select id="pairFilter" data-control="pair"><option value="">All pairs</option>${pairs.map(p => `<option value="${esc(p)}" ${state.pair === p ? 'selected' : ''}>${pairLabel(...p.split('>'))}</option>`).join('')}</select></div><div class="field"><label for="statusFilter">Status</label><select id="statusFilter" data-control="status"><option value="all">All</option><option value="Open" ${state.status === 'Open' ? 'selected' : ''}>Open</option><option value="Within tolerance" ${state.status === 'Within tolerance' ? 'selected' : ''}>Within tolerance</option></select></div></div>
${rows.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Pair</th><th>Type</th><th>Document</th><th>Booked by</th><th class="num">Difference</th><th class="num">Age</th><th>Status</th></tr></thead><tbody>${rows.map(e => `<tr><td>${e.id}</td><td>${pairLabel(e.creditor, e.debtor)}</td><td>${e.kind}<small class="cellnote">${esc(catLabel(e.category))}</small></td><td><span class="mono">${esc(e.doc)}</span><small class="cellnote">${esc(e.desc)}</small></td><td>${e.kind === 'Unmatched' ? `${esc(e.foundIn)} only<small class="cellnote">missing in ${esc(e.missingIn)}</small>` : `<span class="cellwrap">${esc(e.foundIn)}</span>`}</td><td class="num"><span class="${e.status === 'Open' ? 'diff' : ''}">${signedEur(e.eur)}</span><small class="cellnote right">${esc(e.cur)} ${signedNum(e.diffTC)}</small></td><td class="num">${e.age} d</td><td>${statusPill(e.status)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5">Net of rows shown</td><td class="num">${signedEur(total)}</td><td colspan="2"></td></tr></tfoot></table></div>` : '<div class="note success"><strong>No exceptions for this selection.</strong></div>'}
<div class="kinds">${Object.entries(kindHelp).map(([k, v]) => `<div><strong>${k}</strong><span>${v}</span></div>`).join('')}</div></section>`;
}

function resolution() {
  const intro = (a = '') => head('STEP 04 / RESOLUTION', 'Why each difference exists, and the entry that clears it.', 'Causes are proposed by rules from the data. Every entry is for review; nothing is posted from here.', a);
  if (!result()) return intro() + needRates();
  const {r, items, gross} = result();
  if (!items.length) return intro() + '<section class="card"><div class="note success" style="margin:0"><strong>Nothing to resolve.</strong> Every intercompany line matched.</div></section>';
  const after = reconcile(applyFixes(r.lines, items), {rates: data.rates, closeDate: data.closeDate, tolerance: state.tolerance});
  const buckets = byBucket(items), local = items.filter(i => i.entry && i.owner !== 'Group').length, group = items.filter(i => i.owner === 'Group').length;
  const linked = items.filter(i => i.exceptionIds.length > 1).length;
  const amt = (cur, n) => `${esc(cur)} ${num(n)}`;
  const elim = new Map();
  for (const p of after.pairs) { const k = `${p.creditor}>${p.debtor}`, x = elim.get(k) || {c: p.creditor, d: p.debtor, rec: 0, pay: 0}; x.rec += p.credEUR; x.pay += p.debtEUR; elim.set(k, x); }
  const elims = [...elim.values()].sort((a, b) => b.rec - a.rec), tot = elims.reduce((t, x) => ({rec: t.rec + x.rec, pay: t.pay + x.pay}), {rec: 0, pay: 0});
  return intro(`<div class="actions">${button('Download workpaper CSV', 'export-workpaper', 'secondary')}</div>`) + `
<div class="metrics">${metric('Items to resolve', String(items.length), linked ? `${plural(r.exceptions.length, 'exception')}; ${linked === 1 ? 'one mis-posted document counts once' : `${linked} mis-posted documents count once`}` : plural(r.exceptions.length, 'exception'), true)}${metric('Gross difference', eur(gross), 'Each item counted once, EUR')}${metric('Proposed entries', String(local + group), `${plural(local, 'local entry', 'local entries')}${group ? ` · ${plural(group, 'group adjustment')}` : ''}`)}${metric('Left after entries', after.summary.exceptions ? plural(after.summary.exceptions, 'exception') : eur(0), after.summary.exceptions ? `${eur(after.summary.grossEUR)} still to investigate` : 'Every pair eliminates in full')}</div>
<section class="card"><div class="cardhead"><h2>Split by cause</h2><span class="pill neutral">EUR at closing rates</span></div><div class="tablewrap"><table><thead><tr><th>Cause</th><th class="num">Items</th><th class="num">Gross difference</th><th>Share</th></tr></thead><tbody>${buckets.map(b => `<tr><td>${b.bucket}</td><td class="num">${b.items}</td><td class="num">${eur(b.gross)}</td><td><span class="share"><i style="width:${Math.max(1, Math.round(b.gross / gross * 100))}%"></i></span>${b.gross / gross < 0.005 ? '&lt;1' : num(b.gross / gross * 100, 0)}%</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td class="num">${items.length}</td><td class="num">${eur(gross)}</td><td></td></tr></tfoot></table></div>
<p class="small muted" style="margin:12px 0 0">Timing items clear on their own next period; the rest need an entry or a decision before the group close.</p></section>
<section class="card"><div class="cardhead"><h2>Items and proposed entries</h2></div><div class="tablewrap"><table class="restable"><thead><tr><th>Item</th><th>Cause</th><th>Books it</th><th>Proposed entry</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${items.map(i => `<tr><td>${i.id}<small class="cellnote">${i.exceptionIds.join(' + ')}</small></td><td><span class="cellwrap cause">${esc(i.cause)}</span><small class="cellnote">${pairLabel(i.creditor, i.debtor)} · ${esc(i.bucket)}${i.note ? ` · ${esc(i.note)}` : ''}</small></td><td>${esc(i.owner)}</td><td>${i.entry ? `<span class="jl">Dr ${esc(i.entry.debit)}</span><span class="jl">Cr ${esc(i.entry.credit)}</span>` : '<span class="muted">No entry until the partner confirms</span>'}</td><td class="num">${i.entry ? `${amt(i.entry.cur, i.entry.amount)}<small class="cellnote right">${eur(i.entry.eurAmount, 2)}</small>` : '—'}</td><td>${statusPill(i.status)}</td></tr>`).join('')}</tbody></table></div></section>
<section class="card"><div class="cardhead"><h2>After the proposed entries</h2><span class="pill ${after.summary.exceptions ? 'amber' : ''}">${after.summary.exceptions ? `${after.summary.exceptions} left` : 'Clears in full'}</span></div>
<p class="small muted" style="margin-top:-6px">The reconciliation, rerun with every proposed entry: ${num(after.summary.matchedLines, 0)} of ${num(after.summary.lines, 0)} lines match. The receivable and payable for each pair then eliminate in the group book.</p>
<div class="tablewrap"><table><thead><tr><th>Owed to → owed by</th><th class="num">Receivable</th><th class="num">Payable</th><th class="num">Eliminated</th><th class="num">Left</th></tr></thead><tbody>${elims.map(x => `<tr><td>${pairLabel(x.c, x.d)}</td><td class="num">${eur(x.rec, 2)}</td><td class="num">${eur(x.pay, 2)}</td><td class="num">${eur(Math.min(x.rec, x.pay), 2)}</td><td class="num ${Math.abs(x.rec - x.pay) >= 0.01 ? 'diff' : 'zero'}">${eur(x.rec - x.pay, 2)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td class="num">${eur(tot.rec, 2)}</td><td class="num">${eur(tot.pay, 2)}</td><td class="num">${eur(Math.min(tot.rec, tot.pay), 2)}</td><td class="num">${eur(tot.rec - tot.pay, 2)}</td></tr></tfoot></table></div></section>`;
}

const SHOW = 1000;
function lines() {
  const res = result(), status = new Map();
  res?.r.matches.forEach(m => { status.set(m.r.id, `Pass ${m.pass}`); status.set(m.p.id, `Pass ${m.pass}`); });
  const all = data.lines.filter(l => state.entity === 'all' || l.entity === state.entity), rows = all.slice(0, SHOW);
  const match = l => !res ? '<span class="pill neutral">Needs rates</span>' : status.has(l.id) ? `<span class="pill">${status.get(l.id)}</span>` : '<span class="pill red">Unmatched</span>';
  return head('STEP 05 / TRANSACTIONS', 'The data behind the reconciliation.', `${plural(data.lines.length, 'intercompany line')}, as each entity booked them. R = receivable side, P = payable side.`, `<div class="actions">${button('Download lines CSV', 'export-lines', 'secondary')}</div>`) + `
<section class="card"><div class="toolbar"><div class="field"><label for="entityFilter">Booked by</label><select id="entityFilter" data-control="entity"><option value="all">All entities</option>${data.entities.filter(e => e.currency).map(e => `<option value="${esc(e.code)}" ${state.entity === e.code ? 'selected' : ''}>${esc(e.code)}${e.name ? ` · ${esc(e.name)}` : ''}</option>`).join('')}</select></div></div>
<div class="tablewrap"><table><thead><tr><th>Line</th><th>Entity</th><th>Partner</th><th>Side</th><th>Account</th><th>Document</th><th>Date</th><th class="num">Transaction amount</th><th class="num">Local amount</th><th>Match</th></tr></thead><tbody>${rows.map(l => `<tr><td>${l.id}</td><td>${esc(l.entity)}</td><td>${esc(l.partner)}</td><td>${l.side}</td><td>${esc(catLabel(l.category))}</td><td class="mono">${esc(l.doc)}</td><td>${date(l.docDate)}</td><td class="num">${esc(l.cur)} ${l.amt < 0 ? '−' : ''}${num(Math.abs(l.amt))}</td><td class="num">${esc(l.lcur)} ${l.lamt < 0 ? '−' : ''}${num(Math.abs(l.lamt))}</td><td>${match(l)}</td></tr>`).join('')}</tbody></table></div>
${all.length > SHOW ? `<div class="tablefoot"><span>Showing the first ${num(SHOW, 0)} of ${num(all.length, 0)} lines. Download the CSV for all of them.</span></div>` : ''}</section>`;
}

function rules() {
  const missing = missingRates(), curs = currenciesUsed().filter(c => c !== 'EUR');
  const rateInput = (c, kind) => `<input class="rateinput" type="number" min="0" step="any" inputmode="decimal" aria-label="${esc(c)} ${kind === 'close' ? 'closing' : 'average'} rate" data-control="rate" data-cur="${esc(c)}" data-kind="${kind}" value="${data.rates[c]?.[kind] ?? ''}">`;
  const entityTable = data.source === 'sample'
    ? `<thead><tr><th>Code</th><th>Entity</th><th>Country</th><th>Currency</th><th>Local GAAP</th><th>Role</th></tr></thead><tbody>${data.entities.map(e => `<tr><td>${e.code}</td><td>${esc(e.name)}</td><td>${esc(e.country)}</td><td>${e.currency}</td><td>${esc(e.gaap)}</td><td>${esc(e.role)}</td></tr>`).join('')}</tbody>`
    : `<thead><tr><th>Code</th><th>Local currency</th><th class="num">Lines booked</th></tr></thead><tbody>${data.entities.map(e => `<tr><td>${esc(e.code)}</td><td>${esc(e.currency) || '<span class="muted">Partner only, no lines booked</span>'}</td><td class="num">${num(data.lines.filter(l => l.entity === e.code).length, 0)}</td></tr>`).join('')}</tbody>`;
  return head('STEP 06 / RATES AND RULES', 'The settings behind every number.', data.source === 'sample' ? 'Change a rate or the tolerance to see how exceptions are classed. Sample rates are illustrative, not market data.' : 'Enter the closing rate for each currency in your file, then set the tolerance.') + `
${missing.length ? `<div class="note warn"><strong>Closing rate needed for ${missing.map(esc).join(', ')}.</strong> The reconciliation runs once every currency has one.${missing.some(c => sampleRates[c]) ? `<div class="actions" style="margin-top:12px">${button(`Use the sample's illustrative rates for ${missing.filter(c => sampleRates[c]).join(', ')}`, 'fill-sample-rates', 'secondary')}</div>` : ''}</div>` : ''}
<div class="grid2"><section class="card"><div class="cardhead"><h2>FX rates</h2><span class="pill neutral">Units per EUR 1</span></div><div class="tablewrap"><table><thead><tr><th>Currency</th><th class="num">Closing, ${date(data.closeDate)}</th><th class="num">Period average</th></tr></thead><tbody>${curs.length ? curs.map(c => `<tr${missing.includes(c) ? ' class="needsrate"' : ''}><td>${esc(c)}${missing.includes(c) ? ' <span class="pill amber">Needed</span>' : ''}</td><td class="num">${rateInput(c, 'close')}</td><td class="num">${rateInput(c, 'avg')}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">Every line is in EUR; no rates needed.</td></tr>'}</tbody></table></div><p class="small muted" style="margin:12px 0 0">EUR is the group currency. Balances translate at the closing rate; the average rate is optional and kept for P&amp;L eliminations.</p></section>
<section class="card"><div class="cardhead"><h2>Tolerance</h2></div><div class="field"><label for="tolerance">Escalate differences above (EUR)</label><input id="tolerance" type="number" min="0" step="100" value="${state.tolerance}" data-control="tolerance"></div><p class="small muted" style="margin:12px 0 0">A difference at or below this amount is listed as within tolerance and is not escalated. It is never hidden.</p></section></div>
<section class="card"><div class="cardhead"><h2>Entities</h2></div><div class="tablewrap"><table>${entityTable}</table></div>${data.source === 'sample' ? '<p class="small muted" style="margin:12px 0 0">Each entity keeps a local book in its own currency and GAAP and a group book under IFRS in EUR. The reconciliation runs on the group book.</p>' : ''}</section>`;
}

function loadData() {
  const isSample = data.source === 'sample';
  const loadNote = !lastLoad ? '' : lastLoad.errorCount
    ? `<div class="note error"><strong>${esc(lastLoad.fileName)} was not loaded: ${plural(lastLoad.errorCount, 'problem')} found.</strong> Fix these rows and load the file again.<ul class="errorlist">${lastLoad.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>${lastLoad.errorCount > lastLoad.errors.length ? `<p class="small" style="margin:8px 0 0">Showing the first ${lastLoad.errors.length}.</p>` : ''}</div>`
    : `<div class="note success"><strong>Loaded ${plural(lastLoad.lines, 'line')} from ${esc(lastLoad.fileName)}.</strong>${missingRates().length ? ` Enter closing rates for ${missingRates().map(esc).join(', ')} to run the reconciliation.` : ' The reconciliation has run.'}</div>`;
  return head('STEP 01 / LOAD DATA', 'Reconcile your own intercompany lines.', 'Your file is read inside this browser. Nothing is uploaded to a server or saved, and closing the tab clears it.') + `
<section class="card"><div class="cardhead"><h2>Now reconciling</h2><span class="pill ${isSample ? 'neutral' : ''}">${isSample ? 'Fictional sample' : 'Your file'}</span></div>
<div class="loaded"><div><strong>${esc(data.label)}</strong><span class="muted small">${plural(data.lines.length, 'line')} · ${plural(data.entities.length, 'entity', 'entities')} · ${plural(currenciesUsed().length, 'currency', 'currencies')}</span></div>
<div class="field"><label for="closeDate">Close date</label><input id="closeDate" type="date" value="${data.closeDate}" data-control="closeDate"><small>Ageing is counted to this date.</small></div></div>
${isSample ? '' : `<div class="actions" style="margin-top:16px">${button('Switch back to the sample group', 'use-sample', 'secondary')}</div>`}</section>
${loadNote}
<div class="grid2"><section class="card"><div class="cardhead"><h2>1. Prepare the file</h2></div><p class="small muted">One row per open intercompany item, from every entity, in one CSV file. Both sides of each transaction should be in the file.</p>
<div class="actions">${button('Download template', 'export-template')}${button('Download sample data as an example', 'export-sample', 'secondary')}</div>
<p class="small muted" style="margin:14px 0 0">From Excel, use File → Save As → CSV UTF-8. Up to ${num(MAX_LINES, 0)} rows.</p></section>
<section class="card"><div class="cardhead"><h2>2. Load it</h2></div><div class="upload" style="margin-top:0"><label for="file">Choose a CSV file</label><input id="file" type="file" accept=".csv,text/csv"></div>
<p class="small muted" style="margin:14px 0 0">Every row is checked first. If any row has a problem, nothing is loaded and each problem is listed by row number.</p></section></div>
<section class="card"><div class="cardhead"><h2>Template columns</h2></div><div class="tablewrap"><table><thead><tr><th>Column</th><th>Required</th><th>What it holds</th><th>Example</th></tr></thead><tbody>${COLUMNS.map(c => `<tr><td class="mono">${c.header}</td><td>${c.required ? 'Yes' : 'No'}</td><td><span class="cellwrap" style="max-width:420px;min-width:220px">${esc(c.help)}</span></td><td class="mono">${esc(c.example)}</td></tr>`).join('')}</tbody></table></div>
<p class="small muted" style="margin:12px 0 0">Headers are matched loosely, so "Trading partner", "Company code" or "Local amount" also work. Negative amounts can be written as −1,200, (1,200) or 1200-.</p></section>
<section class="card"><div class="cardhead"><h2>Where the data comes from</h2></div><div class="walkthrough">
<div><strong>SAP</strong><p>Open-item reports by trading partner: FBL5N for receivables, FBL1N for payables and FBL3N for intercompany GL accounts, at the close date.</p></div>
<div><strong>Oracle, NetSuite</strong><p>The intercompany receivables and payables ageing, or an open-items saved search filtered on the intercompany partner.</p></div>
<div><strong>Account type</strong><p>Use the same word on both sides, for example trade or loan, so a receivable can only match a payable of the same kind.</p></div>
<div><strong>Local amount</strong><p>The amount after period-end revaluation. If an entity has not revalued its foreign-currency items, the translation check flags the pair.</p></div></div></section>`;
}

function casePage() {
  return head('PORTFOLIO / SORABH GUPTA', 'Intercompany close, made explainable.', 'A working demonstration of multi-entity, multi-currency intercompany reconciliation for a group shared services centre.') + `
<section class="card"><div class="cardhead"><h2>The problem</h2></div><p>In a multinational group, every intercompany document is booked twice, by two entities, in different currencies, under different local GAAPs. At close, the two sides rarely agree, and finding why takes days of spreadsheet work.</p><p>This demo matches both sides automatically, translates every balance to the group currency, and lists each difference with the document behind it.</p></section>
<div class="scopegrid"><section class="card"><h2>Working in this demonstration</h2><ul><li>Six fictional entities, five currencies and five local GAAPs, with 143 intercompany lines.</li><li>Three-pass matching: exact, close, and no-reference within a date window.</li><li>A translation check that catches balances not revalued at the closing rate.</li><li>A likely cause for every difference, a proposed entry for each, and the reconciliation rerun after the entries to show what is left.</li><li>An entity-pair matrix, an exception list with ageing and a configurable tolerance.</li><li>Your own data: a CSV template, row-by-row checks and editable rates. The file is read in your browser and never leaves it.</li><li>CSV exports of exceptions and lines.</li></ul></section><section class="card"><h2>Not connected or automated here</h2><ul><li>No ERP connection; the sample data is fictional.</li><li>Entries are proposed for review; nothing is posted.</li><li>Profit-and-loss eliminations are not covered; the eliminations shown are balance-sheet only.</li><li>Excel files are loaded after saving them as CSV.</li></ul></section></div>`;
}

function render() {
  document.querySelectorAll('[data-view]').forEach(b => { const on = b.dataset.view === state.view; b.classList.toggle('active', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  $('#main').innerHTML = {data: loadData, overview, exceptions, resolution, lines, rules, case: casePage}[state.view]();
  $('#closeLabel').textContent = `Close · ${date(data.closeDate)}`;
  $('#datasetPill').textContent = data.source === 'sample' ? 'Fictional data' : 'Your file';
}
function setData(next) { data = next; version++; state = {...fresh(), view: state.view, tolerance: state.tolerance}; }
async function readFile(file) {
  if (!file) return;
  if (file.size > 20e6) { lastLoad = {fileName: file.name, errorCount: 1, errors: ['The file is larger than 20 MB. Split it or remove columns you do not need.']}; render(); return; }
  if (/\.xlsx?$/i.test(file.name)) { lastLoad = {fileName: file.name, errorCount: 1, errors: ['This is an Excel file. In Excel, use File → Save As → CSV UTF-8, then load the CSV.']}; render(); return; }
  const imp = importLines(await file.text());
  if (imp.errorCount) { lastLoad = {fileName: file.name, errorCount: imp.errorCount, errors: imp.errors}; render(); return; }
  setData({source: 'upload', label: file.name, fileName: file.name, entities: imp.entities, closeDate: monthEnd(imp.maxDate), lines: imp.lines,
    rates: Object.fromEntries(imp.currencies.map(c => [c, c === 'EUR' ? {close: 1, avg: 1} : {close: null, avg: null}]))});
  lastLoad = {fileName: file.name, errorCount: 0, lines: imp.lines.length};
  render();
  toast(missingRates().length ? `Loaded ${plural(imp.lines.length, 'line')}. Enter closing rates next.` : `Loaded ${plural(imp.lines.length, 'line')} and reconciled.`);
}
function go(view) { state.view = view; render(); window.scrollTo({top: 0, behavior: 'smooth'}); }

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) { go(b.dataset.view); return; }
  if (b.dataset.pair) { state.pair = b.dataset.pair; state.status = 'all'; go('exceptions'); return; }
  const a = b.dataset.action;
  if (a === 'go-exceptions') { state.pair = ''; go('exceptions'); }
  if (a === 'go-rules') go('rules');
  if (a === 'go-resolution') go('resolution');
  if (a === 'export-workpaper') {
    const {items} = result();
    download('InterCo_resolution_workpaper.csv', csv(items.map(i => ({item: i.id, exceptions: i.exceptionIds.join(' + '), creditor: i.creditor, debtor: i.debtor, accountType: catLabel(i.category), document: i.doc, cause: i.cause, category: i.bucket, booksIt: i.owner,
      debit: i.entry?.debit ?? '', credit: i.entry?.credit ?? '', currency: i.entry?.cur ?? '', amount: i.entry?.amount ?? '', amountEUR: i.entry?.eurAmount ?? '', differenceEUR: i.gross, status: i.status, note: i.note ?? ''}))));
    toast('Workpaper downloaded.');
  }
  if (a === 'fill-sample-rates') { const filled = missingRates().filter(c => sampleRates[c]); filled.forEach(c => { data.rates[c] = {...sampleRates[c]}; }); version++; render(); toast(`Sample rates filled in for ${filled.join(', ')}.`); }
  if (a === 'reset') { state = fresh(); data = sample(); version++; lastLoad = null; render(); toast('Demo reset to the sample group.'); }
  if (a === 'use-sample') { setData(sample()); lastLoad = null; render(); toast('Switched back to the sample group.'); }
  if (a === 'export-template') { download('InterCo_template.csv', csv(toTemplateRows(sampleLines.filter(l => ['INV-DE02-US-0105', 'INV-IN01-SS-Q1-DE01', 'LOAN-DE01-US01'].includes(l.doc))))); toast('Template downloaded.'); }
  if (a === 'export-sample') { download('InterCo_sample_data.csv', csv(toTemplateRows(sampleLines))); toast('Sample data downloaded.'); }
  if (a === 'export-exceptions') {
    const {r} = result();
    download('InterCo_exceptions.csv', csv(r.exceptions.map(x => ({id: x.id, creditor: x.creditor, debtor: x.debtor, type: x.kind, account: catLabel(x.category), document: x.doc, bookedBy: x.foundIn, missingIn: x.missingIn, currency: x.cur, difference: x.diffTC, differenceEUR: x.eur, ageDays: x.age, status: x.status}))));
    toast('Exceptions downloaded.');
  }
  if (a === 'export-lines') { download('InterCo_lines.csv', csv(toTemplateRows(data.lines))); toast('Lines downloaded.'); }
});
document.addEventListener('change', e => {
  const el = e.target, c = el.dataset.control;
  if (el.id === 'file') { readFile(el.files[0]); return; }
  if (!c) return;
  if (c === 'rate') {
    const v = el.value.trim() === '' ? null : Number(el.value), {cur, kind} = el.dataset;
    if (v !== null && !(Number.isFinite(v) && v > 0 && v < 1e7)) { toast('Enter a rate above zero, as units of currency per EUR 1.'); el.value = data.rates[cur]?.[kind] ?? ''; return; }
    data.rates[cur] = {...(data.rates[cur] || {close: null, avg: null}), [kind]: v}; version++;
    toast(v === null ? `${cur} ${kind === 'close' ? 'closing' : 'average'} rate cleared.` : `${cur} ${kind === 'close' ? 'closing' : 'average'} rate set to ${num(v, 4)}.`);
    render(); return;
  }
  if (c === 'closeDate') { if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) { toast('Enter a close date.'); el.value = data.closeDate; return; } data.closeDate = el.value; version++; toast(`Close date set to ${date(el.value)}.`); render(); return; }
  if (c === 'tolerance') { const v = Number(el.value); if (!Number.isFinite(v) || v < 0 || v > 1e9) { toast('Enter a tolerance from 0 to 1 billion.'); return; } state.tolerance = round2(v); toast(`Tolerance set to ${eur(state.tolerance)}.`); }
  else state[c] = el.value;
  render();
});
render();
