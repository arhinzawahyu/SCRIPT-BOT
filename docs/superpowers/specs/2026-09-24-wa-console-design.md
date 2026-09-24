# WA Console — Design Specification

**Status:** Approved architecture; implementation pending
**Date:** 2026-09-24
**Target:** Vercel project `wa-bot-dashboard` (`https://wa-bot-dashboard.vercel.app`)

## 1. Goal

Replace the legacy `web/` dashboard with a private, single-admin WhatsApp archive console. Preserve the existing archive while moving media to private Vercel Blob, making ingestion authenticated and idempotent, and removing runtime schema mutation.

Success means the owner can log in with password plus WhatsApp OTP, find an archive item, inspect and download its media, edit its caption, delete it permanently, and see new bot events without refreshing the page.

## 2. Scope

### In scope

- Two-step login: username/password, then a six-digit OTP delivered by the existing Baileys bot.
- One admin account. No signup, registration, invitations, or public signup endpoint.
- Protected archive routes: ViewOnce, Status, Pesan Dihapus, Pengaturan.
- Server-side search and filters.
- Preview and authenticated download for image, video, audio, and text records.
- Caption editing and permanent deletion with confirmation.
- Three-second live polling; 300 ms search debounce; peach new-item pulse.
- Migration of existing Neon metadata and Neon S3 media to private Vercel Blob.
- Direct bot-to-private-Blob upload using `BLOB_READ_WRITE_TOKEN`.
- Versioned Neon migrations, signed webhook metadata, idempotent writes, and observable failures.
- Responsive dark operational UI with required accessibility and motion states.

### Out of scope

- Public user accounts, signup, sharing, multi-tenant roles, or external links.
- AI features, LLM calls, marketing sections, invented analytics, testimonials, or FAQ.
- Automatic changes to the existing ViewOnce capture behavior.
- Deleting legacy S3 data or legacy files before migration and browser verification pass.

## 3. Constraints and fixed decisions

1. Keep two deployables: the persistent Baileys bot in the repository root and the separate Next.js app rooted at `web/`.
2. Neon is authoritative for metadata. Private Vercel Blob is authoritative for new media.
3. The bot uploads media directly to Blob. The web app does not accept new media bodies; this avoids Vercel's 4.5 MB request-body limit.
4. Existing S3 access remains available only as a migration/read fallback until verification completes. No new S3 writes occur after bot cutover.
5. Preserve existing route names, `x-webhook-secret`, `viewonce|status|delete`, `image|video|audio|text`, and `dataBase64` aliases during rollout. New bot traffic uses signed metadata and `blobPathname`.
6. Existing owner quote-reply trigger remains unchanged. ViewOnce behavior is not changed by this project.
7. Client polling replaces the old eight-second long-poll behavior with a three-second interval.
8. Runtime DDL is removed. Schema changes ship as ordered SQL migrations.
9. The current Neon HTTP driver remains for the first implementation. A connection-pool rewrite is deferred until measured latency or connection pressure justifies it.
10. Existing `web/` files and S3 implementation stay intact until migration, tests, and browser verification pass.

## 4. Capability map

| Capability | Main surface | Server boundary | Completion check |
|---|---|---|---|
| Password stage | `/login` | `POST /api/login` | Wrong credentials fail; valid password creates only a pre-session and OTP record. |
| OTP stage | `/login` | `POST /api/login/verify` | Correct code creates a revocable full session; code is single-use. |
| Bot OTP relay | WhatsApp bot | `GET/POST /api/login/code` | Bot-only endpoint continuously polls and can report delivery. |
| Archive list | `/viewonce`, `/status`, `/delete` | `GET /api/items` | Filters and search run in Neon; responses are DTOs without storage secrets. |
| Live updates | Archive pages | `GET /api/events` or bounded archive refresh | New IDs appear within approximately three seconds. |
| Media preview | Archive card/dialog | `GET /api/items/[id]/file` | Auth is checked next to `get()`; Blob URLs never reach the client. |
| Download | Archive card | Same authenticated file route | Stream uses the validated MIME type and `Content-Disposition`. |
| Caption edit | Edit dialog | `PATCH /api/items/[id]` | Only caption changes; response is a safe DTO. |
| Permanent delete | Delete dialog | `DELETE /api/items/[id]` | Row and associated Blob are removed only after authorization. |
| Settings | `/settings` | Authenticated mutations | Admin password/session controls; no dead controls. |
| Migration | Offline command | Migration script | Counts, checksums/statuses, and failures are reported; source remains intact. |

## 5. System architecture

