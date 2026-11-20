# Vendor Outstanding

A web app that replaces the Google Sheets workflow for vendor payments. The app imports the JS1 outstanding export, shows unpaid bills in FIFO order (oldest due date first), and makes the bank CSV file.

## What the app does

1. **Import.** Read the OUTSTANDINGS tab of the Vendor Outstanding sheet, or upload the JS1 export (`.xlsx` or `.csv`). The app does the same steps as your Apps Script: it removes blank rows and "Total for" rows, keeps columns A, C, D, E, F, I, J, K, L, M, formats dates, and orders the bills by due date (FIFO).
2. **Payments.** One row for each open bill. Tick **Paid**. The amount starts as the bill balance (the same amount as the sheet uses). You can change it. Set the paid date.
3. **Review.** Shows the bank lines, with **problems** (block), **checks** (warning) and **suggestions**:
   - Problem: the party is not in Bene Master, the IFSC or account number is not valid, the same name has two different bank accounts, the amount is zero, the date is not valid, or the bill is already paid.
   - Check: the amount is not the balance (part payment or more than the balance), or the paid date is not today. A check never blocks.
   - Suggestion: an older bill of the same party is not selected (FIFO), other bills of the party are also due, or several bills go in one bank line (RTGS).
4. **Done.** Makes the batch and downloads the CSV. The bills are locked. A database rule makes it impossible to pay a bill two times.
5. **Batches.** Download any batch again (the exact saved bytes). Void a batch if the bank rejects it: the bills can be paid again.
6. **Bene Master.** The saved copy of ALL DETAILS, with a refresh button and a list of rows with problems. Names, IFSC codes and account numbers are cleaned (spaces, line breaks, lower case).
7. **Audit log.** Imports, refreshes, batches, voids and sign-ins.

The app never writes to the Google Sheets. It uses the read-only scope.

## The bank CSV is locked

`src/lib/bank-csv/template.ts` is the only place that defines the file layout. It copies the BANK FORMAT sheet:

- Line 1 is `H,P`. Payment lines start with `P`. The last line is `T,<line count>,<total>`.
- Each line has 63 fields (sheet columns A to BK).
- Dates are `dd/mm/yyyy`. Line ending is `\n`. No BOM.
- A field that has a comma, a double quote or a new line is in double quotes.
- The file name is `BANK_FORMAT_yyyy-mm-dd.csv` (India date).

Bills with the same paid date and the same bank account name become one payment line. The amount is the sum, and the reference is `BN ` plus the Ref Nos joined with `, `.

Two tests protect the layout:

- `tests/bank-csv.template.test.ts` fails when anyone changes the template (SHA-256 fingerprint).
- `tests/bank-csv.golden.test.ts` compares the output byte for byte with `tests/fixtures/bank-format-2026-11-19.csv`.

### Golden files

The fixture is built from the cell values of the BANK FORMAT sheet that the Google Sheets API returned. The API does not give the exact bytes that the Apps Script export writes. To remove all doubt, export one real file with the CSV menu and save it as a new fixture. If the real file has extra lines or a different width, the golden test will show the difference.

## Setup

Node 22 or newer is needed.

```bash
npm install
cp .env.example .env.local     # fill in the values
npm run db:migrate             # creates the tables
npm run dev
npm run check                  # type check, lint, tests
```

### Environment variables

| Name | Use |
|---|---|
| `DATABASE_URL` | Postgres connection string. On Vercel use a Neon database from the Marketplace (pooled URL). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Key of the service account, as JSON on one line. Share both sheets with its email (viewer access is enough). |
| `OUTSTANDING_SHEET_ID` | Vendor Outstanding spreadsheet ID. |
| `BENE_SHEET_ID` | Bene Master spreadsheet ID. |
| `OUTSTANDING_TAB`, `BENE_TAB` | Optional tab names. Defaults: `OUTSTANDINGS ` (with a space at the end) and `ALL DETAILS`. |
| `APP_PASSWORD_HASH` | Optional. Sign in is **off** when this is empty. Make the value with `npm run hash-password -- '<password>'`. |
| `SESSION_SECRET` | At least 32 random characters. Needed when sign in is on. |

**Warning:** while sign in is off, anyone who has the link can see the bills and make bank files. A banner shows this on each page. Set `APP_PASSWORD_HASH` before you share the link.

### Deploy to Vercel

1. Make a Neon Postgres database and set the environment variables in the Vercel project.
2. Deploy. The production build runs the database migrations by itself (`vercel-build` script, only when `VERCEL_ENV` is `production`). If a migration fails, the build fails and the old version stays live.
3. To run the migrations by hand: `npm run db:migrate` with `DATABASE_URL` set.

## Tests

`npm test` runs 60+ tests. The database tests use a real Postgres engine in memory (PGlite) with the real migrations. They check the lock on paid bills, the transaction rollback, the void, the import rules and the audit log.
