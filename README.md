# Vendor Outstanding

A web app that replaces the Google Sheets workflow for vendor payments. The app imports the JS1 outstanding export, shows unpaid bills in FIFO order (oldest due date first), and makes the bank CSV file.

## Status

This pull request has the base of the project and the two parts that must not be wrong:

| Part | Where | Status |
|---|---|---|
| Locked bank CSV generator | `src/lib/bank-csv` | Done, with golden tests |
| Apps Script port (filter, dates, FIFO order) | `src/lib/outstanding` | Done, with tests |
| Database, import, payment screens, sign in, batches, audit log | - | Next pull requests |

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

```bash
npm install
npm run check   # type check, lint, tests
npm run dev
```

Node 20 or newer is needed. CI runs the same checks on each pull request.

## Environment variables

Not used yet. The next pull requests will add:

| Name | Use |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `APP_PASSWORD_HASH` | Hash of the one sign-in password |
| `SESSION_SECRET` | Key for the session cookie |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account key (read-only use of the sheets) |
| `OUTSTANDING_SHEET_ID` | Vendor Outstanding spreadsheet |
| `BENE_SHEET_ID` | Bene Master spreadsheet |

The app never writes to the Google Sheets.
