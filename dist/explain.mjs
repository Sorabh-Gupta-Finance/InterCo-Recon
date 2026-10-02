// Root causes and proposed entries for reconciliation exceptions.
// Pure functions: the resolution screen, the workpaper download and the tests share them.
import {round2, toEUR} from './engine.mjs';

export const BUCKETS = ['Timing', 'Missing or wrong booking', 'Price or calculation', 'FX revaluation', 'Accounting policy', 'To investigate'];
const PERIOD_CHARGES = ['service', 'mgmtfee', 'royalty', 'interest'];
const WHT_RATES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const LABEL = {trade: 'goods and recharges', service: 'shared services', mgmtfee: 'management fee', royalty: 'royalty', interest: 'interest', loan: 'loan', cashpool: 'cash pool', dividend: 'dividend', lease: 'lease'};
const label = c => LABEL[c] || c;
const ic = (side, partner) => `Intercompany ${side === 'R' ? 'receivable' : 'payable'}, ${partner}`;
const days = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const day = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'});

/** Local amount at the closing rate. */
export function atClose(amt, cur, lcur, rates) { return round2(amt / rates[cur].close * rates[lcur].close); }

/**
 * Explain every exception in a reconciliation result.
 * Returns one item per root cause. Two exceptions that are the same document booked
 * against the wrong partner become one item, counted once in the gross difference.
 * Each item carries a proposed entry for people to review and a machine fix used to
 * show the reconciliation after the entries.
 */
