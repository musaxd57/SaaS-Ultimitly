# Güvenlik incelemesi 2. tur — 2026-10-22 (Opus, salt okuma)

> Durum (Claude, 10-22): F3 düzeltildi (ortak kapı `withAuth` + üç gövdesiz rota, `crossSiteWrite`; Origin yedeği eklenmedi —
> Sec-Fetch-Site göndermeyen eski tarayıcı + kardeş alt alan adı birlikte gerektiği için) · F8 düzeltildi (`operator.lead.updated` olay
> günlüğünde) · F1 / F2 / F4+F5 / F6 / F9 / F7 → kurucu soruları U10–U15 (`KURUCU-SORULARI.md` §U). Aşağısı incelemenin özgün metni.


Scope: uploads/storage, export/deletion/erasure, auth flows, public endpoints, iCal SSRF, email templates, admin panel.
Skipped: items already in docs/claude-work/2026-10-21/code-review/bulgular.json (e.g. forgot-password daily address cap,
private-host IPv4-mapped partial, admin/ai-quality non-operator writes) and the earlier-today review areas.

## Findings (written as found)

### Progress log (interim)
- Uploads/storage read: src/app/api/upload/route.ts, src/app/api/storage/photo/[...key]/route.ts, src/lib/storage/{keys,s3,adapter,deletion-queue}.ts,
  src/lib/image-validation.ts. No exploitable issue found (details under "Verified solid").
- SSRF: src/lib/net/{pinned-fetch,private-host}.ts probed with tsx (scratchpad/probe/ssrf.ts) + Node bracket test (probe/v6.mjs):
  IPv6 literal feed URLs never connect (Node passes "[...]" to lookup -> ENOTFOUND), so the remaining isPrivateAddress
  gaps (::ffff:0:7f00:1 SIIT, Teredo 2001::/32, ::ffff:ffff:..) are only reachable via AAAA records and are not routed
  on Linux. Already-known item (bulgular.json private-host). No new finding.
- Auth flows read: login, forgot-password (+challenge lib), verify-email, resend-verification, register, 2fa, password,
  delete, export, session/trusted-device/known-device, middleware, safe-redirect, admin-core.

## Result: no P1 found in the seven focus areas. Findings below are P2 (preconditioned) and P3 (hardening).
None of them appear in bulgular.json (keyword cross-check done).

### F1 — P2 — Full KVKK data export has no step-up re-authentication; owner session is a long-lived bearer
- Where: src/app/api/account/export/route.ts:18-39 (withManage + `role === "owner"` + 3/h, then
  `buildOrganizationDataExport`). Contrast: src/app/api/account/delete/route.ts:35-52 requires password + daily reauth cap.
- Why it matters: the export is the single richest object in the product (every guest name, phone, e-mail, every message
  body, reservations, consent evidence, audit log). Owner sessions are effectively non-expiring: src/middleware.ts:111
  re-signs the JWT with a fresh 14-day expiry on every page view, and logout (src/app/api/auth/logout/route.ts:6-20)
  only clears the cookie on that device (no server-side revocation; accepted design per CLAUDE.md "per-session jti").
- Attack: attacker obtains the owner's session cookie once (infostealer malware, a browser profile copied off a shared
  machine, a same-site XSS) -> top-level navigation / curl with `Sec-Fetch-Site: none` (allowed at :23-24) ->
  GET /api/account/export -> complete guest PII dump. No password, no TOTP, and the owner gets no e-mail about it
  (only an audit row).
- Minimal fix: make export a POST that requires the account password (and a TOTP code when `twoFactorEnabledAt` is set),
  reusing `reauthBlocked` / `noteReauthFailure` exactly like account/delete; optionally send an "export downloaded"
  notice e-mail to the owner. (Customer-facing behaviour change -> founder decision.)

### F2 — P3 — Account deletion does not ask for the second factor on 2FA accounts
- Where: src/app/api/account/delete/route.ts:38-52 (password only), :80 deleteAccountData.
- Attack: session thief who also phished/reused the password (common pairing) can irreversibly delete a 2FA-protected
  org without the TOTP device. 2FA disable/recovery-code routes already demand a TOTP code; delete is the odd one out.
- Fix: when `twoFactorEnabledAt` is set, require `code` (verifyTotpStep + twoFactorLastStep burn) or a recovery code.

