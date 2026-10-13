// Tidewell Software — fictional intercompany dataset, Q1 2026 close.
// A US-headquartered cloud software group reporting under US GAAP in USD.
// Every intercompany document is booked by both sides unless it is one of the
// 11 seeded exceptions listed at the end. All names and figures are fictional.

export const closeDate = '2026-03-31';
export const groupCurrency = 'USD';
export const groupName = 'Tidewell Software';

// Illustrative rates, units of currency per USD 1 (not market data).
export const rates = {
  USD: {close: 1, avg: 1},
  EUR: {close: 0.925, avg: 0.93},
  GBP: {close: 0.79, avg: 0.792},
  INR: {close: 85.5, avg: 85.1},
  SGD: {close: 1.34, avg: 1.345},
  BRL: {close: 5.65, avg: 5.6},
};

export const entities = [
  {code: 'US01', name: 'Tidewell Software, Inc.', country: 'United States', currency: 'USD', gaap: 'US GAAP', role: 'Parent: IP owner, treasury, buys cloud hosting'},
  {code: 'UK01', name: 'Tidewell Software Ltd', country: 'United Kingdom', currency: 'GBP', gaap: 'FRS 102', role: 'EMEA distributor: resells subscriptions'},
  {code: 'DE01', name: 'Tidewell Software GmbH', country: 'Germany', currency: 'EUR', gaap: 'HGB', role: 'Sales support, cost plus 8%'},
  {code: 'IN01', name: 'Tidewell Technologies India Pvt Ltd', country: 'India', currency: 'INR', gaap: 'Ind AS', role: 'Engineering centre, cost plus 15%'},
  {code: 'SG01', name: 'Tidewell Software Pte Ltd', country: 'Singapore', currency: 'SGD', gaap: 'SFRS(I)', role: 'APAC distributor: resells subscriptions'},
  {code: 'BR01', name: 'Tidewell Software do Brasil Ltda', country: 'Brazil', currency: 'BRL', gaap: 'BR GAAP (CPC)', role: 'LatAm distributor: pays a software royalty'},
];

