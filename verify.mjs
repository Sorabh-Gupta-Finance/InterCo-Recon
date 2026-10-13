import assert from 'node:assert/strict';
import {reconcile, pairMatrix, validateLines, csv, toGroup, round2} from './dist/engine.mjs';
import {sampleLines, rates, closeDate, entities} from './dist/data.mjs';
import {explain, applyFixes, byBucket, offRateLines, convertedWarnings} from './dist/explain.mjs';
import {importLines, toTemplateRows, parseCSV, parseDate, parseAmount, monthEnd, detectDateOrder, detectSigns} from './dist/io.mjs';

const codes = entities.map(e => e.code);
const close = (a, b, t = 0.01) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);

assert.deepEqual(validateLines(sampleLines, rates, codes), [], 'sample data is valid');
const r = reconcile(sampleLines, {rates, closeDate, tolerance: 1000});

// Every seeded exception is found, with its kind, pair, document and USD amount.
const expected = [
  ['Unmatched', 'US01', 'UK01', 'license', 'INV-US01-UK-0330', 420000, 'Open'],                  // 1 invoice in transit
  ['Unmatched', 'US01', 'SG01', 'license', 'PAY-SG01-0331', 300000, 'Open'],                     // 2 cash in transit
  ['Unmatched', 'US01', 'DE01', 'sbc', 'SBC-US01-DE-Q1', 130000, 'Open'],                        // 3 missing accrual
  ['Unmatched', 'US01', 'BR01', 'royalty', 'WHT-BR01-ROY-Q1', 9000, 'Open'],                     // 4 withholding tax
  ['FX translation', 'US01', 'BR01', 'license', 'Balance', 250000 - 1362500 / 5.65, 'Open'],     // 5 missing revaluation
  ['Amount difference', 'IN01', 'US01', 'service', 'INV-IN01-RD-Q1-TU', 540000 - 525913.04, 'Open'], // 6 transfer-pricing rate
  ['Amount difference', 'US01', 'IN01', 'interest', 'INT-US01-IN01-Q1', 62500 - 61643.84, 'Within tolerance'], // 7 day count
  ['Unmatched', 'IN01', 'SG01', 'service', 'INV-IN01-SG-0331', 80000, 'Open'],                   // 8 wrong partner, side A
  ['Unmatched', 'US01', 'SG01', 'service', 'INV-IN01-SG-0331', -80000, 'Open'],                  // 8 wrong partner, side B
  ['Unmatched', 'US01', 'UK01', 'license', 'INV-US01-UK-0209', -95000, 'Open'],                  // 9 duplicate
  ['Unmatched', 'US01', 'SG01', 'dividend', 'DIV-SG01-2026-01', -500000, 'Open'],                // 10 dividend
  ['Unmatched', 'US01', 'IN01', 'lease', 'LSE-US01-IN01', -500000, 'Open'],                      // 11 lessee/lessor
];
assert.equal(r.exceptions.length, expected.length, 'no false exceptions');
for (const [kind, creditor, debtor, category, doc, amount, status] of expected) {
  const hit = r.exceptions.filter(e => e.kind === kind && e.creditor === creditor && e.debtor === debtor && e.category === category && e.doc === doc);
  assert.equal(hit.length, 1, `found once: ${kind} ${creditor}>${debtor} ${doc}`);
  close(hit[0].eur, amount);
  assert.equal(hit[0].status, status, `${doc} status`);
}

// Everything else matches, and no clean pair carries an unexplained translation residual.
assert.equal(r.summary.lines, sampleLines.length);
assert.equal(r.summary.matchedLines, sampleLines.length - 9, 'only the 9 seeded single-sided lines stay unmatched');
for (const p of r.pairs) if (p.key !== 'US01>BR01|license') assert.ok(Math.abs(p.residual) <= 1, `${p.key} residual ${p.residual}`);
close(r.summary.grossEUR, 2137792.68);
assert.equal(r.summary.withinTolerance, 1);

// Each pair's difference equals the sum of its exceptions.
for (const p of r.pairs) {
  const ex = r.exceptions.filter(e => e.creditor === p.creditor && e.debtor === p.debtor && e.category === p.category).reduce((s, e) => s + e.eur, 0);
  close(p.diffEUR, ex, 0.02);
}

