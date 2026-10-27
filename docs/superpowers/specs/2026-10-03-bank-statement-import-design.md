# Bank statement import and spending analysis

Status: draft for review. No code written.

## Goal

Upload a bank statement PDF in the Money tab. Orbis detects which bank it came from, reads the transactions, checks the numbers add up, and adds them to Spending so the month total, categories, brief, heads-ups and Ask Orbis reflect real spending. Then it analyses the spending.

## Decisions already made

- **PDF only.** No XLSX or CSV.
- **The file is never stored.** It is read, then deleted. Only transactions are kept.
- **Hybrid reading (approach C):** a deterministic table reader extracts every number; a bank detector labels the bank and supplies quirks; AI is used only to categorise narrations.
- **Statements import into `transactions`**, as a third `source`, so everything that already reads spending picks them up with no change.

## Assumptions to confirm

- Banks and password protection are not yet known. The design handles password-protected PDFs and unknown banks; the first version is tuned on whichever real statements are available.
- Money moved to an investment category is still kept out of "spent" (existing rule).

## Flow

1. **Upload.** Same two-step pattern as the workbook: a signed upload URL, the browser uploads straight to the `workbook-uploads` bucket (avoids Vercel's 4.5 MB body limit), then a server action reads it.
2. **Password.** If the PDF is encrypted, the action returns `needs_password`; the UI asks, and the same action is called again with it. The password is used in memory for that one call and never stored or logged.
3. **Read.** `pdfjs` extracts text items with their x/y positions (the existing parser already groups lines by y).
4. **Detect the bank** from the header text.
5. **Find the columns** by position: Date, Narration, Debit, Credit (or a single Amount with Dr/Cr), Balance. Continuation lines (wrapped narrations) are joined to the row above.
6. **Verify.** Opening balance + credits − debits must equal closing balance, within ₹0.01. If it fails, nothing is imported and the user is told why.
7. **Preview.** Shows bank, last four digits, date range, row count, totals, how many are already present. The user taps Import.
8. **Import.** Rows are inserted, the staged file is deleted in `finally`.

## Bank detection

A small registry in `lib/statements/banks.ts`: for each bank, header phrases and IFSC prefix, display name, date format, and amount convention. Detection only labels and tunes; it does not gate the import. An unrecognised bank whose columns are readable and whose totals verify still imports, labelled "Bank statement".

Initial registry: HDFC, SBI, ICICI, Axis, Kotak, plus whichever banks the user names.

## Categorising

1. **Rules first**: a merchant keyword table (Swiggy, Zomato, Uber, Amazon, rent, EMI, Zerodha, and similar) maps obvious narrations to the existing categories, including the investment categories (SIP, Zerodha, PPF, NPS go to investments).
2. **AI for the rest**: unmatched narrations are batched and sent through `routeJson` with `sensitivity: 'personal'`. Only the cleaned narration text and a row id are sent: no name, account number, balance or date. Replies are validated: the category must be one of the allowed lists, and unknown ids are dropped.
3. **Unknown stays "Other".** A failed AI call never blocks the import.
4. Narration cleaning strips UPI reference numbers and card digits before anything leaves the server.

## Data model

Migration `202610030036_statement_import.sql`:

- `transactions.source` check widened to `('gmail','manual','statement')`.
- `source_message_id` is used for statement rows as a row fingerprint (hash of account label + date + amount + direction + cleaned narration + occurrence index within the day), with a unique index on `(user_id, source_message_id) where source = 'statement'`. Importing the same statement twice adds nothing.
- New table `statement_imports` (per-user, RLS): bank, last four digits, period start and end, row count, totals, imported at. No file, no file name, no balances beyond the verified totals. Used for the "already imported" notice and the history list.

## Duplicates against manual entries

A statement row is considered the same as a manual entry when the amount matches exactly, the date is within one day, and the manual row has the same direction. On match, the manual row's category and note are kept and its source becomes `statement`; no second row is created. Ambiguous matches (two manual rows fit) are not merged; both are kept and the preview says so.

## Analysis

- **Orbis's own numbers (no AI):** category totals, recurring payments (same merchant at a regular interval, similar amount), largest transactions, change versus the previous month, daily pattern. Computed deterministically in `lib/statements/analysis.ts`.
- **AI reading:** one structured summary per import, through `routeJson` as personal data, from the computed figures only (never raw rows). Saved in `ai_results` and rewritten only when the figures change, with its own daily limit, like the portfolio news brief.
- Shown in the Spending tab as a "Statement insights" section.

## Privacy

- File deleted after read, in `finally`, including on failure.
- Password never stored.
- No account number beyond the last four digits.
- Balances used only for the verification check, then discarded.
- Personal data goes only to providers whose registry row says they do not train on it.
- `statement_imports` and statement-sourced transactions are added to account export and deletion.

## Out of scope for this version

XLSX/CSV, scanned image-only PDFs (refused with a clear message, as the workbook does), joint accounts and multiple accounts per file, credit card statements (different layout; a follow-up), currency other than INR, automatic fetching from email.

## Testing

- Unit tests with synthetic statements built from text items: column detection, wrapped narrations, Dr/Cr and split-column amounts, each bank's date format, totals verification pass and fail, fingerprint stability.
- Unit tests for categorisation rules and for rejecting an AI category outside the allowed list.
- Unit tests for duplicate matching including the ambiguous case.
- A manual check against one real statement, with name and account number removed, before it is called done.

## Risks

- **Layouts I have not seen.** Mitigated by the totals check (refuse rather than import wrong numbers) and by the preview.
- **Password handling.** The PDF library must be given the password per call; confirm it does not log it.
- **Categorisation quality.** Rules cover common merchants; the rest depends on the model, and "Other" is the safe default.
