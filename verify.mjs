import assert from 'node:assert/strict';
import {reconcile, pairMatrix, validateLines, csv, toEUR, round2} from './dist/engine.mjs';
import {sampleLines, rates, closeDate, entities} from './dist/data.mjs';
import {importLines, toTemplateRows, parseCSV, parseDate, parseAmount, monthEnd} from './dist/io.mjs';

const codes = entities.map(e => e.code);
const close = (a, b, t = 0.01) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);

assert.deepEqual(validateLines(sampleLines, rates, codes), [], 'sample data is valid');
const r = reconcile(sampleLines, {rates, closeDate, tolerance: 1000});

// Every seeded exception is found, with its kind, pair, document and EUR amount.
const expected = [
  ['Unmatched', 'DE02', 'US01', 'trade', 'INV-DE02-US-0330', 420000 / 1.08, 'Open'],        // 1 goods in transit
  ['Unmatched', 'DE02', 'US01', 'trade', 'PAY-US01-0331', 300000 / 1.08, 'Open'],           // 2 cash in transit
  ['Unmatched', 'DE01', 'IN01', 'mgmtfee', 'ACR-DE01-MF-Q1-IN01', 120000, 'Open'],          // 3 missing accrual
  ['Unmatched', 'DE01', 'BR01', 'royalty', 'WHT-BR01-ROY-Q1', 9000, 'Open'],                // 4 withholding tax
  ['FX translation', 'DE02', 'BR01', 'trade', 'Balance', 250000 - 1475000 / 6.1, 'Open'],   // 5 missing revaluation
  ['Amount difference', 'IN01', 'US01', 'service', 'INV-IN01-SS-Q1-US01', 15000 / 1.08, 'Open'], // 6 transfer-pricing rate
  ['Amount difference', 'DE01', 'US01', 'interest', 'INT-DE01-US01-Q1', (62500 - 61643.84) / 1.08, 'Within tolerance'], // 7 day count
  ['Unmatched', 'CN01', 'IN01', 'trade', 'INV-CN01-IN-0315', 80000 / 1.08, 'Open'],         // 8 wrong partner, side A
  ['Unmatched', 'DE02', 'IN01', 'trade', 'INV-CN01-IN-0315', -80000 / 1.08, 'Open'],        // 8 wrong partner, side B
  ['Unmatched', 'DE02', 'US01', 'trade', 'INV-DE02-US-0209', -95000 / 1.08, 'Open'],        // 9 duplicate
  ['Unmatched', 'DE01', 'US01', 'dividend', 'DIV-US01-2026-01', -500000 / 1.08, 'Open'],    // 10 dividend
  ['Unmatched', 'DE01', 'IN01', 'lease', 'LSE-DE01-IN01', -500000, 'Open'],                 // 11 GAAP difference
];
assert.equal(r.exceptions.length, expected.length, 'no false exceptions');
for (const [kind, creditor, debtor, category, doc, eur, status] of expected) {
  const hit = r.exceptions.filter(e => e.kind === kind && e.creditor === creditor && e.debtor === debtor && e.category === category && e.doc === doc);
  assert.equal(hit.length, 1, `found once: ${kind} ${creditor}>${debtor} ${doc}`);
  close(hit[0].eur, eur);
  assert.equal(hit[0].status, status, `${doc} status`);
}

// Everything else matches, and no clean pair carries an unexplained translation residual.
assert.equal(r.summary.lines, sampleLines.length);
assert.equal(r.summary.matchedLines, sampleLines.length - 9, 'only the 9 seeded single-sided lines stay unmatched');
for (const p of r.pairs) if (p.key !== 'DE02>BR01|trade') assert.ok(Math.abs(p.residual) <= 1, `${p.key} residual ${p.residual}`);
close(r.summary.grossEUR, 2017619.08);
assert.equal(r.summary.withinTolerance, 1);

// Each pair's EUR difference equals the sum of its exceptions.
for (const p of r.pairs) {
  const ex = r.exceptions.filter(e => e.creditor === p.creditor && e.debtor === p.debtor && e.category === p.category).reduce((s, e) => s + e.eur, 0);
  close(p.diffEUR, ex, 0.02);
}

// Pair matrix: a status for every trading relationship, none on the diagonal.
const m = pairMatrix(r, codes);
codes.forEach((c, i) => assert.equal(m[i][i], null));
const cell = (c, d) => m[codes.indexOf(c)][codes.indexOf(d)];
assert.equal(cell('DE02', 'US01').status, 'open');
assert.equal(cell('DE01', 'DE02').status, 'matched');
assert.equal(cell('IN01', 'DE01').status, 'matched');
assert.equal(cell('DE02', 'CN01'), null, 'no relationship, no cell');