// Pair matrix: a status for every trading relationship, none on the diagonal.
const m = pairMatrix(r, codes);
codes.forEach((c, i) => assert.equal(m[i][i], null));
const cell = (c, d) => m[codes.indexOf(c)][codes.indexOf(d)];
assert.equal(cell('US01', 'UK01').status, 'open');
assert.equal(cell('DE01', 'US01').status, 'matched');
assert.equal(cell('UK01', 'US01').status, 'matched');
assert.equal(cell('DE01', 'SG01'), null, 'no relationship, no cell');

// Matching passes: pass 3 links an item whose document reference differs.
const noRef = [
  {id: 'A', entity: 'US01', partner: 'UK01', side: 'R', category: 'license', doc: 'INV-1', docDate: '2026-03-10', cur: 'USD', amt: 1000, lcur: 'USD', lamt: 1000},
  {id: 'B', entity: 'UK01', partner: 'US01', side: 'P', category: 'license', doc: 'AP-77', docDate: '2026-03-13', cur: 'USD', amt: 1000, lcur: 'GBP', lamt: 790},
];
const r3 = reconcile(noRef, {rates, closeDate});
assert.equal(r3.exceptions.length, 0); assert.equal(r3.summary.byPass[2], 1);
const late = reconcile([noRef[0], {...noRef[1], docDate: '2026-03-25'}], {rates, closeDate});
assert.equal(late.exceptions.length, 2, 'outside the 5-day window, both sides stay open');

// Tolerance is a setting.
assert.equal(reconcile(sampleLines, {rates, closeDate, tolerance: 0}).summary.withinTolerance, 0);
assert.equal(reconcile(sampleLines, {rates, closeDate, tolerance: 10000}).summary.withinTolerance, 3, "day count, FX and withholding tax");

// Group currency: the same data with rates restated per EUR gives the same exceptions, valued in EUR.
const perEUR = Object.fromEntries(Object.entries(rates).map(([c, v]) => [c, {close: v.close / rates.EUR.close, avg: v.avg / rates.EUR.avg}]));
const rE = reconcile(sampleLines, {rates: perEUR, closeDate, tolerance: 1000 * 0.925});
assert.deepEqual(rE.exceptions.map(e => [e.kind, e.doc, e.status]), r.exceptions.map(e => [e.kind, e.doc, e.status]));
close(rE.summary.grossEUR, r.summary.grossEUR * 0.925, 0.1);