### F3 — P3 — Body-less state-changing POSTs rely solely on SameSite=Lax (no Origin / Sec-Fetch-Site check)
- Where: route wrappers in src/lib/route-guard.ts have no Origin/Sec-Fetch-Site gate; the JSON content-type gate in
  `readJsonCapped` (src/lib/api.ts:503) only protects routes that read a JSON body. Body-less POSTs bypass it:
  src/app/api/properties/[id]/rotate-ical/route.ts:28 (breaks every channel's calendar subscription -> double-booking
  risk), src/app/api/reservations/[id]/erase/route.ts:33 (irreversible, flag-gated), .../reset-chat/route.ts:12,
  src/app/api/conversations/cleanup-duplicates/route.ts:14, reservations/[id]/reactivate, reservations/[id]/chat-pin POST,
  tasks/backfill, outbox/[id]/retry, admin/exit, calendar*/sync, hospitable/sync, billing/portal, billing/resume-preview.
- Attack: any same-site origin (any *.lixusai.com host now or later: status page, docs, marketing CMS, a preview deploy)
  with an XSS or user content can auto-submit `<form method=POST action=https://www.lixusai.com/api/properties/<id>/rotate-ical>`;
  Lax cookies are sent same-site. Cross-site is blocked today by Lax only.
- Fix: one check in withAuth/withManage/withOwner for non-GET methods: reject when `Sec-Fetch-Site` is present and not
  `same-origin`, else require `Origin` to match appBaseUrl(). (Same rule the export/admin GETs already apply.)

### F4 — P3 — Unauthenticated attacker can burn a new user's verification budget and keep rotating their link
- Where: src/app/api/auth/resend-verification/route.ts:40,48 (per-address buckets keyed on the attacker-supplied
  address) and :66/:81 (every call overwrites `emailVerifyTokenHash`).
- Attack: right after a victim registers, script 6 resends for their address: each invalidates the previous link, the
  victim gets 6 mails, and for 24 h neither attacker nor victim can request another link. If the victim then acts on an
  older mail it fails with "expired". Same attacker-controlled-bucket trap the code already documents for `forgot-req`.
- Fix: do not rotate when an unexpired token exists (re-send the same token from the encrypted outbox payload), or
  only rotate when the previous token is older than N minutes.

### F5 — P3 — Timing oracle: resend-verification reveals "unverified account exists"
- Where: src/app/api/auth/resend-verification/route.ts:54-71 — unknown/verified address returns after one SELECT;
  unverified address runs a transaction (advisory lock, updateMany, aggregate, insert) with no bcrypt to mask it.
- Impact: low (only freshly registered, unverified accounts), but every other identity route was built for parity.
- Fix: run an equivalent dummy transaction on the miss path, or enqueue asynchronously after responding.

### F6 — P3 — Public demo returns the internal safety-gate verdict (oracle for tuning abusive guest messages)
- Where: src/app/api/demo/ai/route.ts:172-176 returns `confidence`, `riskLevel`, `wouldAutoSend` unauthenticated
  (12/h/IP, 300/day global).
- Attack: a malicious guest iterates wording against the same `passesAutoReplySafetyGate` the product uses until
  `wouldAutoSend: true`, then sends that phrasing to a real host (e.g. to get a reply auto-sent instead of escalated).
  KB differs from production, so the transfer is partial.
- Fix: return only `reply` (and a coarse "would a human review this" boolean if marketing needs it), not the numeric
  confidence / risk level.

### F7 — P3 — Global-cap gap for verification e-mails / org creation under IPv6 rotation
- Where: src/app/api/auth/register/route.ts:67 (5/h per `rateLimitClientKey`, which is a /64 for IPv6 —
  src/lib/rate-limit.ts ipBucketKey). No daily/global cap on new-account verification e-mails or org rows.
- Attack (only if the edge accepts IPv6): a free /48 (65k /64s) -> ~300k registrations/hour, each creating
  Organization+User+Subscription rows and one verification e-mail to an attacker-chosen address (sender reputation /
  Resend account suspension; content is fixed, so no content injection).
- Fix: a global `register-global:<hour>` ceiling (e.g. 200/h) that pages the operator instead of silently 429-ing.