export function explain(result, {rates, closeDate, windowDays = 5}) {
  const byId = new Map(result.lines.map(l => [l.id, l]));
  const lcurOf = new Map(result.lines.map(l => [l.entity, l.lcur]));
  const matchedIds = new Set(result.matches.flatMap(m => [m.r.id, m.p.id]));
  const items = [], done = new Set();
  const push = (exs, x) => { exs.forEach(e => done.add(e.id)); items.push({exceptionIds: exs.map(e => e.id), creditor: exs[0].creditor, debtor: exs[0].debtor, category: exs[0].category,
    doc: exs[0].doc, status: exs.some(e => e.status === 'Open') ? 'Open' : 'Within tolerance', eur: round2(exs.reduce((s, e) => s + e.eur, 0)), gross: round2(Math.abs(exs[0].eur)), ...x}); };
  // A line the other side should have booked, valued at the closing rate.
  const mirror = (l, entity, partner, amt = l.amt) => { const lcur = lcurOf.get(entity) || l.cur;
    return {entity, partner, side: l.side === 'R' ? 'P' : 'R', category: l.category, doc: l.doc, docDate: l.docDate, cur: l.cur, amt, lcur, lamt: atClose(amt, l.cur, lcur, rates), desc: l.desc}; };
  const entry = (entity, debit, credit, cur, amount) => ({entity, debit, credit, cur, amount: round2(Math.abs(amount)), eurAmount: round2(Math.abs(toEUR(amount, cur, rates)))});

  const unmatched = result.exceptions.filter(e => e.kind === 'Unmatched');
  // 1. The same document, booked by both sides, but one side picked the wrong partner.
  for (const a of unmatched) for (const b of unmatched) {
    if (done.has(a.id) || done.has(b.id) || a === b) continue;
    const r = byId.get(a.lineIds[0]), p = byId.get(b.lineIds[0]);
    if (r.side !== 'R' || p.side !== 'P' || r.doc !== p.doc || r.cur !== p.cur || !near(r.amt, p.amt, 0.005) || r.category !== p.category) continue;
    if (p.entity === r.partner && p.partner !== r.entity) {
      push([a, b], {cause: `${p.entity} booked ${p.doc} against ${p.partner}; the invoice is from ${r.entity}`, bucket: 'Missing or wrong booking', owner: p.entity,
        entry: entry(p.entity, ic('P', p.partner), ic('P', r.entity), p.cur, p.amt), fix: [{op: 'set', id: p.id, changes: {partner: r.entity}}]});
    } else if (r.entity === p.partner && r.partner !== p.entity) {
      push([a, b], {cause: `${r.entity} booked ${r.doc} against ${r.partner}; the debtor is ${p.entity}`, bucket: 'Missing or wrong booking', owner: r.entity,
        entry: entry(r.entity, ic('R', p.entity), ic('R', r.partner), r.cur, r.amt), fix: [{op: 'set', id: r.id, changes: {partner: p.entity}}]});
    }
  }

  for (const e of result.exceptions) {
    if (done.has(e.id)) continue;
    if (e.kind === 'Unmatched') {
      const l = byId.get(e.lineIds[0]), other = l.side === 'R' ? l.debtor : l.creditor, age = days(l.docDate, closeDate);
      const twin = result.lines.find(x => x.id !== l.id && matchedIds.has(x.id) && x.entity === l.entity && x.side === l.side && x.doc === l.doc && x.cur === l.cur && near(x.amt, l.amt, 0.005));
      if (twin) {
        push([e], {cause: `${l.entity} posted ${l.doc} twice`, bucket: 'Missing or wrong booking', owner: l.entity,
          entry: l.side === 'P' ? entry(l.entity, ic('P', l.partner), `Original ${label(l.category)} account (reverse duplicate)`, l.cur, l.amt) : entry(l.entity, `Original ${label(l.category)} account (reverse duplicate)`, ic('R', l.partner), l.cur, l.amt),
          fix: [{op: 'remove', id: l.id}]});
      } else if (l.category === 'dividend') {
        push([e], l.side === 'P'
          ? {cause: `Dividend declared by ${l.entity}; ${other} has not recognised the receivable`, bucket: 'Missing or wrong booking', owner: other,
            entry: entry(other, `Dividend receivable, ${l.entity}`, 'Dividend income', l.cur, l.amt), fix: [{op: 'add', line: mirror(l, other, l.entity)}]}
          : {cause: `${l.entity} recognised a dividend that ${other} has not declared`, bucket: 'Missing or wrong booking', owner: other,
            entry: entry(other, 'Retained earnings (dividend declared)', `Dividend payable, ${l.entity}`, l.cur, l.amt), fix: [{op: 'add', line: mirror(l, other, l.entity)}]});
      } else if (l.category === 'lease') {
        push([e], {cause: `Lease recognised on balance sheet by ${l.entity} only: lessee and lessor accounting differ`, bucket: 'Accounting policy', owner: 'Group',
          entry: entry('Group', l.side === 'P' ? `Lease liability, ${l.entity}` : `Lease receivable, ${l.entity}`, l.side === 'P' ? `Right-of-use asset, ${l.entity}` : `Property, plant and equipment, ${l.entity}`, l.cur, l.amt),
          note: 'Consolidation adjustment: the intragroup lease is eliminated in the group book. No entry in either local book.', fix: [{op: 'remove', id: l.id}]});
      } else if (l.side === 'P' && l.amt < 0) {
        const base = PERIOD_CHARGES.includes(l.category) && result.lines.find(x => x.key === l.key && x.side === 'R' && x.amt > 0 && WHT_RATES.some(t => near(Math.abs(l.amt), x.amt * t, 0.01)));
        if (base) {
          const pct = Math.round(Math.abs(l.amt) / base.amt * 100);
          push([e], {cause: `${l.entity} withheld ${pct}% tax on ${base.doc}; ${other} has not recorded it`, bucket: 'Missing or wrong booking', owner: other,
            entry: entry(other, 'Withholding tax receivable (or expense)', ic('R', l.entity), l.cur, l.amt), fix: [{op: 'add', line: mirror(l, other, l.entity)}]});
        } else if (age <= windowDays) {
          push([e], {cause: `Cash in transit: ${l.entity} paid on ${day(l.docDate)}; ${other} has not received it`, bucket: 'Timing', owner: other,
            entry: entry(other, 'Cash in transit', ic('R', l.entity), l.cur, l.amt), fix: [{op: 'add', line: mirror(l, other, l.entity)}]});
        } else push([e], unknown(l, other));
      } else if (l.side === 'R' && l.amt > 0 && l.category === 'trade' && age <= windowDays) {
        push([e], {cause: `Goods in transit: ${l.entity} invoiced on ${day(l.docDate)}; ${other} has not received them`, bucket: 'Timing', owner: other,
          entry: entry(other, 'Goods in transit', ic('P', l.entity), l.cur, l.amt), fix: [{op: 'add', line: mirror(l, other, l.entity)}]});
      } else if (l.side === 'R' && l.amt > 0 && PERIOD_CHARGES.includes(l.category)) {
        push([e], {cause: `${other} has not accrued the ${label(l.category)} charged by ${l.entity}`, bucket: 'Missing or wrong booking', owner: other,
          entry: entry(other, `${label(l.category)[0].toUpperCase() + label(l.category).slice(1)} expense`, ic('P', l.entity), l.cur, l.amt), fix: [{op: 'add', line: mirror(l, other, l.entity)}]});
      } else push([e], unknown(l, other));
    } else if (e.kind === 'Amount difference') {
      const [r, p] = e.lineIds.map(id => byId.get(id)), diff = round2(r.amt - p.amt), ratio = p.amt / r.amt;
      const dayCount = r.category === 'interest' && (near(ratio, 365 / 360, 0.0005) || near(ratio, 360 / 365, 0.0005));
      const cause = dayCount ? `Interest day count differs: ${ratio < 1 ? `${r.entity} uses actual/360, ${p.entity} actual/365` : `${r.entity} uses actual/365, ${p.entity} actual/360`}`
        : PERIOD_CHARGES.includes(r.category) ? `${p.entity} applied a different transfer-pricing rate from ${r.entity}'s invoice` : `${p.entity} booked ${p.doc} at a different amount from ${r.entity}'s invoice`;
      const account = r.category === 'trade' ? 'Inventory or cost of sales' : `${label(r.category)[0].toUpperCase() + label(r.category).slice(1)} expense`;
      push([e], {cause, bucket: 'Price or calculation', owner: p.entity,
        entry: diff > 0 ? entry(p.entity, account, ic('P', r.entity), r.cur, diff) : entry(p.entity, ic('P', r.entity), account, r.cur, diff),
        note: `Assumes ${r.entity}'s invoice is correct; confirm against the ${dayCount ? 'loan agreement' : 'intercompany agreement'}.`,
        fix: [{op: 'set', id: p.id, changes: {amt: r.amt, lamt: p.cur === p.lcur ? r.amt : atClose(r.amt, p.cur, p.lcur, rates)}}]});
    } else if (e.kind === 'FX translation') {
      const ls = result.lines.filter(l => l.key === pairKeyOf(e) && l.cur !== l.lcur);
      const off = ls.map(l => ({l, dev: round2(l.lamt - atClose(l.amt, l.cur, l.lcur, rates))})).filter(x => Math.abs(x.dev) >= 0.01);
      const who = [...new Set(off.map(x => x.l.entity))];
      if (who.length === 1) {
        const ent = who[0], dev = round2(off.reduce((s, x) => s + x.dev, 0)), side = off[0].l.side, lcur = off[0].l.lcur, partner = off[0].l.partner;
        // A payable or receivable carried below its closing-rate value is topped up, and the reverse.
        const up = dev < 0, isP = side === 'P';
        push([e], {cause: `${ent} did not revalue the ${label(e.category)} balance at the closing rate`, bucket: 'FX revaluation', owner: ent,
          entry: isP ? (up ? entry(ent, 'FX loss', ic('P', partner), lcur, dev) : entry(ent, ic('P', partner), 'FX gain', lcur, dev))
            : (up ? entry(ent, ic('R', partner), 'FX gain', lcur, dev) : entry(ent, 'FX loss', ic('R', partner), lcur, dev)),
          fix: off.map(x => ({op: 'set', id: x.l.id, changes: {lamt: atClose(x.l.amt, x.l.cur, x.l.lcur, rates)}}))});
      } else push([e], {cause: 'Local-currency balances translate to different EUR amounts; more than one entity is affected', bucket: 'FX revaluation', owner: 'Both', entry: null, fix: []});
    }
  }
  items.sort((a, b) => b.gross - a.gross);
  items.forEach((it, i) => { it.id = `R${String(i + 1).padStart(2, '0')}`; });
  return items;
}
const pairKeyOf = e => `${e.creditor}>${e.debtor}|${e.category}`;
function unknown(l, other) {
  return {cause: `Booked by ${l.entity} only; ${other} to confirm`, bucket: 'To investigate', owner: other, entry: null,
    note: 'No rule fits. Ask the partner for the document before proposing an entry.', fix: []};
}

/** Totals by cause, in bucket order. */
export function byBucket(items) {
  return BUCKETS.map(b => { const xs = items.filter(i => i.bucket === b); return {bucket: b, items: xs.length, gross: round2(xs.reduce((s, i) => s + i.gross, 0))}; }).filter(b => b.items);
}

/** The lines as they would stand after every proposed entry. */
export function applyFixes(lines, items) {
  const out = new Map(lines.map(l => [l.id, {...l}]));
  let n = 0;
  for (const f of items.flatMap(i => i.fix)) {
    if (f.op === 'remove') out.delete(f.id);
    else if (f.op === 'set' && out.has(f.id)) Object.assign(out.get(f.id), f.changes);
    else if (f.op === 'add') { const id = `ADJ${String(++n).padStart(3, '0')}`; out.set(id, {...f.line, id}); }
  }
  return [...out.values()].map(({creditor, debtor, key, ...l}) => l);
}
