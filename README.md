# InterCo Recon — intercompany reconciliation demonstration

A finance automation portfolio prototype by Sorabh Gupta. All entities, transactions and rates are fictional.

## What it does

Orrowind Software is a fictional US-headquartered cloud software group with six entities in six currencies (USD, GBP, EUR, INR, SGD, BRL) and six local GAAPs (US GAAP, FRS 102, HGB, Ind AS, SFRS(I), BR GAAP), reporting to the group under US GAAP in USD. Its intercompany flows are subscription resale to foreign distributors, cost-plus engineering and sales support, stock compensation and cloud hosting recharges, a software royalty, funding loans and a dividend. Its Q1 2026 close holds 169 intercompany lines, each booked by both sides, with 11 seeded differences.

- Three-pass matching: exact (pair, account type, document, currency, amount), close (same document, amounts differ) and no-reference (same amount within 5 days).
- A translation check per pair and account type that catches balances not revalued at the closing rate.
- An entity-pair matrix in the group currency (USD by default; EUR, GBP, INR and others can be chosen, and rates are restated automatically), an exception list with ageing, a configurable tolerance and CSV exports.

- Resolution: a likely cause for every difference (timing, missing or wrong booking, price or calculation, FX revaluation, accounting policy), a proposed entry naming who books it, and the reconciliation rerun after the entries with a balance-sheet elimination by pair. A workpaper downloads as CSV.
- Your own data: download the CSV template, load a file of open intercompany items, enter closing rates and reconcile. Every row is checked before anything loads. Numeric dates can be day-first or month-first, with two-digit years, and payables can be positive balances or negative credits as ERPs export them; when a file does not settle either, the tool asks.

Everything runs in the browser. A loaded file is read locally and is never sent to a server or stored. The site is served with a Content-Security-Policy whose `connect-src 'none'` stops the page from sending data anywhere, even if the code were changed.

Foreign-currency lines are also checked one by one against the closing rate, and the tool warns when an entity's local amounts look already converted to the group currency.

## Run locally

```sh
python3 -m http.server 8000 --directory dist
```

## Verification

```sh
node verify.mjs
```

The tests check that the tool finds every one of the 11 seeded exceptions with the right type, pair, document and USD amount, raises no false exceptions, and that every pair's EUR difference equals the sum of its exceptions. They check that each of the 11 differences gets the right cause, owner and entry amount, that the mis-posted invoice counts once (gross USD 2,057,793), and that the reconciliation clears completely once the proposed entries are applied. They also check that the sample data, downloaded in the template layout or exported the ERP way (US dates, negative payables), loads back in and reconciles to the same result, that restating the rates in EUR gives the same exceptions, and that badly formed rows are rejected with a clear message.
