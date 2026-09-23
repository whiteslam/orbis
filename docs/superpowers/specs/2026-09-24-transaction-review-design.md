# Gmail Transaction Review Design

## Goal

Convert saved Gmail transaction-alert candidates into user-reviewed finance transactions. Parsing stays deterministic and local to Orbis; raw message text is fetched only on request and discarded after parsing.

## Flow

1. The signed-in user requests parsing for a bounded batch of up to five pending alert candidates.
2. Orbis fetches full message MIME parts under the existing read-only scope, uses plain-text parts only, and does not fetch attachments or retain bodies.
3. Conservative rules extract amount, currency, direction, merchant, and received timestamp. Unsupported/ambiguous candidates stay pending with a reason; no values are silently counted as expenses.
4. Finance shows each parse proposal and lets the user edit the fields, confirm, or ignore it.
5. Confirmation inserts an owner-scoped transaction idempotently using the Gmail message ID, then marks the candidate processed. Ignoring marks only the candidate ignored.

## Privacy and safety

- Require and revalidate the current Orbis user in all actions; never accept an owner ID from the browser.
- Derive the Gmail connection using that user ID; parse only candidate message IDs stored against that connection.
- Cap one parse action to five messages, and cap decoded plain-text input to 100 KiB per message.
- Ignore HTML-only parts, attachments, unknown MIME formats, and malformed base64 bodies.
- Never store/log email body content; persist only extracted transaction fields and a short parse reason.
- Keep parser confidence conservative: every result requires user review.
- Confirm validates edited values and enforces `(user_id, source_message_id)` uniqueness; repeated confirmation does not duplicate a transaction.

## Acceptance

- Parse action reads at most five owner-scoped pending candidates and returns only fields/reasons.
- Clear supported bank-alert formats produce review proposals; ambiguous formats remain unparsed.
- User can edit/confirm or ignore a proposal; only confirmation affects transaction totals.
- Duplicate clicks and replayed actions cannot create duplicate transactions.
- The email body and Gmail token never reach browser props, Supabase rows, model providers, or logs.
