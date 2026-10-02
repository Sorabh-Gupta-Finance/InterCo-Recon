// Intercompany reconciliation engine. Pure functions, no DOM: the UI, the CSV
// export and the tests all use the same code.

export function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
const EPS = 0.005;

export function toEUR(amount, cur, rates, kind = 'close') {
  const r = rates[cur];
  if (!r) throw Error(`No ${kind} rate for ${cur}.`);
  return amount / r[kind];
}
function group(xs, f) { const m = new Map(); for (const x of xs) { const k = f(x); m.has(k) ? m.get(k).push(x) : m.set(k, [x]); } return m; }
function days(from, to) { return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5); }

const REQUIRED = ['entity', 'partner', 'side', 'category', 'doc', 'docDate', 'cur', 'amt', 'lcur', 'lamt'];
export function validateLines(lines, rates, entityCodes) {
  const errors = [];
  lines.forEach((l, i) => {
    const at = `Line ${i + 1}`;
    for (const k of REQUIRED) if (l[k] === undefined || l[k] === '') errors.push(`${at}: ${k} is missing.`);
    if (!['R', 'P'].includes(l.side)) errors.push(`${at}: side must be R (receivable) or P (payable).`);
    if (!Number.isFinite(+l.amt) || !Number.isFinite(+l.lamt)) errors.push(`${at}: amounts must be numbers.`);
    if (l.cur && !rates[l.cur]) errors.push(`${at}: no rate for ${l.cur}.`);
    if (l.lcur && !rates[l.lcur]) errors.push(`${at}: no rate for ${l.lcur}.`);
    if (entityCodes && l.entity && !entityCodes.includes(l.entity)) errors.push(`${at}: unknown entity ${l.entity}.`);
    if (entityCodes && l.partner && !entityCodes.includes(l.partner)) errors.push(`${at}: unknown partner ${l.partner}.`);
    if (l.entity && l.entity === l.partner) errors.push(`${at}: entity and partner are the same.`);
  });
  return errors;
}

// Who is owed and who owes, whichever side booked the line.
function orient(l) {
  return l.side === 'R' ? {creditor: l.entity, debtor: l.partner} : {creditor: l.partner, debtor: l.entity};
}
export const pairKey = (creditor, debtor, category) => `${creditor}>${debtor}|${category}`;

/**
 * Reconcile intercompany lines.
 * Pass 1 exact: same pair, category, document, currency and amount.
 * Pass 2 close: same pair, category, document and currency; amounts differ.
 * Pass 3 no reference: same pair, category, currency and amount, documents differ, dates within 5 days.
 * Then a translation check per pair and category: the EUR value of each side's local
 * amounts must agree once the transaction-currency differences are explained.
 */