```text
WhatsApp owner
      |
      v
Persistent Baileys bot
      |  1. direct private Blob upload
      |  2. signed JSON webhook metadata
      v
Private Vercel Blob <---- authenticated file route ----> Browser
      ^
      | pathname only
      v
Next.js App Router (Vercel, region sin1)
      |
      v
Neon Postgres: admins, sessions, login_codes, media_items, webhook_receipts
```

The browser never receives `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, database URLs, webhook secrets, S3 credentials, or Blob URLs. Browser media requests use the same-origin authenticated file route.

### Trust boundaries

- Bot-to-webhook: public internet; verify HMAC, timestamp window, event ID, and payload schema.
- Browser-to-app: untrusted input; validate every query/body and authorize in the route handler.
- App-to-Blob: private store; use Vercel OIDC on Vercel, static token only for the external bot and offline migration.
- App-to-Neon: parameterized tagged queries only; secrets stay server-side.
- Migration-to-storage: read source, upload to private Blob, verify object, update metadata transactionally.

## 6. Authentication and sessions

### Login flow

1. `POST /api/login` validates username format and password against the single `admins` row.
2. On success, create or reuse one unexpired `login_codes` row for the admin. Store only a SHA-256 verification hash and an AES-256-GCM sealed code for the bot relay. TTL: one hour.
3. Set `wa_pre` as `HttpOnly`, `Secure`, `SameSite=Strict`; it grants access only to the OTP step.
4. The bot polls `/api/login/code` while connected. It sends the code to the configured owner and reports the exact code ID as sent.
5. `POST /api/login/verify` checks the pre-session, code hash, expiry, unused state, and attempt count. Consume the code atomically on success.
6. Create a database-backed session and set `wa_sess`; expire after 12 hours by default. Logout revokes the session row and clears the cookie. The pre-session cookie contains only the opaque `pre_session_id`; it is bound to the pending login-code row and is not a second authorization token.

### Session storage

`web/lib/auth.ts` stops being the sole security boundary. Add a `sessions` table:

- `id`: random 256-bit token ID, stored only as a SHA-256 hash.
- `admin_id`: foreign key to `admins`.
- `created_at`, `last_seen_at`, `expires_at`, `revoked_at`.
- Optional `user_agent_hash` and IP prefix for settings/audit display; never store raw secrets.

The cookie contains an opaque signed session identifier. Every protected page and API handler calls one DAL authorization function. Middleware may redirect for UX, but it is not the authorization check.

Use constant-time comparisons. Apply a distributed rate limiter at the trust boundary; the current process-local map is not sufficient for multiple Vercel instances. If no managed rate-limit store is available in the existing environment, use a Neon-backed fixed-window table with atomic SQL and document the single-admin traffic ceiling. Never weaken password or OTP checks to accommodate the limiter.

Login responses use generic errors. No password, OTP hash, token, or storage identifier is returned. The short-lived `wa_pre` cookie is the `pre_session_id`; another browser cannot submit a code created elsewhere.

## 7. Data model and migrations

Create ordered migrations under `web/db/migrations/`, with a small runner that records applied versions in `schema_migrations`.

### `media_items` additions

Preserve existing IDs and fields. Add:

- `event_id TEXT UNIQUE NOT NULL` for new idempotent events; generate a deterministic legacy value during migration.
- `blob_pathname TEXT` for private Vercel Blob objects.
- `size_bytes BIGINT NOT NULL DEFAULT 0` with a non-negative check.
- `occurred_at TIMESTAMPTZ` from the source event.
- `received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- `source TEXT NOT NULL DEFAULT 'legacy'` with allowed values `legacy`, `bot`.
- `deleted_at TIMESTAMPTZ` only if an audit/soft-delete requirement is later approved; permanent delete otherwise removes the row.

Keep `s3_key` during migration. Add indexes for `(kind, id DESC)`, `(kind, created_at DESC)`, and search-supporting sender/caption columns as appropriate for the chosen query plan. Do not add an index for every possible filter before measuring.

### `webhook_receipts`

- `event_id TEXT PRIMARY KEY`.
- `received_at TIMESTAMPTZ NOT NULL`.
- `payload_hash TEXT NOT NULL`.
- `result TEXT NOT NULL` (`accepted`, `duplicate`, `rejected`).

The receipt is inserted in the same transaction as the archive row. A replay with the same event ID and hash returns the original ID; a replay with a different hash returns conflict and is logged.

### Migration rules

- Run as an explicit offline/admin operation, not from a request handler.
- Read rows in bounded batches; never load the entire archive into memory.
- For each media row with `s3_key` and no `blob_pathname`, stream the S3 object to a unique private Blob pathname.
- Verify Blob existence/size before setting `blob_pathname`.
- Use `event_id = 'legacy-' || id` and preserve the original `created_at`, captions, sender metadata, and type.
- Emit counts for total, text, migrated, skipped, failed, and bytes migrated.
- On a failed object, leave `s3_key` intact and leave `blob_pathname` null. A rerun resumes safely.
- Keep source S3 objects and credentials until a separate cleanup is explicitly approved.

