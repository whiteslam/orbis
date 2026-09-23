# Workbook Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user upload an Excel/CSV workbook, preview its contents, and request grounded AI advice without retaining the file.

**Architecture:** Parse files in authenticated Node Server Actions with strict resource limits. Derive bounded previews and deterministic observations, then send only the structured summary after explicit user action to OpenRouter. Render the flow in a dedicated Health component.

**Tech Stack:** Next.js 16 App Router Server Actions, Supabase session claims, ExcelJS, OpenRouter chat completions, React client component.

**Spec:** `docs/superpowers/specs/2026-09-24-workbook-advisor-design.md`

## Global Constraints

- Require verified Supabase claims inside each server action.
- Workbook size ≤ 1.5 MiB; sheets ≤ 8; rows ≤ 2,000; columns ≤ 40 per sheet; non-empty cells ≤ 20,000.
- Do not persist workbook data, derived preview, prompts, or advice.
- OpenRouter key remains server-only; AI receives at most 24 KiB of structured summary and may emit at most 1,200 tokens.
- Workbook content is untrusted data; advice may cite only generated observation IDs.
- No tests are added or run because the user's project-level instruction forbids them; use an allowed production build for compile validation.

## Review Focus

- Forged Server Action payloads and unauthenticated callers: both actions revalidate claims and payload bounds.
- Corrupt, extension-spoofed, empty, and oversized files: return safe errors without retaining input.
- Spreadsheet formula/error cells and hostile prompt-like strings: expose bounded display values; model treats strings as data, not instructions.
- AI malformed JSON or fabricated evidence IDs: validate output and filter evidence links against generated IDs.
- Missing provider key or provider outage: preview still works and UI presents a recoverable configuration/error state.

---

### Task 1: Add bounded workbook parsing and derived observations

**Files:**
- Add `exceljs` dependency.
- Create `lib/workbook/parse.ts`.

**Interfaces:**
- `parseWorkbook(file: File): Promise<WorkbookPreview>`; `WorkbookPreview` includes filename, sheets, row count, column labels, up to 8 preview rows, and deterministic numeric observations with opaque IDs.

- [x] Enforce file extension/MIME, file size, worksheet, row, column, and cell limits before returning a preview.
- [x] Parse `.xlsx` using ExcelJS; parse `.csv` through ExcelJS CSV reader.
- [x] Normalize formula/error/date values to safe bounded display values; never return formulas or binary data.
- [x] Derive numeric count/sum/min/max/average observations and stable opaque IDs; ensure preview JSON ≤ 24 KiB.

### Task 2: Add authenticated parse and AI advice Server Actions

**Files:**
- Create `app/health/actions.ts`.
- Modify `next.config.ts` to bound Server Action request size.
- Modify `.env.example` and deployment docs.

**Interfaces:**
- `parseWorkbookAction(formData: FormData): Promise<ActionResult<WorkbookPreview>>`.
- `generateWorkbookAdviceAction(preview: WorkbookPreview): Promise<ActionResult<WorkbookAdvice>>`.

- [x] Revalidate authenticated user claims in both actions.
- [x] Validate serialized preview size, sheet/cell/observation counts and each field length before provider call; HMAC-sign preview for its owner.
- [x] Use server-side OpenRouter chat completion with JSON-only response request, low output limit, timeout, and no raw file bytes.
- [x] Validate response schema, require concise advice, and filter evidence IDs to generated observations.
- [x] Return sanitized errors; never log provider request bodies or keys.
- [x] Default model to the verified `openai/gpt-4o-mini`; permit server env override.

### Task 3: Build Health workbook upload and advice UI

**Files:**
- Create `components/health/workbook-advisor.tsx`.
- Modify `components/orbis-app.tsx` and `app/globals.css`.

**Interfaces:**
- Client state flow: idle → parsing → preview → advising → advice; recoverable error from each network action.

- [x] Add a clear file picker/drop area and format/size limits.
- [x] Show sheet/column/row preview before AI request; do not trigger AI during upload.
- [x] Require the user to press a clearly labeled advice button after disclosure that a summary is sent to OpenRouter.
- [x] Show advice, the exact allowed observation values used as evidence, caveats, and actionable provider/missing-key error states.
- [x] Replace fabricated Health metrics/plan with honest empty onboarding language.

### Task 4: Update project status and deployment guidance

**Files:**
- Modify `BUILD_ROADMAP.md` and `README.md`.

- [x] Mark the workbook upload/advice implementation complete and note missing OpenRouter configuration as an external setup step.
- [x] Document privacy, format/size limits, model configuration, local setup and Vercel environment variables.
- [ ] Record final `pnpm build` result and any remaining external configuration blocker in the project progress ledger.