// Matching passes: pass 3 links an item whose document reference differs.
const noRef = [
  {id: 'A', entity: 'DE02', partner: 'US01', side: 'R', category: 'trade', doc: 'INV-1', docDate: '2026-03-10', cur: 'USD', amt: 1000, lcur: 'EUR', lamt: 1000 / 1.08},
  {id: 'B', entity: 'US01', partner: 'DE02', side: 'P', category: 'trade', doc: 'AP-77', docDate: '2026-03-13', cur: 'USD', amt: 1000, lcur: 'USD', lamt: 1000},
];
const r3 = reconcile(noRef, {rates, closeDate});
assert.equal(r3.exceptions.length, 0); assert.equal(r3.summary.byPass[2], 1);
const late = reconcile([noRef[0], {...noRef[1], docDate: '2026-03-25'}], {rates, closeDate});
assert.equal(late.exceptions.length, 2, 'outside the 5-day window, both sides stay open');

// Tolerance is a setting.
assert.equal(reconcile(sampleLines, {rates, closeDate, tolerance: 0}).summary.withinTolerance, 0);
assert.equal(reconcile(sampleLines, {rates, closeDate, tolerance: 10000}).summary.withinTolerance, 3);

// Input validation and CSV safety.
assert.ok(validateLines([{...sampleLines[0], side: 'X'}], rates, codes).length);
assert.ok(validateLines([{...sampleLines[0], cur: 'JPY'}], rates, codes).length);
assert.ok(validateLines([{...sampleLines[0], partner: sampleLines[0].entity}], rates, codes).length);
assert.match(csv([{a: '=SUM(A1)', b: 2}]), /"'=SUM/);
close(toEUR(108, 'USD', rates), 100);
close(round2(1.005), 1.01);

// Upload: the sample data, downloaded in template layout, loads back in and reconciles identically.
const back = importLines(csv(toTemplateRows(sampleLines)));
assert.deepEqual(back.errors, []);
assert.equal(back.lines.length, sampleLines.length);
assert.deepEqual(back.entities.map(e => e.code), [...codes].sort());
assert.equal(back.entities.find(e => e.code === 'IN01').currency, 'INR');
assert.equal(back.maxDate, '2026-03-31');
const rb = reconcile(back.lines, {rates, closeDate, tolerance: 1000});
assert.deepEqual(rb.summary, r.summary);
assert.deepEqual(rb.exceptions.map(e => [e.id, e.kind, e.doc, e.eur]), r.exceptions.map(e => [e.id, e.kind, e.doc, e.eur]));

// Upload parsing: separators, byte-order mark, quotes, dates and number formats.
assert.deepEqual(parseCSV('﻿a;b\r\n"x;1";"say ""hi"""\n'), [['a', 'b'], ['x;1', 'say "hi"']]);
assert.equal(parseDate('2026-03-12'), '2026-03-12'); assert.equal(parseDate('12/03/2026'), '2026-03-12');
assert.equal(parseDate('12-Mar-2026'), '2026-03-12'); assert.equal(parseDate('31/02/2026'), null); assert.equal(parseDate('03-12'), null);
assert.equal(parseAmount('95,000.50'), 95000.5); assert.equal(parseAmount('(1,200)'), -1200); assert.equal(parseAmount('1200-'), -1200);
assert.equal(parseAmount('−7.5'), -7.5); assert.equal(parseAmount('12a'), null); assert.equal(parseAmount(''), null);
assert.equal(monthEnd('2026-02-14'), '2026-02-28');
const hdr = 'Entity,Partner,Side,Account type,Document,Document date,Currency,Amount,Local currency,Local amount\n';
const good = importLines(hdr + 'SG01,JP01,receivable,Trade,A1,2026-06-02,JPY,"1,000,000",SGD,8700\nJP01,SG01,P,trade,A1,02/06/2026,JPY,1000000,JPY,1000000\n');
assert.deepEqual(good.errors, []); assert.equal(good.lines[0].side, 'R'); assert.equal(good.lines[0].category, 'trade');
assert.deepEqual(good.currencies, ['JPY', 'SGD']); assert.equal(monthEnd(good.maxDate), '2026-06-30');
assert.match(importLines('entity,partner\nA,B\n').errors[0], /Missing columns: side, account_type/);
const bad = importLines(hdr + 'SG01,SG01,X,trade,A1,2026-13-01,JP,abc,SGD,1\nSG01,JP01,R,trade,A2,2026-06-01,USD,5,USD,6\nSG01,JP01,R,trade,A3,2026-06-01,USD,5,EUR,4\nSG01,JP01,R,trade,A4,2026-06-01,USD,5,SGD,7\n');
for (const m of [/entity and partner are both SG01/, /side "X"/, /date "2026-13-01"/, /currency "JP"/, /amount "abc"/, /should be equal/, /more than one local currency/]) assert.ok(bad.errors.some(e => m.test(e)), String(m));
assert.equal(bad.lines.length, 2, 'bad rows are left out');
assert.match(importLines(hdr + '<b>,JP01,R,trade,A1,2026-06-01,JPY,1,SGD,1\n').errors[0], /short code/);

console.log(JSON.stringify({result: 'passed', lines: r.summary.lines, matched: r.summary.matchedLines, exceptions: r.summary.exceptions, grossEUR: r.summary.grossEUR, byPass: r.summary.byPass}));