export function reconcile(input, {rates, closeDate, tolerance = 1000, dateWindow = 5}) {
  const lines = input.map(l => {
    const o = orient(l);
    return {...l, amt: +l.amt, lamt: +l.lamt, ...o, key: pairKey(o.creditor, o.debtor, l.category)};
  });
  const R = lines.filter(l => l.side === 'R'), P = lines.filter(l => l.side === 'P');
  const used = new Set(), matches = [];
  const take = (r, p, pass) => { used.add(r.id); used.add(p.id); matches.push({pass, r, p, diff: round2(r.amt - p.amt)}); };
  const free = l => !used.has(l.id);

  // Payables indexed by pair and account type, so large files match quickly.
  const byKey = group(P, l => l.key), cands = r => byKey.get(r.key) || [];
  for (const r of R) { const p = cands(r).find(p => free(p) && p.doc === r.doc && p.cur === r.cur && Math.abs(p.amt - r.amt) < EPS); if (p) take(r, p, 1); }
  for (const r of R.filter(free)) { const p = cands(r).find(p => free(p) && p.doc === r.doc && p.cur === r.cur); if (p) take(r, p, 2); }
  for (const r of R.filter(free)) {
    const p = cands(r).find(p => free(p) && p.doc !== r.doc && p.cur === r.cur && Math.abs(p.amt - r.amt) < EPS && Math.abs(days(p.docDate, r.docDate)) <= dateWindow);
    if (p) take(r, p, 3);
  }

  const exceptions = [];
  const add = e => exceptions.push({...e, eur: round2(e.eur), status: Math.abs(e.eur) <= tolerance ? 'Within tolerance' : 'Open'});
  // Difference sign: positive = the creditor shows more than the debtor.
  for (const l of lines.filter(free)) {
    const diffTC = l.side === 'R' ? l.amt : -l.amt;
    add({kind: 'Unmatched', creditor: l.creditor, debtor: l.debtor, category: l.category, doc: l.doc, docDate: l.docDate,
      foundIn: l.entity, missingIn: l.side === 'R' ? l.debtor : l.creditor, cur: l.cur, diffTC: round2(diffTC),
      eur: toEUR(diffTC, l.cur, rates), age: days(l.docDate, closeDate), lineIds: [l.id], desc: l.desc});
  }
  for (const m of matches.filter(m => Math.abs(m.diff) >= EPS)) {
    add({kind: 'Amount difference', creditor: m.r.creditor, debtor: m.r.debtor, category: m.r.category, doc: m.r.doc, docDate: m.r.docDate,
      foundIn: `${m.r.entity} ${fmt(m.r.amt)} vs ${m.p.entity} ${fmt(m.p.amt)}`, missingIn: '', cur: m.r.cur, diffTC: m.diff,
      eur: toEUR(m.diff, m.r.cur, rates), age: days(m.r.docDate, closeDate), lineIds: [m.r.id, m.p.id], desc: m.r.desc});
  }

  // Translation check, per pair and category.
  const linesByKey = group(lines, l => l.key), exByKey = group(exceptions, e => pairKey(e.creditor, e.debtor, e.category));
  const pairs = [...linesByKey].map(([key, ls]) => {
    const {creditor, debtor, category} = ls[0];
    const credEUR = ls.filter(l => l.side === 'R').reduce((s, l) => s + toEUR(l.lamt, l.lcur, rates), 0);
    const debtEUR = ls.filter(l => l.side === 'P').reduce((s, l) => s + toEUR(l.lamt, l.lcur, rates), 0);
    const explained = (exByKey.get(key) || []).reduce((s, e) => s + e.eur, 0);
    const residual = credEUR - debtEUR - explained;
    return {key, creditor, debtor, category, credEUR, debtEUR, diffEUR: credEUR - debtEUR, residual, lines: ls.length};
  });
  for (const pr of pairs.filter(p => Math.abs(p.residual) > 1)) {
    const debtorLines = lines.filter(l => l.key === pr.key && l.side === 'P' && l.cur !== l.lcur);
    add({kind: 'FX translation', creditor: pr.creditor, debtor: pr.debtor, category: pr.category, doc: 'Balance', docDate: closeDate,
      foundIn: 'Local-currency balances', missingIn: '', cur: 'EUR', diffTC: round2(pr.residual), eur: pr.residual, age: 0,
      lineIds: debtorLines.map(l => l.id), desc: 'Transaction amounts agree; local-currency values translate to different EUR amounts'});
  }

  exceptions.sort((a, b) => Math.abs(b.eur) - Math.abs(a.eur));
  exceptions.forEach((e, i) => { e.id = `X${String(i + 1).padStart(2, '0')}`; });

  const matchedLines = lines.length - lines.filter(free).length;
  const open = exceptions.filter(e => e.status === 'Open');
  return {
    lines, matches, exceptions, pairs,
    summary: {
      lines: lines.length, matchedLines, matchRate: lines.length ? matchedLines / lines.length : 0,
      exceptions: exceptions.length, open: open.length, withinTolerance: exceptions.length - open.length,
      grossEUR: round2(exceptions.reduce((s, e) => s + Math.abs(e.eur), 0)),
      openEUR: round2(open.reduce((s, e) => s + Math.abs(e.eur), 0)),
      byPass: [1, 2, 3].map(p => matches.filter(m => m.pass === p).length),
    },
  };
}

// Entity x entity view: net EUR difference per creditor/debtor pair, all categories.
export function pairMatrix(result, entityCodes) {
  const cell = (c, d) => {
    const prs = result.pairs.filter(p => p.creditor === c && p.debtor === d);
    if (!prs.length) return null;
    const ex = result.exceptions.filter(e => e.creditor === c && e.debtor === d);
    return {
      creditor: c, debtor: d,
      balanceEUR: round2(prs.reduce((s, p) => s + p.credEUR, 0)),
      diffEUR: round2(prs.reduce((s, p) => s + p.diffEUR, 0)),
      open: ex.filter(e => e.status === 'Open').length,
      tolerance: ex.filter(e => e.status !== 'Open').length,
      status: ex.some(e => e.status === 'Open') ? 'open' : ex.length ? 'tolerance' : 'matched',
    };
  };
  return entityCodes.map(c => entityCodes.map(d => (c === d ? null : cell(c, d))));
}

function fmt(n) { return Number(n).toLocaleString('en-US', {maximumFractionDigits: 2}); }

export function csv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const safe = x => { let v = typeof x === 'number' ? String(round2(x)) : String(x ?? ''); if (typeof x !== 'number' && /^[=+@\-\t\r]/.test(v)) v = "'" + v; return '"' + v.replaceAll('"', '""') + '"'; };
  return [keys.map(safe).join(','), ...rows.map(r => keys.map(k => safe(r[k])).join(','))].join('\r\n');
}