## 8. Bot ingestion contract

### New canonical payload

```json
{
  "event_id": "uuid-or-stable-id",
  "kind": "viewonce",
  "media_type": "image",
  "sender": "628...",
  "sender_name": "Name",
  "caption": "text",
  "mime": "image/jpeg",
  "blob_pathname": "wa/<unique-path>",
  "size_bytes": 12345,
  "occurred_at": "2026-09-24T12:00:00.000Z"
}
```

For text records, `blob_pathname` is null and `media_type` is `text`.

### Authentication and replay defense

The bot sends:

- `x-webhook-secret`: retained compatibility header.
- `x-wa-timestamp`: Unix seconds.
- `x-wa-signature`: lowercase hex HMAC-SHA256 of `timestamp + "." + rawBody` using `BOT_WEBHOOK_SECRET`.
- `x-wa-event-id`: same value as body `event_id`.

The route reads the raw request bytes, rejects timestamps outside a five-minute window, compares signatures in constant time, validates the event ID, then parses with a Zod schema. The secret header alone is insufficient for new traffic but remains accepted only for explicitly marked legacy payloads during the compatibility window.

### Bot behavior

- Generate an event ID before upload.
- Upload the media directly to the private Blob store with `access: "private"`, a unique pathname, the source MIME type, and an 8 MiB maximum per item, matching the current archive contract.
- Send metadata only to `/api/ingest`; no base64 media on the new path.
- Retry transient network/5xx failures with bounded exponential backoff and jitter.
- Do not retry validation, authentication, or permanent 4xx failures.
- Log event ID, kind, attempt, status, and duration without logging tokens, captions, phone numbers, or media bytes.
- Keep a local dead-letter/retry record only if the existing bot persistence can do so safely; otherwise surface a clear error and leave the source event untouched.

### Compatibility path

During rollout, `/api/ingest` accepts legacy `dataBase64` only when the request is authenticated with the old secret, validates size/signature, uploads to the private Blob, and records a generated event ID. This path is time-limited and logged. It is removed after all running bots send the canonical path and migration verification passes.

## 9. API surface

All browser APIs require a valid, unrevoked full session except the two login endpoints, the bot relay, and health check. Every handler performs authorization near the data source.

### Archive list

`GET /api/items?kind=viewonce|status|delete&q=&media_type=&from=&to=&limit=&cursor=`

- Maximum query length: 100 characters.
- Bounded page size: 1–60.
- Search sender, sender name, and caption using parameterized SQL.
- Return `{ items, nextCursor, total }`; no storage credentials or raw provider URLs.
- `Cache-Control: private, no-store`.

### Live updates

`GET /api/events?kind=...&after=<id>`

Return only IDs and safe metadata for items newer than the cursor. The client polls every three seconds, pauses when the tab is hidden, and resumes on visibility change. No long-lived request.

### Item mutation

- `PATCH /api/items/[id]` accepts only a validated `caption` string, maximum 1,000 characters.
- `DELETE /api/items/[id]` requires a confirmation token generated by the server or an explicit typed confirmation in the UI. After authorization, delete the private Blob first; only after deletion is confirmed remove the database row. A failed Blob delete returns an error and preserves the row; a failed row delete leaves a broken, inaccessible row that a retry can clean.
- Every mutation returns a safe DTO or a generic error.

### Private media

`GET /api/items/[id]/file`

1. Authenticate the session.
2. Load the item and ensure its ID is the requested ID.
3. Prefer `blob_pathname`; during migration, fall back to `s3_key` only when no Blob pathname exists.
4. Fetch the private object on the server and stream it.
5. Set validated `Content-Type`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.
6. Set `Content-Disposition: attachment` for download mode; inline preview is allowed only for known safe media types.
7. Never return the Blob URL.

The route is the security boundary immediately adjacent to `get()`; middleware never grants media access by itself.

## 10. UI specification

### Information architecture

- `/login`: password stage, OTP stage, resend/expiry/error states.
- `/viewonce`: archive grid.
- `/status`: archive grid.
- `/delete`: full-width chronological log list.
- `/settings`: password/session controls and system status; no fake metrics.

Desktop uses a 280 px sidebar plus fluid content. Mobile uses a compact identity bar plus bottom navigation. Archive grid: four columns desktop, two tablet, one mobile. All controls have at least 44 px hit targets.

### Visual tokens

