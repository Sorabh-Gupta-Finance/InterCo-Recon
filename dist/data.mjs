// Halmrode Industrial Group — fictional intercompany dataset, Q1 2026 close.
// Every intercompany document is booked by both sides unless it is one of the
// 11 seeded exceptions described in the case study. All names and figures are fictional.

export const closeDate = '2026-03-31';
export const groupCurrency = 'EUR';

// Illustrative rates, units of currency per EUR 1 (not market data).
export const rates = {
  EUR: {close: 1, avg: 1},
  USD: {close: 1.08, avg: 1.075},
  INR: {close: 90.5, avg: 89.8},
  CNY: {close: 7.8, avg: 7.76},
  BRL: {close: 6.1, avg: 6.05},
};

export const entities = [
  {code: 'DE01', name: 'Halmrode Holding GmbH', country: 'Germany', currency: 'EUR', gaap: 'HGB', role: 'Parent: treasury, cash pool leader, IP owner'},
  {code: 'DE02', name: 'Halmrode Maschinenbau GmbH', country: 'Germany', currency: 'EUR', gaap: 'HGB', role: 'Main plant'},
  {code: 'US01', name: 'Halmrode Inc.', country: 'United States', currency: 'USD', gaap: 'US GAAP', role: 'Sales and service, Americas'},
  {code: 'IN01', name: 'Halmrode India Pvt Ltd', country: 'India', currency: 'INR', gaap: 'Ind AS', role: 'Global business services centre'},
  {code: 'CN01', name: 'Halmrode (Shanghai) Co., Ltd', country: 'China', currency: 'CNY', gaap: 'China ASBE', role: 'Component supplier'},
  {code: 'BR01', name: 'Halmrode do Brasil Ltda', country: 'Brazil', currency: 'BRL', gaap: 'BR GAAP (CPC)', role: 'Sales, Latin America'},
];

export const categories = {
  trade: 'Goods and recharges',
  service: 'Shared services fee',
  mgmtfee: 'Management fee',
  royalty: 'IP royalty',
  loan: 'Loan principal',
  interest: 'Loan interest',
  cashpool: 'Cash pool',
  dividend: 'Dividend',
  lease: 'Lease',
};

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const currencyOf = code => entities.find(e => e.code === code).currency;
// Local amount at the closing rate: every open item in this dataset is revalued
// correctly at quarter end, except seeded exception 5.
const local = (amt, cur, lcur) => r2(amt / rates[cur].close * rates[lcur].close);

