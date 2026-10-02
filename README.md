# InterCo Recon — intercompany reconciliation demonstration

A finance automation portfolio prototype by Sorabh Gupta. All entities, transactions and rates are fictional.

## What it does

Halmrode Industrial Group is a fictional German-headquartered manufacturer with six entities in five currencies (EUR, USD, INR, CNY, BRL) and five local GAAPs (HGB, US GAAP, Ind AS, China ASBE, BR GAAP), reporting to the group under IFRS in EUR. Its Q1 2026 close holds 143 intercompany lines, each booked by both sides, with 11 seeded differences.

- Three-pass matching: exact (pair, account type, document, currency, amount), close (same document, amounts differ) and no-reference (same amount within 5 days).
- A translation check per pair and account type that catches balances not revalued at the closing rate.
- An entity-pair matrix in EUR, an exception list with ageing, a configurable tolerance and CSV exports.

Everything runs in the browser. There is no server, database or data upload.

## Run locally

```sh
python3 -m http.server 8000 --directory dist
```

## Verification

```sh
node verify.mjs
```

The tests check that the tool finds every one of the 11 seeded exceptions with the right type, pair, document and EUR amount, raises no false exceptions, and that every pair's EUR difference equals the sum of its exceptions.