// Input validation and CSV safety.
assert.ok(validateLines([{...sampleLines[0], side: 'X'}], rates, codes).length);
assert.ok(validateLines([{...sampleLines[0], cur: 'JPY'}], rates, codes).length);
assert.ok(validateLines([{...sampleLines[0], partner: sampleLines[0].entity}], rates, codes).length);
assert.match(csv([{a: '=SUM(A1)', b: 2}]), /"'=SUM/);
close(toGroup(92.5, 'EUR', rates), 100);
close(round2(1.005), 1.01);

// Upload: the sample data, downloaded in template layout, loads back in and reconciles identically.
const back = importLines(csv(toTemplateRows(sampleLines)));
assert.deepEqual(back.errors, []); assert.equal(back.ask, null);
assert.equal(back.lines.length, sampleLines.length);
assert.deepEqual(back.entities.map(e => e.code), [...codes].sort());
assert.equal(back.entities.find(e => e.code === 'IN01').currency, 'INR');
assert.equal(back.maxDate, '2026-03-31');
const rb = reconcile(back.lines, {rates, closeDate, tolerance: 1000});
assert.deepEqual(rb.summary, r.summary);
assert.deepEqual(rb.exceptions.map(e => [e.id, e.kind, e.doc, e.eur]), r.exceptions.map(e => [e.id, e.kind, e.doc, e.eur]));

// Upload: the same data exported the ERP way, payables as negative credits and US dates, loads to the same result.
const us = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}/${d.slice(2, 4)}`;
const erp = importLines(csv(toTemplateRows(sampleLines.map(l => ({...l, docDate: us(l.docDate), amt: l.side === 'P' ? -l.amt : l.amt, lamt: l.side === 'P' ? -l.lamt : l.lamt})))));
assert.deepEqual(erp.errors, []); assert.equal(erp.ask, null);
assert.ok(erp.notes.some(n => /month\/day/.test(n)) && erp.notes.some(n => /negative \(credit\)/.test(n)), erp.notes.join(' | '));
assert.deepEqual(reconcile(erp.lines, {rates, closeDate, tolerance: 1000}).summary, r.summary);

// Upload parsing: separators, byte-order mark, quotes, dates and number formats.
assert.deepEqual(parseCSV('﻿a;b\r\n"x;1";"say ""hi"""\n'), [['a', 'b'], ['x;1', 'say "hi"']]);
assert.equal(parseDate('2026-03-12'), '2026-03-12'); assert.equal(parseDate('12/03/2026'), '2026-03-12');
assert.equal(parseDate('12-Mar-2026'), '2026-03-12'); assert.equal(parseDate('31/02/2026'), null); assert.equal(parseDate('03-12'), null);
assert.equal(parseDate('1/5/26', 'MDY'), '2026-01-05'); assert.equal(parseDate('1/5/26', 'DMY'), '2026-05-01'); assert.equal(parseDate('31.03.26'), '2026-03-31');
assert.deepEqual(detectDateOrder(['1/5/26', '3/31/26']), {order: 'MDY', evidence: '3/31/26'});
assert.deepEqual(detectDateOrder(['1/5/26', '31/3/26']), {order: 'DMY', evidence: '31/3/26'});
assert.deepEqual(detectDateOrder(['1/5/26', '2/6/26']), {ask: true, example: '1/5/26'});
assert.ok(detectDateOrder(['31/3/26', '3/31/26']).conflict);
assert.deepEqual(detectDateOrder(['2026-01-05']), {order: 'DMY'});
assert.equal(parseAmount('95,000.50'), 95000.5); assert.equal(parseAmount('(1,200)'), -1200); assert.equal(parseAmount('1200-'), -1200);
assert.equal(parseAmount('−7.5'), -7.5); assert.equal(parseAmount('12a'), null); assert.equal(parseAmount(''), null);
assert.equal(monthEnd('2026-02-14'), '2026-02-28');
const hdr = 'Entity,Partner,Side,Account type,Document,Document date,Currency,Amount,Local currency,Local amount\n';
const goodText = hdr + 'SG01,JP01,receivable,Trade,A1,2026-06-02,JPY,"1,000,000",SGD,8700\nJP01,SG01,P,trade,A1,02/06/2026,JPY,1000000,JPY,1000000\n';
assert.deepEqual(importLines(goodText).ask, {dateOrder: '02/06/2026'}, '02/06 could be either way round');
const good = importLines(goodText, {dateOrder: 'DMY'});
assert.deepEqual(good.errors, []); assert.equal(good.lines[0].side, 'R'); assert.equal(good.lines[0].category, 'trade');
assert.deepEqual(good.currencies, ['JPY', 'SGD']); assert.equal(monthEnd(good.maxDate), '2026-06-30');
assert.match(importLines('entity,partner\nA,B\n').errors[0], /Missing columns: side, account_type/);
const bad = importLines(hdr + 'SG01,SG01,X,trade,A1,2026-13-01,JP,abc,SGD,1\nSG01,JP01,R,trade,A2,2026-06-01,USD,5,USD,6\nSG01,JP01,R,trade,A3,2026-06-01,USD,5,EUR,4\nSG01,JP01,R,trade,A4,2026-06-01,USD,5,SGD,7\n');
for (const m of [/entity and partner are both SG01/, /side "X"/, /date "2026-13-01"/, /currency "JP"/, /amount "abc"/, /should be equal/, /more than one local currency/]) assert.ok(bad.errors.some(e => m.test(e)), String(m));
assert.equal(bad.lines.length, 2, 'bad rows are left out');
assert.match(importLines(hdr + '<b>,JP01,R,trade,A1,2026-06-01,JPY,1,SGD,1\n').errors[0], /short code/);

// Upload questions: ambiguous dates and ambiguous signs are asked, not guessed.
const amb = hdr + 'SG01,JP01,R,trade,A1,1/5/26,USD,100,USD,100\nJP01,SG01,P,trade,A1,1/5/26,USD,100,JPY,16000\n';
assert.deepEqual(importLines(amb).ask, {dateOrder: '1/5/26'}); assert.equal(importLines(amb).lines.length, 0);
assert.equal(importLines(amb, {dateOrder: 'MDY'}).lines[0].docDate, '2026-01-05');
assert.equal(importLines(amb, {dateOrder: 'DMY'}).lines[0].docDate, '2026-05-01');
assert.match(importLines(hdr + 'SG01,JP01,R,trade,A1,31/3/26,USD,1,USD,1\nJP01,SG01,P,trade,A1,3/31/26,USD,1,JPY,160\n').errors[0], /both day-first/);
const mixed = hdr + 'SG01,JP01,R,trade,A1,2026-01-05,USD,100,USD,100\nJP01,SG01,P,trade,A1,2026-01-05,USD,100,JPY,16000\nSG01,JP01,R,trade,A2,2026-01-05,USD,50,USD,50\nJP01,SG01,P,trade,A2,2026-01-05,USD,-50,JPY,-8000\n';
assert.deepEqual(importLines(mixed).ask, {signs: true});
assert.equal(importLines(mixed, {signs: 'balance'}).lines.length, 4);
assert.equal(detectSigns([{side: 'R', entity: 'A', partner: 'B', category: 't', doc: 'X', cur: 'USD', amt: 10}, {side: 'P', entity: 'B', partner: 'A', category: 't', doc: 'X', cur: 'USD', amt: -10}]), 'signed');
assert.equal(detectSigns([{side: 'P', entity: 'B', partner: 'A', category: 't', doc: 'X', cur: 'USD', amt: 10}]), 'balance');

// Resolution: a cause for every seeded difference, one item for the mis-posted invoice, and nothing left after the entries.
const items = explain(r, {rates, closeDate});
assert.equal(items.length, 11, 'eleven items: the wrong-partner invoice is one item across two exceptions');
close(items.reduce((t, i) => t + i.gross, 0), 2057792.68);
const item = doc => items.find(i => i.doc === doc);
for (const [doc, bucket, owner, cause, cur, amount] of [
  ['INV-US01-UK-0330', 'Timing', 'UK01', /Invoice in transit/, 'USD', 420000],
  ['PAY-SG01-0331', 'Timing', 'US01', /Cash in transit/, 'USD', 300000],
  ['SBC-US01-DE-Q1', 'Missing or wrong booking', 'DE01', /not accrued the stock compensation recharge/, 'USD', 130000],
  ['WHT-BR01-ROY-Q1', 'Missing or wrong booking', 'US01', /withheld 15% tax/, 'USD', 9000],
  ['Balance', 'FX revaluation', 'BR01', /BR01 did not revalue/, 'BRL', 50000],
  ['INV-IN01-RD-Q1-TU', 'Price or calculation', 'US01', /transfer-pricing rate/, 'USD', 14086.96],
  ['INT-US01-IN01-Q1', 'Price or calculation', 'IN01', /day count/, 'USD', 856.16],
  ['INV-IN01-SG-0331', 'Missing or wrong booking', 'SG01', /against US01; the invoice is from IN01/, 'USD', 80000],
  ['INV-US01-UK-0209', 'Missing or wrong booking', 'UK01', /posted INV-US01-UK-0209 twice/, 'USD', 95000],
  ['DIV-SG01-2026-01', 'Missing or wrong booking', 'US01', /Dividend declared by SG01/, 'USD', 500000],
  ['LSE-US01-IN01', 'Accounting policy', 'Group', /lessee and lessor/, 'USD', 500000],
]) {
  const i = item(doc);
  assert.ok(i, doc); assert.equal(i.bucket, bucket, doc); assert.equal(i.owner, owner, doc); assert.match(i.cause, cause);
  assert.equal(i.entry.cur, cur, doc); close(i.entry.amount, amount);
}
assert.equal(item('INV-IN01-SG-0331').exceptionIds.length, 2);
assert.match(item('Balance').entry.debit, /FX loss/);
const after = reconcile(applyFixes(r.lines, items), {rates, closeDate});
assert.equal(after.summary.exceptions, 0, 'every pair clears after the proposed entries');
assert.equal(after.summary.matchedLines, after.summary.lines);
assert.deepEqual(byBucket(items).map(b => [b.bucket, b.items]), [['Timing', 2], ['Missing or wrong booking', 5], ['Price or calculation', 2], ['FX revaluation', 1], ['Accounting policy', 1]]);

// Resolution on other data: an unexplained one-sided line stays open with no entry; a price difference gets an entry.
const own = importLines(hdr + 'SG01,JP01,R,trade,A1,2026-01-10,USD,100,SGD,150\nSG01,JP01,R,trade,A2,2026-06-01,USD,200,SGD,300\nJP01,SG01,P,trade,A2,2026-06-01,USD,190,JPY,30780\n');
const ownRates = {EUR: {close: 1}, USD: {close: 1}, SGD: {close: 1.5}, JPY: {close: 162}};
const ownR = reconcile(own.lines, {rates: ownRates, closeDate: '2026-06-30'}), ownItems = explain(ownR, {rates: ownRates, closeDate: '2026-06-30'});
assert.equal(ownItems.find(i => i.doc === 'A1').bucket, 'To investigate'); assert.equal(ownItems.find(i => i.doc === 'A1').entry, null);
assert.match(ownItems.find(i => i.doc === 'A2').cause, /different amount/); close(ownItems.find(i => i.doc === 'A2').entry.amount, 10);
assert.equal(reconcile(applyFixes(ownR.lines, ownItems), {rates: ownRates, closeDate: '2026-06-30'}).summary.exceptions, 1, 'only the unexplained line is left');

// Review changes: lease shown as a consolidation adjustment, the FX cause names the rate used,
// line-by-line FX check, and a warning for local amounts already converted to the group currency.
assert.equal(item('LSE-US01-IN01').status, 'Consolidation adjustment');
assert.match(item('LSE-US01-IN01').note, /Simplified/);
assert.match(item('Balance').cause, /used 5\.45 BRL per USD; the closing rate is 5\.65/);
const off = offRateLines(r.lines, rates);
assert.equal(off.length, 1, 'only the seeded BR01 line is off the closing rate');
assert.equal(off[0].line.doc, 'INV-US01-BR-0316'); close(off[0].dev, -50000); close(off[0].devGroup, -8849.56); assert.equal(off[0].usedRate, '5.45');
const offset = [
  {id: 'a', entity: 'US01', partner: 'UK01', side: 'R', category: 'license', doc: 'D1', docDate: '2026-03-01', cur: 'USD', amt: 1000, lcur: 'USD', lamt: 1000},
  {id: 'b', entity: 'UK01', partner: 'US01', side: 'P', category: 'license', doc: 'D1', docDate: '2026-03-01', cur: 'USD', amt: 1000, lcur: 'GBP', lamt: 800},
  {id: 'c', entity: 'US01', partner: 'UK01', side: 'R', category: 'license', doc: 'D2', docDate: '2026-03-01', cur: 'USD', amt: 1000, lcur: 'USD', lamt: 1000},
  {id: 'd', entity: 'UK01', partner: 'US01', side: 'P', category: 'license', doc: 'D2', docDate: '2026-03-01', cur: 'USD', amt: 1000, lcur: 'GBP', lamt: 780},
];
const rOff = reconcile(offset, {rates, closeDate});
assert.equal(rOff.exceptions.length, 0, 'the two errors offset, so the pair totals agree');
assert.equal(offRateLines(rOff.lines, rates).length, 2, 'but each line is still listed');
assert.deepEqual(convertedWarnings(r.lines, rates, 'USD'), [], 'no warning on the sample');
const asUSD = sampleLines.map(l => (l.entity === 'UK01' && l.cur !== l.lcur ? {...l, lamt: l.amt / rates[l.cur].close} : l));
const w = convertedWarnings(reconcile(asUSD, {rates, closeDate}).lines, rates, 'USD');
assert.equal(w.length, 1); assert.equal(w[0].entity, 'UK01'); assert.equal(w[0].lcur, 'GBP'); assert.equal(w[0].hits, w[0].total);

console.log(JSON.stringify({result: 'passed', items: items.length, itemGrossUSD: round2(items.reduce((t, i) => t + i.gross, 0)), lines: r.summary.lines, matched: r.summary.matchedLines, exceptions: r.summary.exceptions, grossUSD: r.summary.grossEUR, byPass: r.summary.byPass}));