export const categories = {
  license: 'Subscription resale',
  service: 'Cost-plus services',
  sbc: 'Stock compensation recharge',
  hosting: 'Cloud hosting recharge',
  royalty: 'Software royalty',
  recharge: 'Expense recharge',
  loan: 'Loan principal',
  interest: 'Loan interest',
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
    cur, amt,
    lcur, lamt: opts.lamt ?? local(amt, cur, lcur),
    desc,
  });
}
// Both sides book the same document: creditor as a receivable (R), debtor as a payable (P).
function both(creditor, debtor, category, doc, date, cur, amt, desc) {
  line(creditor, debtor, 'R', category, doc, date, cur, amt, desc);
  line(debtor, creditor, 'P', category, doc, date, cur, amt, desc);
}
const mmdd = d => d.slice(5, 7) + d.slice(8, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekly = (start, n) => Array.from({length: n}, (_, i) => addDays(start, 7 * i));
const months = ['2026-01-31', '2026-02-28', '2026-03-31'];

// a. Subscription resale: US01 -> UK01, invoiced weekly in USD; invoices up to mid-February are paid.
const ukAmounts = [86500, 92000, 78250, 104000, 88750, 95000, 99400, 83600, 91200, 87300, 102500, 94800];
weekly('2026-01-05', 12).forEach((d, i) => {
  const doc = `INV-US01-UK-${mmdd(d)}`;
  both('US01', 'UK01', 'license', doc, d, 'USD', ukAmounts[i], 'EMEA subscriptions resold');
  if (d <= '2026-02-14') both('US01', 'UK01', 'license', `PAY-${doc}`, addDays(d, 30), 'USD', -ukAmounts[i], 'Settlement');
});

// b. Subscription resale: US01 -> SG01, invoiced weekly in USD.
const sgAmounts = [142000, 118500, 131200, 126400, 139800, 121300, 133700, 128900, 117600, 136200, 128000, 124500];
weekly('2026-01-07', 12).forEach((d, i) => {
  const doc = `INV-US01-SG-${mmdd(d)}`;
  both('US01', 'SG01', 'license', doc, d, 'USD', sgAmounts[i], 'APAC subscriptions resold');
  if (d <= '2026-02-14') both('US01', 'SG01', 'license', `PAY-${doc}`, addDays(d, 35), 'USD', -sgAmounts[i], 'Settlement');
});

// c. Subscription resale: US01 -> BR01, monthly in USD; January is paid.
[['2026-01-16', 210000], ['2026-02-16', 224000]].forEach(([d, a]) => {
  const doc = `INV-US01-BR-${mmdd(d)}`;
  both('US01', 'BR01', 'license', doc, d, 'USD', a, 'LatAm subscriptions resold');
  if (d < '2026-02-01') both('US01', 'BR01', 'license', `PAY-${doc}`, addDays(d, 30), 'USD', -a, 'Settlement');
});

// d. Cloud hosting recharged by usage: US01 -> UK01, DE01, SG01, BR01, monthly in USD; January is paid.
const hosting = {UK01: [48200, 51300, 49800], DE01: [21400, 22900, 23600], SG01: [36100, 38800, 40250], BR01: [17300, 18100, 19400]};
for (const [ent, amts] of Object.entries(hosting)) months.forEach((d, i) => {
  const doc = `HST-US01-${ent.slice(0, 2)}-${mmdd(d)}`;
  both('US01', ent, 'hosting', doc, d, 'USD', amts[i], 'Cloud hosting, usage-based recharge');
  if (i === 0) both('US01', ent, 'hosting', `PAY-${doc}`, addDays(d, 25), 'USD', -amts[i], 'Settlement');
});

// e. Cost-plus services. IN01 engineering to US01 monthly; the Q1 true-up is seeded exception 6.
[['2026-01-31', 172400], ['2026-02-28', 178900]].forEach(([d, a], i) => {
  const doc = `INV-IN01-RD-${mmdd(d)}`;
  both('IN01', 'US01', 'service', doc, d, 'USD', a, 'Engineering services, cost plus 15%');
  if (i === 0) both('IN01', 'US01', 'service', `PAY-${doc}`, addDays(d, 20), 'USD', -a, 'Settlement');
});
// DE01 sales support to US01, monthly in EUR.
[['2026-01-31', 64800], ['2026-02-28', 66100], ['2026-03-31', 67350]].forEach(([d, a], i) => {
  const doc = `INV-DE01-SS-${mmdd(d)}`;
  both('DE01', 'US01', 'service', doc, d, 'EUR', a, 'Sales support, cost plus 8%');
  if (i === 0) both('DE01', 'US01', 'service', `PAY-${doc}`, addDays(d, 20), 'EUR', -a, 'Settlement');
});
// IN01 APAC customer support to SG01; March is seeded exception 8.
[['2026-01-31', 74600], ['2026-02-28', 77100]].forEach(([d, a]) => both('IN01', 'SG01', 'service', `INV-IN01-SG-${mmdd(d)}`, d, 'USD', a, 'Customer support, cost plus 15%'));

// f. Stock compensation recharged to the employing entities, Q1 (DE01 is seeded exception 3).
both('US01', 'IN01', 'sbc', 'SBC-US01-IN-Q1', closeDate, 'USD', 310000, 'Q1 stock compensation recharge');
both('US01', 'UK01', 'sbc', 'SBC-US01-UK-Q1', closeDate, 'USD', 185000, 'Q1 stock compensation recharge');
both('US01', 'SG01', 'sbc', 'SBC-US01-SG-Q1', closeDate, 'USD', 92000, 'Q1 stock compensation recharge');

// g. Software royalty: BR01 pays US01 quarterly, net of 15% withholding tax (seeded exception 4).
both('US01', 'BR01', 'royalty', 'ROY-US01-BR-Q1', '2026-03-10', 'USD', 60000, 'Software royalty Q1, 8% of revenue');
both('US01', 'BR01', 'royalty', 'PAY-ROY-US01-BR-Q1', '2026-03-25', 'USD', -51000, 'Royalty paid, net of withholding tax');

// h. Funding loans and interest.
both('US01', 'IN01', 'loan', 'LOAN-US01-IN01', '2025-07-01', 'USD', 5000000, 'Term loan, 5% fixed');
both('US01', 'BR01', 'loan', 'LOAN-US01-BR01', '2025-10-01', 'USD', 2000000, 'Term loan, 6% fixed');
both('US01', 'BR01', 'interest', 'INT-US01-BR01-Q1', closeDate, 'USD', 30000, 'Loan interest Q1, Actual/360');

// i. Expense recharges between subsidiaries and the parent.
both('UK01', 'US01', 'recharge', 'RCH-UK01-US-0214', '2026-02-14', 'GBP', 18400, 'Customer event costs recharged');
both('UK01', 'US01', 'recharge', 'RCH-UK01-US-0320', '2026-03-20', 'GBP', 12650, 'Recruiting fees recharged');
both('DE01', 'UK01', 'recharge', 'RCH-DE01-UK-0305', '2026-03-05', 'EUR', 9800, 'Trade fair stand shared');
both('US01', 'IN01', 'recharge', 'RCH-US01-IN-0122', '2026-01-22', 'USD', 7300, 'Software tools recharged');
both('US01', 'IN01', 'recharge', 'PAY-RCH-US01-IN-0122', '2026-02-21', 'USD', -7300, 'Settlement');

// ---- The 11 seeded exceptions ----
// 1. Invoice in transit: US01 invoiced on 30 Mar; UK01 books supplier invoices on approval in April.
line('US01', 'UK01', 'R', 'license', 'INV-US01-UK-0330', '2026-03-30', 'USD', 420000, 'EMEA subscriptions resold, annual prepaid deals');
// 2. Cash in transit: SG01 paid on 31 Mar; US01's bank received it on 1 Apr.
line('SG01', 'US01', 'P', 'license', 'PAY-SG01-0331', closeDate, 'USD', -300000, 'Payment on account');
// 3. Missing accrual: DE01 has not accrued its Q1 stock compensation recharge.
line('US01', 'DE01', 'R', 'sbc', 'SBC-US01-DE-Q1', closeDate, 'USD', 130000, 'Q1 stock compensation recharge');
// 4. Withholding tax: BR01 withheld 15% on the royalty; US01 still shows it receivable.
line('BR01', 'US01', 'P', 'royalty', 'WHT-BR01-ROY-Q1', '2026-03-25', 'USD', -9000, 'Withholding tax 15% on royalty');
// 5. FX: BR01 kept a USD invoice at its historical rate (5.45) instead of the closing rate (5.65).
line('US01', 'BR01', 'R', 'license', 'INV-US01-BR-0316', '2026-03-16', 'USD', 250000, 'LatAm subscriptions resold');
line('BR01', 'US01', 'P', 'license', 'INV-US01-BR-0316', '2026-03-16', 'USD', 250000, 'LatAm subscriptions resold', {lamt: 1362500});
// 6. Transfer pricing: IN01 billed the Q1 true-up at cost plus 15%; US01 accrued it at last year's 12%.
line('IN01', 'US01', 'R', 'service', 'INV-IN01-RD-Q1-TU', closeDate, 'USD', 540000, 'Engineering services Q1 true-up, cost plus 15%');
line('US01', 'IN01', 'P', 'service', 'INV-IN01-RD-Q1-TU', closeDate, 'USD', 525913.04, 'Engineering services Q1 true-up, accrued at cost plus 12%');
// 7. Day count: US01 accrues interest on Actual/360, IN01 on Actual/365 (within tolerance).
line('US01', 'IN01', 'R', 'interest', 'INT-US01-IN01-Q1', closeDate, 'USD', 62500, 'Loan interest Q1, Actual/360');
line('IN01', 'US01', 'P', 'interest', 'INT-US01-IN01-Q1', closeDate, 'USD', 61643.84, 'Loan interest Q1, Actual/365');
// 8. Wrong trading partner: SG01 booked IN01's March support invoice against US01.
line('IN01', 'SG01', 'R', 'service', 'INV-IN01-SG-0331', closeDate, 'USD', 80000, 'Customer support, cost plus 15%');
line('SG01', 'US01', 'P', 'service', 'INV-IN01-SG-0331', closeDate, 'USD', 80000, 'Customer support, cost plus 15%');
// 9. Duplicate: UK01 booked US01's 9 Feb invoice a second time.
line('UK01', 'US01', 'P', 'license', 'INV-US01-UK-0209', '2026-02-09', 'USD', 95000, 'EMEA subscriptions resold');
// 10. Dividend: SG01 declared and booked it; US01 has not booked the receivable.
line('SG01', 'US01', 'P', 'dividend', 'DIV-SG01-2026-01', '2026-03-25', 'USD', 500000, 'Interim dividend declared 25 Mar');
// 11. Lease: IN01 (lessee, Ind AS 116) books a lease liability for servers; US01 accounts for it as an operating lease and books no receivable.
line('IN01', 'US01', 'P', 'lease', 'LSE-US01-IN01', closeDate, 'USD', 500000, 'Lease liability, server racks');

export const sampleLines = lines;
