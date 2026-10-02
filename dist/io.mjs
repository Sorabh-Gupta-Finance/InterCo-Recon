// Reading and writing intercompany lines as CSV, in the template layout.
// Pure functions: the upload screen, the downloads and the tests share them.

export const COLUMNS = [
  {key: 'entity', header: 'entity', required: true, example: 'DE02', help: 'Company that booked the line'},
  {key: 'partner', header: 'partner', required: true, example: 'US01', help: 'The other group company (trading partner)'},
  {key: 'side', header: 'side', required: true, example: 'R', help: 'R = receivable or income, P = payable or expense'},
  {key: 'category', header: 'account_type', required: true, example: 'trade', help: 'Same word on both sides, e.g. trade, service, loan, interest, royalty'},
  {key: 'doc', header: 'document', required: true, example: 'INV-1043', help: 'Invoice or reference number'},
  {key: 'docDate', header: 'document_date', required: true, example: '2026-03-12', help: 'YYYY-MM-DD, DD/MM/YYYY or 12-Mar-2026'},
  {key: 'cur', header: 'currency', required: true, example: 'USD', help: 'Transaction currency, ISO code'},
  {key: 'amt', header: 'amount', required: true, example: '95000.00', help: 'Amount in transaction currency; dot for decimals'},
  {key: 'lcur', header: 'local_currency', required: true, example: 'EUR', help: "The booking entity's own currency"},
  {key: 'lamt', header: 'local_amount', required: true, example: '87962.96', help: 'Amount as booked in local currency, revalued at period end'},
  {key: 'desc', header: 'description', required: false, example: 'Goods shipped, March', help: 'Optional'},
];

const ALIASES = {
  entity: ['entity', 'company', 'companycode', 'bookedby', 'entitycode'],
  partner: ['partner', 'tradingpartner', 'counterparty', 'icpartner', 'partnerentity'],
  side: ['side', 'rp', 'receivablepayable'],
  category: ['accounttype', 'category', 'account', 'type'],
  doc: ['document', 'documentnumber', 'doc', 'reference', 'invoice', 'invoicenumber'],
  docDate: ['documentdate', 'date', 'docdate', 'invoicedate', 'postingdate'],
  cur: ['currency', 'transactioncurrency', 'documentcurrency'],
  amt: ['amount', 'transactionamount', 'documentamount'],
  lcur: ['localcurrency', 'lcur', 'companycurrency'],
  lamt: ['localamount', 'amountlocal', 'lamt', 'amountinlocalcurrency'],
  desc: ['description', 'text', 'desc', 'narration'],
};
export const MAX_LINES = 50000;
const norm = h => String(h).toLowerCase().replace(/[^a-z]/g, '');

