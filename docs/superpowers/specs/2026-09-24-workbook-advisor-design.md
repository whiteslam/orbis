# Workbook Advisor Design

## Goal and constraints

Orbis should let a signed-in user upload an Excel workbook, inspect what was read, and request useful advice grounded in that data. The file is processed in memory and never persisted. Before requesting advice, the user sees a disclosure that a bounded workbook summary will be sent to OpenRouter. The product should clearly report missing configuration, invalid formats, workbook limits, and provider errors.

## User flow

1. From the Health area, choose `.xlsx` or `.csv` and parse it on the server.
2. Show workbook sheet names, detected columns, small row previews, and computed numeric observations. Do not contact an AI provider during parsing.
3. The user explicitly asks for advice. Send only the bounded structured preview and deterministic observations to OpenRouter from server code; never send the original file, save its contents, or put an API key in the browser.
4. Show a concise summary and advice items linked to IDs from the computed observations. Discard workbook data on navigation or refresh.

## Safety and bounds

- Require the existing authenticated Supabase session for both server actions.
- Accept `.xlsx` and `.csv`, with a 1.5 MiB file limit, at most 8 worksheets, at most 2,000 non-empty rows, 40 columns per sheet, and 20,000 non-empty cells overall.
- Keep the Server Action body limit below the Vercel request ceiling while allowing multipart overhead.
- Return no raw file or formula values. Treat workbook cell strings as untrusted data and never as instructions.
- Bound AI input to 24 KiB and AI output to 1,200 tokens. Parse and validate model JSON; only accept evidence IDs created by deterministic analysis.
- Do not persist workbook, preview, provider prompt, or advice in Supabase in this phase.
- Advice is informational. It must not make medical diagnoses or guarantee financial outcomes; identify missing or ambiguous data.

## Technical approach

- Use ExcelJS on the Node.js server to parse XLSX/CSV in memory.
- Separate authenticated actions: `parseWorkbookAction(formData)` returns bounded preview and numeric facts; `generateWorkbookAdviceAction(payload)` validates the structured payload and calls OpenRouter.
- Use OpenRouter's chat completions endpoint with server-only `OPENROUTER_API_KEY` and configurable `OPENROUTER_MODEL`, defaulting to `openai/gpt-4o-mini`.
- Keep UI in a focused client component mounted in the existing Health area. Show upload, preview, error, loading, and advice states.

## Acceptance

- A supported workbook parses and yields a useful preview without calling an AI provider.
- Advice is requested only after explicit user action and cites valid computed observation IDs.
- Empty, corrupt, unsupported, oversized, or over-limit workbooks return safe user-readable errors.
- Missing OpenRouter configuration allows upload/preview and explains that advice is not configured yet.
- No upload data or secret values are written to disk, the database, logs, or client bundles.