const lines = [];
let seq = 0;
function line(entity, partner, side, category, doc, docDate, cur, amt, desc, opts = {}) {
  const lcur = currencyOf(entity);
  lines.push({
    id: `L${String(++seq).padStart(3, '0')}`,
    entity, partner, side, category, doc, docDate,
    postDate: opts.postDate || docDate,
    cur, amt,
    lcur, lamt: opts.lamt ?? local(amt, cur, lcur),
    desc,
  });
}
// Both sides book the same document: creditor as a receivable (R), debtor as a payable (P).
function both(creditor, debtor, category, doc, date, cur, amt, desc, opts = {}) {
  line(creditor, debtor, 'R', category, doc, date, cur, amt, desc);
  line(debtor, creditor, 'P', category, doc, opts.debtorDate || date, cur, amt, desc, {postDate: opts.debtorPost});
}
const mmdd = d => d.slice(5, 7) + d.slice(8, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekly = (start, n) => Array.from({length: n}, (_, i) => addDays(start, 7 * i));

// a. Goods: DE02 -> US01, invoiced weekly in USD; invoices up to mid-February are paid.
const usAmounts = [86500, 92000, 78250, 104000, 88750, 95000, 99400, 83600, 91200, 87300, 102500, 94800];
weekly('2026-01-05', 12).forEach((d, i) => {
  const doc = `INV-DE02-US-${mmdd(d)}`;
  both('DE02', 'US01', 'trade', doc, d, 'USD', usAmounts[i], 'Machines and spares');
  if (d <= '2026-02-14') both('DE02', 'US01', 'trade', `PAY-${doc}`, addDays(d, 30), 'USD', -usAmounts[i], 'Settlement through netting');
});

// b. Goods: DE02 -> BR01, invoiced weekly in EUR.
const brAmounts = [142000, 118500, 131200, 126400, 139800, 121300, 133700, 128900, 117600, 136200, 250000, 124500];
weekly('2026-01-07', 12).forEach((d, i) => {
  const doc = `INV-DE02-BR-${mmdd(d)}`;
  if (d === '2026-03-18') return; // seeded exception 5, booked below
  both('DE02', 'BR01', 'trade', doc, d, 'EUR', brAmounts[i], 'Machines and spares');
  if (d <= '2026-02-14') both('DE02', 'BR01', 'trade', `PAY-${doc}`, addDays(d, 35), 'EUR', -brAmounts[i], 'Settlement through netting');
});

// c. Components: CN01 -> DE02 (EUR) and CN01 -> IN01 (USD), monthly.
[['2026-01-15', 64000], ['2026-02-15', 71500], ['2026-03-15', 68200]].forEach(([d, a]) => {
  const doc = `INV-CN01-DE-${mmdd(d)}`;
  both('CN01', 'DE02', 'trade', doc, d, 'EUR', a, 'Components');
  if (d < '2026-03-01') both('CN01', 'DE02', 'trade', `PAY-${doc}`, addDays(d, 30), 'EUR', -a, 'Settlement through netting');
});
[['2026-01-20', 38400], ['2026-02-20', 41200], ['2026-03-20', 36900]].forEach(([d, a]) => {
  const doc = `INV-CN01-IN-${mmdd(d)}`;
  both('CN01', 'IN01', 'trade', doc, d, 'USD', a, 'Components');
  if (d < '2026-02-01') both('CN01', 'IN01', 'trade', `PAY-${doc}`, addDays(d, 30), 'USD', -a, 'Settlement through netting');
});

// d. Shared services fee: IN01 -> all five, invoiced at quarter end, cost plus 8%.
both('IN01', 'DE01', 'service', 'INV-IN01-SS-Q1-DE01', closeDate, 'EUR', 210000, 'GBS services Q1, cost plus 8%');
both('IN01', 'DE02', 'service', 'INV-IN01-SS-Q1-DE02', closeDate, 'EUR', 185000, 'GBS services Q1, cost plus 8%');
both('IN01', 'CN01', 'service', 'INV-IN01-SS-Q1-CN01', closeDate, 'EUR', 62000, 'GBS services Q1, cost plus 8%');
both('IN01', 'BR01', 'service', 'INV-IN01-SS-Q1-BR01', closeDate, 'EUR', 74000, 'GBS services Q1, cost plus 8%');

// e. Management fee: DE01 -> four of five, accrued at quarter end.
both('DE01', 'DE02', 'mgmtfee', 'ACR-DE01-MF-Q1-DE02', closeDate, 'EUR', 150000, 'Management fee Q1');
both('DE01', 'US01', 'mgmtfee', 'ACR-DE01-MF-Q1-US01', closeDate, 'EUR', 135000, 'Management fee Q1');
both('DE01', 'CN01', 'mgmtfee', 'ACR-DE01-MF-Q1-CN01', closeDate, 'EUR', 48000, 'Management fee Q1');
both('DE01', 'BR01', 'mgmtfee', 'ACR-DE01-MF-Q1-BR01', closeDate, 'EUR', 52000, 'Management fee Q1');

// f. Royalties: DE01 -> BR01 and IN01.
both('DE01', 'BR01', 'royalty', 'ROY-DE01-BR-Q1', '2026-03-10', 'EUR', 60000, 'IP royalty Q1, 3% of sales');
both('DE01', 'BR01', 'royalty', 'PAY-ROY-DE01-BR-Q1', '2026-03-25', 'EUR', -51000, 'Royalty paid, net of withholding tax');
both('DE01', 'IN01', 'royalty', 'ROY-DE01-IN-Q1', closeDate, 'EUR', 40000, 'IP royalty Q1, 3% of sales');

// g. Loans and interest.
both('DE01', 'US01', 'loan', 'LOAN-DE01-US01', '2025-07-01', 'USD', 5000000, 'Term loan, 5% fixed');
both('DE01', 'IN01', 'loan', 'LOAN-DE01-IN01', '2025-10-01', 'EUR', 2000000, 'Term loan, 4% fixed');
both('DE01', 'IN01', 'interest', 'INT-DE01-IN01-Q1', closeDate, 'EUR', 20000, 'Loan interest Q1, Actual/360');

// h. Cash pool: DE02's surplus swept to DE01, so DE01 owes DE02.
both('DE02', 'DE01', 'cashpool', 'CP-DE01-DE02-0331', closeDate, 'EUR', 1350000, 'Zero-balancing cash pool, month-end balance');

// j. Cost recharges: US01 -> IN01 and BR01.
both('US01', 'IN01', 'trade', 'RCH-US01-IN-0214', '2026-02-14', 'USD', 12400, 'Travel recharged');
both('US01', 'IN01', 'trade', 'RCH-US01-IN-0318', '2026-03-18', 'USD', 9850, 'Travel recharged');
both('US01', 'BR01', 'trade', 'RCH-US01-BR-0122', '2026-01-22', 'USD', 7300, 'Service engineers recharged');
both('US01', 'BR01', 'trade', 'PAY-RCH-US01-BR-0122', '2026-02-21', 'USD', -7300, 'Settlement through netting');
both('US01', 'BR01', 'trade', 'RCH-US01-BR-0305', '2026-03-05', 'USD', 11050, 'Service engineers recharged');

// ---- The 11 seeded exceptions ----
// 1. Goods in transit: DE02 invoiced on 30 Mar; US01 books on receipt in April.
line('DE02', 'US01', 'R', 'trade', 'INV-DE02-US-0330', '2026-03-30', 'USD', 420000, 'Machines, shipped 30 Mar');
// 2. Cash in transit: US01 paid on 31 Mar; DE02's bank received it on 1 Apr.
line('US01', 'DE02', 'P', 'trade', 'PAY-US01-0331', closeDate, 'USD', -300000, 'Payment on account through netting');
// 3. Missing accrual: IN01 has not accrued the Q1 management fee.
line('DE01', 'IN01', 'R', 'mgmtfee', 'ACR-DE01-MF-Q1-IN01', closeDate, 'EUR', 120000, 'Management fee Q1');
// 4. Withholding tax: BR01 withheld 15% on the royalty; DE01 still shows it receivable.
line('BR01', 'DE01', 'P', 'royalty', 'WHT-BR01-ROY-Q1', '2026-03-25', 'EUR', -9000, 'Withholding tax 15% on royalty');
// 5. FX: BR01 kept a EUR invoice at its historical rate (5.90) instead of the closing rate (6.10).
line('DE02', 'BR01', 'R', 'trade', 'INV-DE02-BR-0318', '2026-03-18', 'EUR', 250000, 'Machines and spares');
line('BR01', 'DE02', 'P', 'trade', 'INV-DE02-BR-0318', '2026-03-18', 'EUR', 250000, 'Machines and spares', {lamt: 1475000});
// 6. Pricing: IN01 billed cost plus 8%; US01 accrued cost plus 5% under the old agreement.
line('IN01', 'US01', 'R', 'service', 'INV-IN01-SS-Q1-US01', closeDate, 'USD', 540000, 'GBS services Q1, cost plus 8%');
line('US01', 'IN01', 'P', 'service', 'INV-IN01-SS-Q1-US01', closeDate, 'USD', 525000, 'GBS services Q1, accrued at cost plus 5%');
// 7. Day count: DE01 accrues interest on Actual/360, US01 on Actual/365 (within tolerance).
line('DE01', 'US01', 'R', 'interest', 'INT-DE01-US01-Q1', closeDate, 'USD', 62500, 'Loan interest Q1, Actual/360');
line('US01', 'DE01', 'P', 'interest', 'INT-DE01-US01-Q1', closeDate, 'USD', 61643.84, 'Loan interest Q1, Actual/365');
// 8. Wrong trading partner: IN01 booked a CN01 invoice against DE02's partner code.
line('CN01', 'IN01', 'R', 'trade', 'INV-CN01-IN-0315', '2026-03-15', 'USD', 80000, 'Components');
line('IN01', 'DE02', 'P', 'trade', 'INV-CN01-IN-0315', '2026-03-15', 'USD', 80000, 'Components');
// 9. Duplicate: US01 booked DE02's 9 Feb invoice a second time.
line('US01', 'DE02', 'P', 'trade', 'INV-DE02-US-0209', '2026-02-09', 'USD', 95000, 'Machines and spares', {postDate: '2026-02-11'});
// 10. Dividend: US01 declared and booked it; DE01 has not booked the receivable.
line('US01', 'DE01', 'P', 'dividend', 'DIV-US01-2026-01', '2026-03-25', 'USD', 500000, 'Interim dividend declared 25 Mar');
// 11. GAAP difference: IN01 books a lease liability (Ind AS 116 / IFRS 16); DE01, as operating lessor, books no receivable.
line('IN01', 'DE01', 'P', 'lease', 'LSE-DE01-IN01', closeDate, 'EUR', 500000, 'Lease liability, test equipment');

export const sampleLines = lines;