// RFC 4180 CSV, comma or semicolon separated, with or without a byte-order mark.
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.slice(0, text.search(/\r?\n|$/));
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
export function parseDate(v) {
  const s = String(v).trim();
  let y, m, d, x;
  if ((x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [+x[1], +x[2], +x[3]];
  else if ((x = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})$/)) && MONTHS[x[2].toLowerCase()]) [d, m, y] = [+x[1], MONTHS[x[2].toLowerCase()], +x[3]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseAmount(v) {
  let s = String(v).trim().replace(/[\s,']/g, '').replace(/−/g, '-');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-?\d+(\.\d+)?-$/.test(s)) { neg = !neg; s = s.slice(0, -1); } // SAP-style trailing minus
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

const SIDES = {r: 'R', receivable: 'R', ar: 'R', income: 'R', p: 'P', payable: 'P', ap: 'P', expense: 'P'};
// CSV downloads guard text against spreadsheet formulas with a leading apostrophe; undo it on the way back in.
const unguard = s => String(s ?? '').trim().replace(/^'(?=[=+@\-])/, '');

/** Read a template CSV into reconciliation lines. Returns {lines, errors, errorCount, entities, currencies, maxDate}. */
export function importLines(text) {
  const rows = parseCSV(text).filter(r => r.some(c => String(c).trim() !== ''));
  const out = {lines: [], errors: [], errorCount: 0, entities: [], currencies: [], maxDate: ''};
  const err = m => { out.errorCount++; if (out.errors.length < 100) out.errors.push(m); };
  if (rows.length < 2) { err('The file has no data rows. Keep the header row and add one row per intercompany line.'); return out; }
  const header = rows[0].map(norm), col = {};
  for (const {key} of COLUMNS) { const i = header.findIndex(h => ALIASES[key].includes(h)); if (i >= 0) col[key] = i; }
  const missing = COLUMNS.filter(c => c.required && col[c.key] === undefined).map(c => c.header);
  if (missing.length) { err(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the template to see the layout.`); return out; }
  if (rows.length - 1 > MAX_LINES) { err(`The file has ${rows.length - 1} rows; the limit is ${MAX_LINES.toLocaleString('en-GB')}.`); return out; }

  const lcurOf = new Map();
  rows.slice(1).forEach((r, i) => {
    const at = `Row ${i + 2}`, get = k => unguard(r[col[k]]);
    const l = {id: `L${String(i + 1).padStart(5, '0')}`, entity: get('entity').toUpperCase(), partner: get('partner').toUpperCase(),
      side: SIDES[get('side').toLowerCase()], category: get('category').toLowerCase(), doc: get('doc'), docDate: parseDate(get('docDate')),
      cur: get('cur').toUpperCase(), amt: parseAmount(get('amt')), lcur: get('lcur').toUpperCase(), lamt: parseAmount(get('lamt')),
      desc: col.desc === undefined ? '' : get('desc')};
    const before = out.errorCount;
    for (const [k, label] of [['entity', 'entity'], ['partner', 'partner'], ['category', 'account_type'], ['doc', 'document']]) if (!l[k]) err(`${at}: ${label} is empty.`);
    for (const k of ['entity', 'partner']) if (l[k] && !/^[A-Z0-9][A-Z0-9_.-]{0,19}$/.test(l[k])) err(`${at}: ${k} "${l[k]}" should be a short code of letters and digits, such as DE02.`);
    if (l.entity && l.entity === l.partner) err(`${at}: entity and partner are both ${l.entity}.`);
    if (!l.side) err(`${at}: side "${get('side')}" should be R (receivable) or P (payable).`);
    if (!l.docDate) err(`${at}: date "${get('docDate')}" is not in a recognised format (use YYYY-MM-DD).`);
    for (const [k, label] of [['cur', 'currency'], ['lcur', 'local_currency']]) if (!/^[A-Z]{3}$/.test(l[k])) err(`${at}: ${label} "${l[k]}" should be a three-letter code such as EUR.`);
    if (l.amt === null) err(`${at}: amount "${get('amt')}" is not a number.`);
    if (l.lamt === null) err(`${at}: local_amount "${get('lamt')}" is not a number.`);
    if (l.cur && l.cur === l.lcur && l.amt !== null && l.lamt !== null && Math.abs(l.amt - l.lamt) >= 0.005) err(`${at}: currency and local currency are both ${l.cur}, so amount and local_amount should be equal.`);
    if (out.errorCount > before) return;
    if (!lcurOf.has(l.entity)) lcurOf.set(l.entity, new Set());
    lcurOf.get(l.entity).add(l.lcur);
    if (l.docDate > out.maxDate) out.maxDate = l.docDate;
    out.lines.push(l);
  });
  for (const [e, set] of lcurOf) if (set.size > 1) err(`${e} books in more than one local currency (${[...set].join(', ')}). Each entity should have one.`);

  const codes = new Set(out.lines.flatMap(l => [l.entity, l.partner]));
  out.entities = [...codes].sort().map(code => ({code, currency: lcurOf.has(code) ? [...lcurOf.get(code)][0] : ''}));
  out.currencies = [...new Set(out.lines.flatMap(l => [l.cur, l.lcur]))].sort();
  return out;
}

/** Lines in template layout, for downloads that can be loaded straight back in. */
export function toTemplateRows(lines) {
  return lines.map(l => Object.fromEntries(COLUMNS.map(c => [c.header, l[c.key] ?? ''])));
}

/** Last day of the month of an ISO date. */
export function monthEnd(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
