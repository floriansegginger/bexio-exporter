# bexio-export

Download everything from a [bexio](https://www.bexio.com) account through the official API
and keep it in plain, portable formats: JSON for every record, CSV spreadsheets for the
important tables, PDFs for every sales document, and the original files for every receipt.
On top of the raw data it produces the accounting reports a fiduciary needs to take over the
books: bilan, compte de résultat, balance de vérification, feuilles de compte, journal and
soldes d'ouverture per business year, plus open receivables and import-ready files.

No dependencies. Needs Node.js 22 or newer.

## 1. Create a Personal Access Token

1. Sign in at <https://developer.bexio.com/pat> with your bexio login.
2. Create a Personal Access Token (PAT). It has full read access to your company and is
   valid for 60 days.
3. Copy the token. It is only shown once.

## 2. Run the export

```sh
cd bexio-crawler
BEXIO_TOKEN=<your token> npm start
```

Or put the token into a `.env` file next to `package.json` (see `.env.example`) and just run
`npm start`. Pass options after `--`, for example `npm start -- --out ~/bexio-backup`.

The tool first checks the token and prints the user and company it is exporting, then works
through the sections below. Progress goes to stderr. When it finishes it prints a summary and
writes `manifest.json` with request counts and every error that occurred.

**Re-running is safe.** With the same `--out` directory the tool resumes: anything already on
disk is not fetched again, so a crash, an expired token or a Ctrl+C only costs you the
remaining part. Errors are recorded, not fatal. If the summary lists errors, run the same
command again and only the missing pieces are retried.

### Options

| Option | Effect |
| --- | --- |
| `-o, --out <dir>` | Output directory. Default `./bexio-export-YYYY-MM-DD` |
| `--only a,b` / `--skip a,b` | Restrict to, or leave out, sections (see `--list-sections`) |
| `--no-pdf` | Do not generate PDFs (invoices, quotes, orders, reminders, paystubs). PDFs are one API call each and the slowest part |
| `--fast` | Skip per-record extras: comments, additional addresses, manual entry attachments, file usage lookups, paystubs |
| `--overwrite` | Fetch everything again even if it exists on disk |
| `--concurrency <n>` | Parallel requests (default 3). bexio has a per-minute limit per company and the tool backs off automatically |
| `--page-size <n>` | Page size for list endpoints, up to 2000 (default 500) |
| `-v, --verbose` | Log every request |

## What you get

```
bexio-export-2026-09-07/
├── manifest.json                       run summary, statistics, errors
├── company/                            company_profile.json, logo, users, permissions,
│                                       document templates and settings, payment types
├── reference/                          countries, languages, currency codes
├── contacts/
│   ├── contacts.json / contacts.csv    active and archived (column `_archived`)
│   ├── additional_addresses.json/.csv, contact_groups, contact_sectors, contact_relations,
│   └── salutations, titles, notes.json / notes.csv
├── files/                              the whole file inbox, archived files included
│   ├── index.json / index.csv          metadata, local path and where each file is used
│   └── <id>_<name>.<ext>
├── sales/
│   ├── invoices.json / invoices.csv    one row per invoice (same for quotes, orders, deliveries)
│   ├── invoices/RE-00001/              invoice.json (with positions), invoice.pdf,
│   │                                   payments.json, reminders.json, reminder_<n>.pdf, comments.json
│   ├── quotes/AN-00001/quote.json, quote.pdf, comments.json
│   ├── orders/AB-00001/order.json, order.pdf, repetition.json (recurring orders)
│   ├── deliveries/LS-00001/delivery.json
│   └── invoice_payments.json/.csv, invoice_reminders.json/.csv   (all invoices combined)
├── purchase/
│   ├── bills.json / bills.csv, expenses.json / expenses.csv, purchase_orders.json / .csv
│   ├── bills/ER-00001/bill.json, outgoing_payments.json, attachments/<receipt files>
│   ├── expenses/<no>/expense.json, attachments/<receipt files>
│   ├── purchase_orders/<nr>/purchase_order.json
│   └── outgoing_payments.json/.csv
├── accounting/
│   ├── accounts.json / accounts.csv    chart of accounts, account_groups
│   ├── journal.json / journal.csv      every booking
│   ├── manual_entries.json, manual_entry_lines.csv, manual_entries/<id>/attachments/
│   ├── taxes.json/.csv, vat_periods, calendar_years, business_years,
│   └── currencies.json, exchange_rates.json
├── banking/                            bank_accounts.json/.csv, payments.json/.csv
├── items/                              items.json/.csv, stock_locations, stock_areas, units
├── projects/                           projects.json/.csv, per-project milestones and work packages,
│                                       timesheets.json/.csv, business_activities, ...
├── tasks/                              tasks.json/.csv, priorities, statuses
├── payroll/                            employees, absences per year, paystubs/<year>-<month>.pdf
│                                       (only when the payroll module is licensed)
└── reports/                            accounting reports per business year, see below
```

CSV files are UTF-8 with a byte-order mark and open directly in Excel, Numbers or Google
Sheets. Nested objects become dotted columns (`address.city`), arrays are stored as JSON text so
nothing is lost. The JSON files are the raw API responses and contain everything.

Receipts attached to bills, expenses and manual entries are copied next to the document they
belong to and also live once in `files/`. `files/index.json` lists for each file which document
uses it (`_usage`).

## Accounting reports (takeover dossier for an accounting firm)

The `reports` section turns the exported journal into the documents a fiduciary needs to
take over the books. It runs at the end of every export and can be re-run on its own,
without a token, on an existing export:

```sh
npm start -- --only reports --out bexio-export-2026-09-07
```

Everything lands in `reports/`, in French, as CSV (for import) and HTML (for reading and
printing to PDF via the browser):

```
reports/
├── index.html                      vue d'ensemble: exercices, résultats, débiteurs ouverts
├── synthese_exercices.csv          chiffres clés par exercice
├── plan_comptable.csv              plan comptable avec types (actif/passif/produit/charge) et groupes
├── journal_complet.csv             toutes les écritures: date, pièce, libellé, comptes, CHF, devise, code TVA
├── debiteurs_ouverts.csv           factures clients non soldées
├── import/journal_banana.csv       journal avec les colonnes de Banana Comptabilité
├── import/plan_comptable_banana.csv
└── exercice_2017-2018/             un dossier par exercice comptable
    ├── rapport.html                bilan, compte de résultat, balance, feuilles de compte, journal, TVA
    ├── bilan.csv
    ├── compte_de_resultat.csv
    ├── balance_de_verification.csv ouverture, mouvements, soldes par compte
    ├── soldes_ouverture.csv        soldes à reprendre au premier jour de l'exercice
    ├── journal.csv
    ├── grand_livre.csv             toutes les feuilles de compte
    ├── feuilles_de_compte/         une feuille par compte
    └── tva.csv                     éléments TVA (indicatif)
```

How the figures are computed, so that an accountant can check them:

* bexio books each business year as a self-contained window. The year starts with
  "Report de soldes" entries against the opening account (9100 / 9901) and, when the year is
  closed, the result is transferred to equity via 9200. Reports are computed per window from
  those journal entries, so they match what bexio shows. The very first year, which bexio
  imports through 9901 together with its revenue and expense balances, is handled the same
  way: its income statement comes from those imported balances.
* Where bexio never booked a carry-forward (typically the most recent, still open years) the
  opening balances are computed from the previous closing. Any result not yet transferred is
  carried into 2979 (bénéfice / perte reporté). Such years are flagged "ouverture calculée"
  in the reports and in `soldes_ouverture.csv`.
* The balance sheet always balances by construction: passifs = liabilities and equity +
  result of the year + balances of the closing accounts (9xxx). A non-zero "écart" would
  indicate a problem in the source data and is flagged.
* Journal rows are enriched with the invoice number (from the sales export), the manual
  entry reference and VAT code (from the manual entries export) and the original currency
  and rate for foreign-currency bookings. Amounts are in CHF (`base_currency_amount`).
* VAT: bexio does not expose a VAT code on invoice-generated journal entries, so `tva.csv`
  is indicative only: VAT account balances, manual entries by code, and invoice VAT totals
  by rate. Use the filed VAT returns as the reference.

Together with the raw export (invoice PDFs, receipts in `files/`, contacts, bank accounts)
this is what a fiduciary needs: chart of accounts, complete journal, opening balances at any
year start, trial balance and financial statements per year, ledgers per account, open
receivables, and the supporting documents.

## How it works

* Every request goes to `https://api.bexio.com` with `Authorization: Bearer <PAT>`.
* The three pagination styles of the API (limit/offset for 2.0 and 3.0, limit/page for 4.0
  purchase, page/per-page for 4.0 banking) are handled; lists are fetched completely.
* The `RateLimit-*` headers are honoured and 429 / 5xx / network errors are retried with
  backoff, so you can leave it running unattended.
* Writes are atomic: a file that exists is complete, which is what makes resuming safe.
* The token is never written to the export.

## Not covered by the bexio API

These are limits of the API, not of this tool:

* Credit notes have no endpoint (bexio FAQ), so they are not exported.
* Bank transactions and statements are not exposed; bank accounts and outgoing payments are.
* Reports (balance sheet, P&L, VAT report) are not exposed, but the full journal and chart
  of accounts are, which is what they are computed from.
* Deliveries and purchase orders have no PDF endpoint.
* Payroll data needs the payroll module; without it the section is skipped.

## Development

```sh
npm test
```

The tests run the exporter against a small in-process mock of the bexio API
(`test/mock-server.js`) covering all pagination styles, retries, attachments and resuming,
and check the report engine on a synthetic ledger (`test/ledger.test.js`): carry-forwards,
computed openings, an imported first year, and the balance-sheet identity.