### F8 — P3 — Admin lead PATCH is the only operator write without an audit trail
- Where: src/app/api/admin/leads/[id]/route.ts:26-58 (status/note/followUpAt changes, no writeAudit / logEvent).
- Fix: `logEvent("operator.lead_update", {leadId, fields})` (AuditLog needs an org id; the event log does not).

### F9 — P3 — Public iCal export ships the property's entire booking history on every poll
- Where: src/app/api/calendar/[token]/route.ts:44-50 (no lower date bound). With `icalShowGuestName` on, every past
  guest name/channel/reference since account creation goes to Airbnb/Booking/Google on every poll; with it off, the
  full occupancy history. Also unbounded query per poll.
- Fix: `departureDate >= now - 30 days`.

### Known items re-confirmed (not new, listed for the flag-flip checklist)
- QR PIN lockout DoS (src/lib/guest-chat-pin.ts:150-155, :197): the lockout also blocks the CORRECT PIN, so whoever holds
  a photo of the QR can keep a not-yet-claimed stay locked with 10 wrong guesses / 15 min (40/h, under the 96/h IP cap).
  CLAUDE.md kalici-kararlar:435 says "PIN DoS tasarımı var, uygulanmadı" — becomes live the moment QR_PIN_ENABLED=1.
- Logout does not revoke server-side; middleware re-sign = sliding non-expiring session (accepted design).
- Recovery codes hashed with unkeyed SHA-256 (src/lib/auth/recovery-codes.ts:36) — ~2^59 space, offline-crackable only
  after a DB leak; deliberate (rotation safety).
- exitImpersonation writes the operator's own org id into the customer's audit log (src/lib/admin.ts:128), which is
  exported to the customer — opaque id, negligible.

## Verified solid (checked in code, file:line)
1. Upload/storage: real-byte sniffing decides type/ext (src/lib/image-validation.ts:7-23; upload/route.ts:59-63),
   streamed hard body cap (src/lib/api.ts:348-378), keys built only server-side from session org + DB task id
   (src/lib/storage/keys.ts:24-31), strict 5-segment key grammar with `..`/`//`/`\` rejection (:34-48), serve route
   re-checks org segment, live TaskUpdate reference and staff assignment before a 300 s SigV4 URL
   (storage/photo/[...key]/route.ts:33-58; s3.ts:89). Deletion queue tenant choke point + orphan sweep.
2. SSRF: https-only, no userinfo/port, pre-check + pinned validating lookup on every resolved address, no redirects,
   10 MB streamed cap, 15 s total deadline (src/lib/net/pinned-fetch.ts). IPv6 literals cannot even connect (probed).
3. Password reset: 256-bit token + bcrypt'd 8-digit code, 30 min, 5 attempts claimed atomically before compare,
   single-use CAS consume that bumps sessionEpoch and invalidates siblings (src/lib/auth/password-reset-challenge.ts).
   Trusted/known-device JWTs carry `purpose` + sEpoch and cannot be replayed as sessions (session requires org+email).
4. Login: per-IP + failure-only account bucket, known-device gate, TOTP 10/10 min + 20/day, atomic step burn
   (login/route.ts:49-305); `?next=` normalised through URL + same-origin + non-/api (src/lib/safe-redirect.ts).
5. Admin: every /api/admin route = isSuperAdmin (allowlist + DB-rechecked mfa) + impersonation refusal + per-operator
   rate limit; impersonation start audit is mandatory before the cookie (src/lib/admin.ts:67-76); GET exports/searches
   refuse cross-site Sec-Fetch-Site. Host e-mail templates escape every guest-controlled value (email-templates.ts:22,
   ctaButton :466-471) and subjects are flattened by singleLineSubject (email-core.ts:59-63).

## Ranked summary
1. F1 P2 export without step-up re-auth (+ non-expiring session) — highest real-world impact (full guest PII).
2. F3 P3 no Origin/Sec-Fetch-Site gate on body-less POSTs (rotate-ical, erase, cleanup) — one-line wrapper fix.
3. F2 P3 delete without TOTP on 2FA accounts.
4. F4 P3 resend-verification budget burn / link rotation.
5. F6 P3 demo leaks gate verdict.
6. F7 P3 no global registration cap (IPv6 /48 rotation).
7. F9 P3 iCal feed full history.
8. F5 P3 resend timing oracle.  9. F8 P3 lead PATCH unaudited.