Use the existing `web/DESIGN.md` tokens: `#09090B` background, `#111114` surface, `#18181B` raised surface, `#26262B` hover, `#2A2A30` border, `#FAFAFA` text, `#A1A1AA` muted, `#71717A` faint, `#FFB38A` accent. Geist Sans for UI; Geist Mono for IDs, timestamps, and metadata. No decorative gradients.

### Archive behavior

- Search field is sticky above results.
- Search input waits 300 ms before querying.
- Loading uses stable skeletons; errors explain retry; empty states explain the active filter.
- New item receives a 2.2-second peach pulse and is announced through a polite live region.
- Preview opens in a Radix Dialog with focus restoration and Escape support.
- Edit and delete use accessible dialogs; delete states its permanent effect and requires deliberate confirmation.
- Toast feedback uses Sonner; errors remain visible in the relevant panel.
- Motion is disabled or reduced when `prefers-reduced-motion` is active.

### Required states

Loading, empty, error, success, live-new, dialog, keyboard focus, disabled/pending, and media-unavailable. Every state must have a visible non-color cue.

## 11. Bot and dashboard deployment

### Dashboard environment

Required in Vercel Production and Preview:

- `DATABASE_URL`
- `SESSION_SECRET` (at least 32 random bytes)
- `WEBHOOK_SECRET` (at least 32 random bytes)
- `BLOB_STORE_ID` (connected private store)
- Vercel OIDC variables for app-side Blob access

S3 variables remain available only for the migration/fallback window and are removed after cleanup approval.

### Bot environment

Required on the persistent bot host:

- `BOT_WEBHOOK_URL`
- `BOT_WEBHOOK_SECRET`
- `BOT_OWNER_USER`
- `BLOB_READ_WRITE_TOKEN`

The token is never committed, logged, sent to the browser, or included in webhook payloads.

### Vercel rollout

1. Create/connect a private Blob store to `wa-bot-dashboard`.
2. Provision Neon branch/database and set `DATABASE_URL` for Preview, then Production.
3. Deploy migrations manually and verify counts before application rollout.
4. Deploy a Preview build; run auth, media, migration-read, and browser checks.
5. Deploy bot with canonical direct Blob upload in canary mode.
6. Monitor ingest success, duplicate rate, storage failures, and latency.
7. Promote the same verified commit to Production.
8. Keep S3 fallback and old compatibility handling until the agreed cleanup checkpoint.

## 12. Verification and acceptance

### Automated

- Unit tests for password verification, OTP hash/consume, session revocation, HMAC timestamp/replay checks, event idempotency, query bounds, and media DTOs.
- Integration tests against Neon for migrations, insert/upsert, edit, delete, pagination, and failed transaction rollback.
- Bot tests for canonical payload, upload failure, retry classification, and legacy compatibility.
- `npm run typecheck` and `npm run build` pass in `web/`.
- No secrets in Git, build output, logs, or client bundles.

### Browser

- Login failure, password success, OTP expiry/retry, successful login, logout, and revoked session.
- Each archive route: search, all filters, empty/error/loading states, pagination, edit, delete, and live update.
- Image/video/audio/text preview and download; direct Blob URL request without a session fails.
- Keyboard-only navigation, visible focus, dialog Escape, focus restoration, screen-reader labels, and 44 px targets.
- Desktop, tablet, and mobile layouts; no horizontal overflow.
- Reduced motion disables pulse and nonessential transitions.
- Browser console and network contain no uncaught errors, failed private media requests, or public Blob URLs.

### Migration and deployment

- Migration dry run reports expected source counts.
- Every migrated row has a verified private Blob pathname and matching size.
- Production private media cannot be fetched unauthenticated.
- Rollback is: route traffic back to the previous Vercel deployment, keep S3 untouched, and replay only unacknowledged bot events after the schema remains backward-compatible.

## 13. Implementation order

1. Rotate/revoke exposed credentials; create private Blob store and Neon target.
2. Add versioned migrations, DAL/session model, and auth tests.
3. Add bot HMAC/idempotency contract and direct Blob upload.
4. Add private media route and migration script.
5. Add archive APIs and mutation tests.
6. Build the operational UI against the new APIs.
7. Run migration, Preview verification, then bot canary.
8. Promote Production only after all acceptance checks pass.
9. Remove compatibility/S3 fallback in a separately reviewed cleanup change.

## 14. Open decisions resolved for implementation

- Private Blob is authoritative for all new media.
- Bot-side static Blob token is intentional for the persistent non-Vercel bot.
- Full session revocation is required; stateless-only sessions are rejected.
- Neon HTTP remains for the first release; pool migration waits for evidence.
- Permanent delete removes metadata and attempts Blob deletion; no recycle bin.
- Existing S3 objects are retained until explicit post-launch cleanup.
