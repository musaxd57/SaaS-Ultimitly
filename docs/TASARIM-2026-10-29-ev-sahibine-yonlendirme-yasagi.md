# TASARIM 2026-10-29 — "Ev sahibinize yazın" yasağı, cevapsız soru açık kalır, kayıp anahtar (K-1029-A/B/C/D)

> Kurucu talimatı (10-29 gece, aynen notlar `docs/INCELEME-2026-10-28-gece-dongusu.md` 10-29 bölümü): "ev sahibinize yazın" her dilde /
> her biçimde yasak (istem + kod); cümle silinir, doğru cevap gider, cevapsız soru AÇIK kalır, asla "cevaplandı" değil (K-1029-A) ·
> GD5: yalnız talimat yan cümlesi silinir, bilgi gider (K-1029-B, geçici) · ek / koşul eki sezgileri karar vermesin, anlamı model okusun
> (K-1029-C) · kayıp anahtar her dilde ev sahibine + öncelik (K-1029-D).
>
> Süreç: iş akışı (13 ajan) — 5 harita (öğe akışı, bildirimler, ek sezgileri, sözcük ağları, anlama katmanı) + 2 araştırma (büyük şirketler,
> açık kaynak) + 3 bağımsız tasarım + 2 hakem + sentez. Aşağıdaki plan sentezin AYNEN metnidir (İngilizce); uygulanan / ertelenen
> maddelerin durumu en altta Türkçe.
>
> **Türkçe özet:** Bir istek ancak üç şart birlikteyse "cevaplandı" olur: (a) model cevapladığını söyledi, (b) silinen ev sahibine
> yönlendirme cümlesi o isteğe ait değil, (c) misafire GİDEN metin o isteği gerçekten karşılıyor (ayırt edici konu / terimle). Şüphede istek
> açık kalır, doğru cevaplar yine gider, ev sahibine tek "Misafir cevabınızı bekliyor" e-postası. Yönlendirme cümlesi yedi dilde (TR, EN,
> DE, FR, ES, RU, AR) ve ev sahibinin kendi sesiyle ("bize yazın", "message us") yakalanır; yalnız SİLER, hiçbir şeyi gevşetmez.
> "Arayın" cümlesi model sinyali (anahtarlı, kapalı) ölçülene kadar tutulmaz; güvenlik uyarıları (gaz, yangın, duman, acil numara) kalır.
> İstem yasağı varsayılan AÇIK (kurucu "istem + kod" dedi; acil kapatma `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=1`).

# Final plan: "Ev sahibinize yazın" ban, keeping unanswered questions open, lost key

I checked this against HEAD `12879953`, with no paid calls. File paths are relative to `/home/user/SaaS-Ultimitly`. My probe script is at `/tmp/claude-0/-home-user-SaaS-Ultimitly/4b3a6b83-dfb6-5a82-b43d-8777d09e2d05/scratchpad/final-probe.ts`.

Facts I confirmed tonight:
- **Founder's own examples hold the whole reply today.** "Herhangi bir sorunda ev sahibinize yazın.", "Should anything go wrong, message your host.", "Feel free to message your host.", the German example and "напишите хозяину" are all read as "I have no information" (`admitsMissingKnowledge`), so nothing is sent.
- **Some phrasings leak to the guest today.** "En cas de problème, écrivez à votre hôte." and "Çıkışta … bize mesaj atın" are not caught by anything.
- **Cutting the wrong clause creates a promise.** "Bir sorun olursa ev sahibinize yazın, kendisi teknisyen gönderir." is read as an instruction. If only that clause were cut, "Kendisi teknisyen gönderir." would be sent.
- **Lost key still reads as a check-in question.** `classifyFallback("Anahtarı kaybettim")` returns `checkin` / `standard`.
- **These lost-key messages are missed:** "anahtari kaybetim", "lost key", "Eve giremiyoruz".
- **The `human_request` fallback text is a banned handoff sentence** ("Talebinizi ev sahibimize ilettim", `fallback.ts` around line 2955).
- **Unfinished work is sitting in a stash.** `stash@{0}` ("wip-after-gate-1029") holds an accent fold for the lost-key list (`fallback.ts`, +8 lines), new lines in `tests/unit/access-loss-net.test.ts`, and the free robustness run (`tests/eval/robustness-*.ts`, `evals/robustness/bases.json`, `docs/olcum/robustness-kelime-agi-2026-10-29.md`). The same stash also holds HZ `loading.tsx` changes, which belong to another task.

---

## (A) Decisions and why

**A1. Which design is the base.**
- Design 1 provides the "answered" rule, the settle step, sending the remainder plus escalating on QR, the no-request-record helper and the kill switch.
- Design 3 provides the multilingual detector, the safety-word lookaheads, the closed typo list and the host e-mail on held turns (narrowed).
- Design 2 provides the deletion-only check, the replay script, the measurement thresholds and the mutation-target list.
- Why: both judges found that Design 2's "generic closing keeps the model's list as is" closes the question silently (the bug we are fixing). Judge 1 showed Designs 2 and 3 can produce unconditional promises. Judge 2 showed Designs 1 and 2 keep the multilingual leaks.

**A2. One rule for "answered", on every path.** A guest request closes only if all three hold:
- (a) the model declared it answered (in `answeredRequests.refs`, or as an `answered` part);
- (b) no removed host-contact text is attributed to it;
- (c) the text actually sent still covers it, judged by distinctive topics and terms.

Anything uncertain leaves the request open. Sending the rest of the reply is a separate decision from closing a request, and correct answers still go to the guest (directive 2). With the situation flag off, the model's situation signal can only open requests, never close them.

**A3. The code ban has no on-flag and applies everywhere.** Paths: channel items mode, parts mode, channel without items, QR, AI öner, Ayarlar test and demo. A removed sentence is never sent, never put in a draft and never stored. Removal records hold only `kind`, `form`, `appendix`, `stems`, `topics` and `generic`; there is no raw text. Traces store counts only.

**A4. Detector = union of signals.** `refersGuestToHost` ∪ `conditionalHostContactKind` ∪ a new multilingual `mentionsHostContact`.
- The new pattern list covers TR, EN, DE, FR, ES, RU and AR, plus "property owner/manager".
- It also covers host-voice filler, but only in conditional or closing form: "Bir sıkıntı olursa bize yazın", "If you need anything, message us", "Düzelmezse yeniden yazın".
- Today's exclusions stay: negated ("sormanıza gerek yok"), contact value, first person ("I'll check with the host") and host-as-subject statements. K10 keeps handling those, as today.
- Host-voice step instructions ("anahtarı bırakıp bize mesaj atın") are left alone tonight (F3).
- A non-match means today's behaviour, so the detector can never loosen anything.

**A5. Cutting part of a sentence (GD5) uses the strictest form.**
- Only condition-free clauses that come before the first condition or instruction clause are kept. Everything from that point to the end of the sentence is removed.
- Judge 1's example: "…yazın, kendisi teknisyen gönderir" is removed as a whole sentence.
- The kept text must be the original words in their original order (deletion-only check). The detector is run again on the kept text.
- Clauses split on `, ; :` and the Arabic comma `،`. Leading conjunctions and trailing punctuation are trimmed (including the space before French `;`) and the final full stop is restored. The first letter is uppercased only if the original sentence started uppercase (Turkish locale only for Turkish text).
- If the split is not clean, the whole sentence is dropped and the request stays open.
- This is temporary, as GD5 is temporary per the founder; the replay script measures how much information it loses.

**A6. "Call your host" is never kept without a model signal (directives 3 and 4).**
- **Safety warnings are kept**, under a narrower rule: the safety word must survive these lookaheads: `fire(?!\s*(?:tv|stick))`, `gas(?!\s*station)`, `gaz(?!ete|ino|oz|i|l[ıi])`, `smoke(?![-\s]?free)`. In addition, `isSafetyEmergencyText` must be true or the hazard level must not be `none`.
- **A guest-asked hypothetical is kept only behind the flag.** It needs `AI_UNDERSTANDING_SITUATION_ENABLED=1`, a topic-matched request marked `hypothetical`, no matched request marked `ongoing`, an explicit call verb, and a knowledge-base basis for the sentence.
- `asksHypotheticalSituation` is removed from every keep path (`host-contact-filler.ts:52-62`, `:77`, `:106`).
- A "write" sentence is never kept.

**A7. What happens on each path.**

| Path | Guest gets | Request state | Host |
|---|---|---|---|
| Channel, items mode | The remainder | Settled by the A2 rule | "Açık" on the card, "N açık iş", one "Misafir cevabınızı bekliyor" e-mail |
| Parts mode | Verified parts with the removed text cut | Part becomes `no_info`, or sent but still open (`openAfterSend`) | Same e-mail |
| Channel without items (degraded) | Remainder only if `hostContactOpenWithoutLedger` is false; otherwise the whole reply is held | — | E-mail when held |
| QR | The remainder | Escalated as `host_contact_open` when that helper is true (urgent, `human_review`) | Panel; e-mail only if the QR e-mail flag is on |
| AI öner | Stripped draft | — | Notice |

On the channel without items there is no per-request record, and sending would show the conversation as "Cevaplandı", which breaks A2.

**A8. Host e-mail on held turns.** A new boolean `hostContactNotify` drives the existing "Misafir cevabınızı bekliyor" branches only. It is never passed into `heldReasonOf`, so unrelated holds keep their reason (judge 1).

**A9. The prompt ban is on by default.** The founder ordered "prompt AND code". Railway has been off since 10-02, so nobody is exposed. The emergency off switch is `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=1`. The paid measurement becomes a gate before Railway opens.
- The main prompt bans the sentence and points to the existing "no information" rule. It never says "do not answer that question", because on QR and the channel without items that would make questions disappear silently (both judges).
- "Do not answer that request" goes only into the items block and the parts addendum.

**A10. Meaning, not suffixes (directive 4).**
- Build the `situation` field inside the existing understanding call, behind a flag that is off. The values are ongoing, hypothetical, past, action_request, info and unclear.
- The founder explicitly asked for meaning to be judged by the model, and this is no new model call.
- The separate "reader" check (a new model call) is not built; it is F5.

**A11. Lost key (directive 6).**
- Restore the stashed accent fold.
- Add a closed typo list (only adds holds).
- Add lockout phrases tied to a place word.
- `classifyFallback`: for lost-key text, set intent to `general` and priority to `urgent`. Not `checkin` (the founder says that is wrong). Not `human_request`: its fallback text is a K10-banned handoff, and it changes the `lexical_intent` hold at `automation.ts:482`.
- Do not add the "kaybol" stem: it would hold the hypothetical "kaybolursa" as Acil (judge 1).
- With the flag on, the situation field adds a meaning-based label: `access_keys` + `ongoing`/`unclear` → `access_security`.

**A12. Kill switch.** `AI_HOST_CONTACT_PARTIAL_DISABLED=1` makes any non-generic removal, or one tied to a contingency question, hold the whole reply on every path. The ban itself stays: the stripped text is still what gets drafted, and the e-mail still goes out.

**A13. Gate backstop.** If the final reply differs from the filler's output, the gate re-checks it. Any "write" or "referral" sentence, or any "call" sentence while the situation flag is off, holds the reply with `reply_host_contact_only`. This covers paths that change the text after the filler runs.

**A14. Other suffix rules that loosen today (directive 4)** are not changed tonight. This is a separate slice because it raises hold rates:
- `hazard-evidence.ts:355-363` (`HYPOTHETICAL`) and `:905-911` (mentioned → cleared);
- `neutralizeNonEmergency`;
- the negation lists;
- the `classifyFallback` exemptions.

Tonight I write an inventory with replay counts and give the founder before/after examples. The `absence.ts:891` EVENT exemption is already covered by the new detector.

---

## (B) Steps in order

Each slice follows the same routine: write failing tests first, then code, Haiku review, `scripts/mutation-run.mjs` (M0 control run first), full `npm test` and build, commit (author Claude, heredoc message, no backticks). Push only when everything is green, then check CI.

**S0 – Preparation**
1. Check that `git diff stash@{0}^1 HEAD -- src/lib/ai/fallback.ts tests/unit/access-loss-net.test.ts` is empty, then apply only those two paths from `stash@{0}`.
2. Restore the untracked robustness files with `git show stash@{0}^3:<path>`.
3. Leave the `loading.tsx` changes in the stash for task #233.
4. Save this plan as `docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md`.

**S1 – Detector: `src/lib/ai/host-contact.ts` (new, pure)**
Export read-only from `absence.ts`: `HOST_REFERRAL_PATTERNS` (:665), `EVENT_CONDITION` (:736), `EVENT_WORDS` (:751), `TRAILING_CONDITION` (:902) and the exclusion helpers (:800, :825, :841).
```ts
export type HostContactKind = "write" | "call" | "referral";
export function hostContactKindOf(sentence: string): HostContactKind | null;      // refersGuestToHost → "referral"; else conditionalHostContactKind; else mentionsHostContact
export function mentionsHostContact(clause: string): HostContactKind | null;       // addressee (host words ×7 langs; bize/bana/us/uns/nous/нам/لنا only with a condition or as a closing) + contact verb within 4 tokens; same exclusions
export function hasExplicitCallVerb(sentence: string): boolean;                    // ara-/call/phone/ring/anruf/ruf…an/appel/llam/позвон/اتصل ("ulaşın/contact" is NOT a call)
export function isConditionLike(clause: string): boolean;                          // used only to remove more text
export function isGenericContingency(text: string): boolean;                       // "bir sorun olursa", "if anything goes wrong/comes up", "falls etwas fehlt" …
export function asksAboutContingency(texts: readonly string[]): boolean;           // closed list (EVENT_WORDS + gider-se/çalışmazsa/stops working/ausfällt/tombe en panne/deja de funcionar/перестанет); used only to open or hold
export function hostContactNoiseFreeStems(text: string): string[];                 // stems minus host nouns, contact verbs, generic trouble, courtesy (feel free, n'hésitez, çekinmeyin), arrival words
export function hostContactResidue(reply: string, o: { situationFlag: boolean }): boolean; // gate backstop (A13)
```
Add a cost pin, `tests/unit/host-contact-detect-cost.test.ts`: a 4k–50k character single word, a whitespace run and a repeated stem, with the ReDoS rules (linear patterns only).

**S2 – Filler rewrite: `src/lib/ai/host-contact-filler.ts` (whole file)**
```ts
export interface HostContactRemoval { kind: HostContactKind; form: "conditional" | "referral"; appendix: boolean; stems: string[]; topics: string[]; generic: boolean }
export interface GuestSituation { situation: UnderstandingSituation; intent: UnderstandingIntent; queryTr: string; queryOriginal: string; ref?: string }
export interface HostContactAnalysis { text: string; removals: HostContactRemoval[]; nothingLeft: boolean }
export function analyzeHostContact(reply: string, ctx: { kbTexts?: readonly string[]; situations?: readonly GuestSituation[] }): HostContactAnalysis;
export function splitInstructionClauses(sentence: string): { kept: string | null };   // A5
export function filterHostContactParts(parts: readonly AnswerPart[], ctx: { kbTexts?; situations?; needs: readonly SettleNeed[] }): { parts: AnswerPart[]; keepOpen: Set<string> };
export function stripHostContactFiller(reply, guestTexts, kbTexts): { text: string; hostContactOnly: boolean }; // compatibility wrapper
```
- Delete `guestAskedThisSituation` and `carriesOtherInformation`.
- `SAFETY_WARNING` (:31-32) gets the A6 lookaheads, plus the requirement that the hazard or emergency check also fires.
- `hostContactOnly` = `nothingLeft || (partialDisabled && removals.some(r => !r.generic))`.
- Update the pins in `tests/unit/host-contact-filler.test.ts`: lines 92-127 (GD1/GD5) and 174-182 (call kept with a knowledge-base basis → now removed while the flag is off). Cite K-1029.

**S3 – Settle step: `src/lib/conversation-items/host-contact-settle.ts` (new, pure)**
Export from `topic-absence.ts`: `isGenericToken` (:131), `distinctiveTokens` (:136), `sameWordStrict`/`sameWordLoose` (:182/:194), the attribution logic (around :254-261) and the coverage logic (around :291-304). `stripTopicAbsence` stays unchanged and pinned.
```ts
export interface SettleNeed { ref: string; topics: readonly string[]; terms: readonly string[]; contingency: boolean }
export function settleHostContactRemovals(i: { removals: readonly HostContactRemoval[]; keptText: string; needs: readonly SettleNeed[];
  declared: { refs: readonly string[]; openRefs?: readonly string[] }; greetingName?: string | null }): { refs: string[]; openRefs: string[]; trace: { n: number; o: number; u: number } };
export function hostContactOpenWithoutLedger(i: { removals: readonly HostContactRemoval[]; keptText: string; guestTexts: readonly string[];
  requests: readonly { queryTr: string; queryOriginal: string }[] | null }): boolean;
```
Settle algorithm:
1. No removals → no change.
2. **Owners of each removal** = requests whose topics overlap the removal's topics, plus the best loose term overlap (ties all count). Appendix removals are included (judge 1, fix D1-a).
3. **Unattributed content:** if a non-generic removal has no owner, open every declared request.
4. **Coverage always runs.** Any declared request not yet opened is opened if it is a contingency request, or if it is not distinctively covered. Distinctive means the kept text hits topics or terms that no other request shares. A request with no distinctive topic or term counts as not covered.
5. **Nothing left:** if no substantive sentence remains, open all.
6. **Output:** `refs` = declared minus opened. `openRefs` = (opened requests the kept text still touches loosely) ∪ the previously declared `openRefs`.

`hostContactOpenWithoutLedger` returns true when there is a removal and any of these holds:
- some removal is topical (not generic);
- the guest asked about a contingency;
- `requests === null` (understanding did not run);
- some request is not distinctively covered.

**S4 – Plumbing results**
- `src/lib/ai/index.ts:805-812`: use `analyzeHostContact(shown.text, { kbTexts: kbTextsOf(input), situations: input.guestSituations })`. `replyText = a.text`. At `:912`, add `hostContactRemovals` when there are any, and `hostContactOnly` when `nothingLeft`.
- `types.ts:75`: add `guestSituations?: readonly GuestSituation[]`.
- `types.ts:314-318`: add `hostContactRemovals?: HostContactRemoval[]`, `hostContactOpen?: true` and `hostContactCheckedReply?: string` (for A13).
- `semantic/senior-rewrite.ts:113-119`: take these fields from `retried`, never from the first result.
- `code-built-result.ts:15`: drop them.
- `automation.ts:408`: add them to the gate's result type.
- Add a test that no stored or prepared draft keeps the banned sentence.

**S5 – Channel items mode: `src/lib/automation.ts`**
- `conversation-items/plan.ts:176-185`: build `answerableTopics` unconditionally (gate input only; prompt bytes unchanged). Add `contingency: asksAboutContingency(queries)`. Update the plan pin.
- Around `:2767` (after the topic-absence block ends, before the parts altered-check at about `:2778`), when `itemsPlan && !replyItems?.parts && result.answeredRequests?.ok && removals.length`, run `settleHostContactRemovals(...)` and rewrite `result.answeredRequests`. With the kill switch on, set `hostContactOnly` instead.
- Backstop at `:615`, next to the existing check: `if (result.reply !== result.hostContactCheckedReply && hostContactResidue(result.reply, …)) return hold("reply_host_contact_only")`.
- Define near `:3356`:
  ```ts
  const hostContactNotify = result.source === "openai" && (result.hostContactOnly === true || result.hostContactOpen === true || (gateFailure === "items_nothing_answered" && (hostContactTrace?.o ?? 0) > 0))
  ```
  Use it at `:3432` (`handoffHeld || partsUnanswered || hostContactNotify`) and at `:3792` (`!turnCardsOpen && (handoffHeld || hostContactNotify)`). Do not pass it to `heldReasonOf` (:4271).
- At `:3157`: add `hostContact: hostContactTrace` (counts only).

**S6 – Channel without items.** Before the gate: `if (!itemsPlan && removals.length && hostContactOpenWithoutLedger({ …, requests: understanding?.requests ?? null })) result = { ...result, hostContactOpen: true }`. At `:615`: `if (result.hostContactOnly === true || (!items && result.hostContactOpen === true)) return hold("reply_host_contact_only")`.

**S7 – Parts mode: `index.ts`**
- Right after `parseAnswerParts` (around :665), and again on rewritten parts (around :769/:774), call `filterHostContactParts`.
- Pass `keepOpen ∪ reader.keepOpen` into every `composeVerifiedReply` call (around :680, :721, :726, :781, :788).
- The final filler at :805 stays as a backstop. If it still finds something, the altered-part check (around :2778) holds the turn, as today.

**S8 – QR: `src/app/api/chat/[token]/route.ts:1456-1499`**
```ts
const hostContactOpen = !escalate && emergencyNumber === null && !partialDisabled() && !!finalResult.hostContactRemovals?.length &&
  hostContactOpenWithoutLedger({ removals, keptText: finalResult.reply, guestTexts: qrUnanswered, requests: understood?.requests ?? null });
const sendEscalate = emergencyNumber !== null || escalate || hostContactOpen;
// reply = emergencyNumber ? emergencyNumber.text : escalate ? null : finalResult.reply
// finalReason: "emergency_number" | "host_contact_open" | verdict.reason
```
- Add `host_contact_open` to `src/lib/risk-events.ts` (around :99) and to `ESCALATION_REASONS` in `src/lib/guest-chat-gate.ts:168`.
- Set `traceQr.sentText = reply` whenever `reply` is not null.
- The alert is non-critical, and is sent only when `QR_ESCALATION_EMAIL_ENABLED=1`.
- `guest-chat-gate.ts:362` is unchanged and now fires only when nothing is left.

**S9 – AI öner, test and demo**
- `ai-suggest/route.ts:301-302`: add `hostContactNotice: { removed: n, maybeUnanswered: boolean }`. If `hostContactOnly`, the draft is `""`.
- `ai/test/route.ts:220` and `demo/ai/route.ts:159`: add `hostContactRemovedCount` and `hostContactOpen`.
- The UI change (`conversation-thread.tsx:99`, `:113`, `:1085`) waits for F4's wording.

**S10 – Prompt layer**
- In `prompts.ts`, add `hostContactBan: boolean` to `ReplyPromptFlags` (around :1500) and a `PROMPT_LAYERS` entry (around :1518) with these anchors:
  - :423-425 (insert the bullet);
  - :361-362;
  - :508;
  - the parts `no_info` line at :1365-1366.
- The flag value is `process.env.AI_HOST_CONTACT_PROMPT_BAN_DISABLED !== "1"`. The base prompt (all flags off) stays byte-identical, and every flag combination must have `missing=[]`. The anchors must not collide with codeGreeting, courtesy or noApology.
- `reply-block.ts:100-103`: add the items line when the ban is on.
- Do not touch :1709 (F2) or `absence-judge.ts:83-84` (measure first).

**S11 – Lost key: `src/lib/ai/fallback.ts`**
- `ACCESS_LOSS_VERBS` (around :2740+), closed typo list: kaybetim, kaybetik, kaybetdim, kaybetmişim, kaybetmişiz. The misses measured by the robustness run: anathar, anahtra, aanhtar, anhtar. English: "lost key", "lost keys", "lost the keys", "key is lost", "keys are lost".
- `ACCESS_LOCKOUT_PHRASES` (:2771-2783), place-anchored and declarative only:
  - TR: eve / daireye / binaya / içeri + giremiyoruz / giremiyorum / giremedik / giremedim
  - EN: "can't/cannot get into the apartment/flat/house/building"
  - DE: "kommen nicht in die Wohnung" / "kommen nicht rein"
  - ES: "no podemos entrar al piso/apartamento/a la casa"
  - FR: "on ne peut pas entrer dans l'appartement"
  - RU: "не можем попасть в квартиру"
  - AR: "لا نستطيع دخول الشقة"
  
  The bare "giremiyor" is never added.
- `detectIntent` (:1570): check `isAccessLossText` first → `general`. `classifyFallback`: priority `urgent`.

**S12 – Situation field (flag `AI_UNDERSTANDING_SITUATION_ENABLED`, off)**
- `understanding-schema.ts` (around :272-299): name suffix `_sit`, `situation` in `extraRequired`. `UnderstoodRequest.situation?` (around :310-325).
- `understand.ts`: read the flag (around :374-380), cache key mode `\u0000sit`, and add the flag to the parse-option condition (around :404-407). Without that last change the parser never reads the field. Unknown or missing values become `unclear` and the request is never dropped.
- Consumers:
  - `extract.ts` (around :123-150): `access_keys` + `ongoing`/`unclear` → `access_security`.
  - Carry `situation` on `ReplyItemsInput.answerable[]` (not into the prompt).
  - `guestSituations` reaches `suggestReply` at `automation.ts` around 2428/2605. On QR and AI öner, await understanding first, but only when the flag is on.

**S13 – Free measurement tonight.** `scripts/eval-host-contact-replay.ts` (read-only) runs the old and new filler plus settle over the `docs/olcum/*.json` sidecars. It counts:
- removed sentences;
- holds gained and lost;
- requests opened (over-open);
- information clauses lost;
- QR escalations.

Results go to `docs/olcum/host-contact-replay-2026-10-29.md`.

**S14 – Directive 4 inventory.** `docs/claude/sozcuk-aglari.md` gets a new § listing the loosening suffix rules from A14, with replay counts and before/after examples. No behaviour change.

**S15 – Registration and documentation**
- Register flags in `STRICT_ONE_FLAGS` (`scripts/env-check.mjs:628`) and in the `_DISABLED` list (around :692-711), plus `tests/eval/run-meta.ts` and `docs/RAILWAY-ACILIS-2026-10-15.md` (pin `railway-doc-flags.test.ts`).
- Update `docs/claude/ai-guvenlik.md` (rule text) and `docs/claude/durum.md`, and add one line to `CLAUDE.md`.
- Final full gate, push, CI check.

---

## (C) Tests to write first (they fail today)

Notation:
- Requests: ✓ = answered/closed; ◐ = sent but still open (`openRefs`); ○ = open and not sent.
- E-mail: "W" = one "Misafir cevabınızı bekliyor" e-mail; "A" = Acil e-mail.

**C1 – The ban, channel items mode** (fake model JSON; understanding fixture marks both requests answerable)

| # | Guest | Model reply → declared | Guest receives | Requests | Gate / e-mail | Today |
|---|---|---|---|---|---|---|
| TR1 | Otopark var mı? İnternet giderse ne yapalım? | "Otopark binanın arkasında. Herhangi bir sorunda ev sahibinize yazın." [R1,R2] | Otopark binanın arkasında. | R1✓ R2○ | send / W | hold, nothing sent |
| TR2 | Çöpü nereye atıyoruz? | "Çöp konteyneri binanın girişinde. Bir sıkıntı olursa bize yazabilirsiniz." [R1] | Çöp konteyneri binanın girişinde. | R1✓ | send | LEAK |
| EN1 | Is there parking? What if we arrive after midnight? | "Parking is behind the building. Should anything come up, message your host." [R1,R2] | Parking is behind the building. | R1✓ R2○ | send / W | hold |
| EN2 | What time is checkout? | "Checkout is at 11:00. Feel free to message your host." [R1] | Checkout is at 11:00. | R1✓ | send | hold |
| EN3 | Is there a sauna? Checkout time? | "Checkout is at 11:00. For the sauna, please message your host." [R1,R2] | Checkout is at 11:00. | sauna○, checkout✓ | send / W | hold |
| DE1 | Gibt es einen Parkplatz? Was ist, wenn wir nach Mitternacht ankommen? | "Der Parkplatz ist hinter dem Gebäude. Bei Problemen schreiben Sie bitte Ihrem Gastgeber." | Der Parkplatz ist hinter dem Gebäude. | R1✓ R2○ | send / W | hold |
| FR1 | Y a-t-il un parking ? Et si nous arrivons après minuit ? | "Le parking est derrière l'immeuble. En cas de problème, écrivez à votre hôte." | Le parking est derrière l'immeuble. | R1✓ R2○ | send / W | LEAK |
| FR2 | À quelle heure est le départ ? | "Le départ est à 11h. N'hésitez pas à contacter votre hôte si besoin." | Le départ est à 11h. | ✓ | send | hold |
| ES1 | ¿Hay aparcamiento? ¿Y si llegamos después de medianoche? | "El aparcamiento está detrás del edificio. Llame a su anfitrión si llegan tarde." | El aparcamiento está detrás del edificio. | R1✓ R2○ | send / W | LEAK (confirm it fails) |
| ES2 | ¿Dónde está la basura? | "Los contenedores están en la entrada. Si tiene algún problema, escriba a su anfitrión." | Los contenedores están en la entrada. | ✓ | send | already passes (regression pin) |
| RU1 | Есть парковка? А если мы приедем после полуночи? | "Парковка за домом. Если что-то случится, напишите хозяину." | Парковка за домом. | R1✓ R2○ | send / W | hold |
| RU2 | Во сколько выезд? | "Выезд в 11:00. Позвоните хозяину, если опоздаете." | Выезд в 11:00. | ✓ | send | LEAK |
| AR1 | هل يوجد موقف سيارات؟ | "الموقف خلف المبنى. إذا حدثت أي مشكلة، راسل المضيف." | الموقف خلف المبنى. | ✓ | send | LEAK |

**C2 – GD5 (cut a clause, send the information), one request ("Where are the towels?" in each language)**

| # | Model reply | Guest receives | Today |
|---|---|---|---|
| G-TR | Havlular yatak odasındaki dolapta, bir sorun olursa ev sahibinize yazın. | Havlular yatak odasındaki dolapta. | hold |
| G-EN | Towels are in the wardrobe; if anything breaks, contact your host. | Towels are in the wardrobe. | hold |
| G-DE | Die Handtücher sind im Schrank; falls etwas fehlt, rufen Sie Ihren Gastgeber an. | Die Handtücher sind im Schrank. | LEAK |
| G-FR | Les serviettes sont dans l'armoire ; en cas de problème, écrivez à votre hôte. | Les serviettes sont dans l'armoire. | LEAK |
| G-ES | Las toallas están en el armario; si falta algo, escriba a su anfitrión. | Las toallas están en el armario. | hold |
| G-RU | Полотенца в шкафу; если что-то понадобится, напишите хозяину. | Полотенца в шкафу. | hold |
| G-AR | المناشف في الخزانة، إذا حدثت أي مشكلة، راسل المضيف. | المناشف في الخزانة. | LEAK |

In all seven: request answered, gate sends, no e-mail.

**C3 – Promise guard and over-application checks**
- **PG1.** Guest: "Klimanın kumandası nerede?" Reply: "Bir sorun olursa ev sahibinize yazın, kendisi teknisyen gönderir. Kumanda komodinin üstünde." → guest gets "Kumanda komodinin üstünde."; the request is ◐ (topical removal); W.
- **PG2.** Same in English: "If anything breaks, message your host and they will fix it right away." → the whole sentence is dropped; "They will fix…" is never sent.
- **The filler leaves these alone** (behaviour unchanged):
  - N1: "Ev sahibiniz yarın 10:00'da havlu getirecek." (K10 handles it, as today)
  - N2: "Gaz kokusu alırsanız 187'yi arayın."
  - N3: "Ev sahibinize sormanıza gerek yok, şifre kartın arkasında."
  - N4: a referral that includes a contact value
  - N5: "Yazın havuz 22:00'ye kadar açık."
  - N6: "Çıkışta anahtarı kutuya bırakıp bize mesaj atın." (F3)
  - N7: "I'll check with the host."
- **Safety-word cases:**
  - SW1: "If the Fire TV stops working, call your host." → removed; nothing left → hold `reply_host_contact_only`, request ○, W. Today it is kept and sent.
  - SW2: "If you smell gas, close the valve, open the windows and call 187 and your host." → kept.
  - SW3: "Gaz kokusu alırsanız … ev sahibinize yazın." → removed ("write" is never kept).

**C4 – The "answered" rule (settle step)**

| # | Case | Expected | Today |
|---|---|---|---|
| I1 (B2 bug) | "Wi-Fi şifresi ne? Wi-Fi bozulursa ne yapmalıyım?" → "Wi-Fi şifresi Lale1234. Bir sorun olursa ev sahibinize yazın." [R1,R2] | sends "Wi-Fi şifresi Lale1234."; R1✓ R2○; W | silently closes R2 |
| I2 | "Giriş saati kaç? Kapıyı nasıl açacağız?" → "Giriş 15:00'te. Varınca ev sahibinizi arayın." | "Giriş 15:00'te."; R1✓ R2○; W | R2 silently closed |
| I3 (over-open check) | "Havlu nerede? Otopark var mı?" → "Havlular dolapta. Otopark binanın arkasında. Bir sorun olursa ev sahibinize yazın." | both ✓, no e-mail | already passes; kills the "generic shortcut" mutant |
| I4 | "Klima nasıl açılır? Otopark var mı?" → "Otopark arkada. Kombi için ev sahibinize yazın." | "Otopark arkada."; otopark ◐, klima ○; W | — |
| I5 | "Wi-Fi bozulursa ne yapmalıyım?" → "Wi-Fi bozulursa ev sahibinize yazın." | nothing sent; hold `reply_host_contact_only`; R1○; W | hold, no e-mail |
| I6 | A senior-rewrite retry contains the banned sentence | removals come from `retried`; request opens | — |
| I7 | Appendix removal: "Havlular dolapta, internet giderse ev sahibinize yazın." [towels, "İnternet giderse?"] | towels ✓, internet ○ | judge 1, flaw D1-a |

**C5 – Other paths**
- **Parts mode:**
  - P1: parts R1 "Havlular dolapta." and R2 "Wi-Fi bozulursa ev sahibinize yazın." → "Havlular dolapta."; R2 becomes `no_info`; W.
  - P2: part R2 "Modemi yeniden başlatın. Düzelmezse yeniden yazın; o mesaj da kaydedilir." → "Modemi yeniden başlatın."; R2 ◐ (contingency); W.
- **Channel without items:**
  - NI1: the TR1 shape with understanding missing → hold `reply_host_contact_only` + W. The held reason is not relabelled.
  - NI2: "Havlu nerede?" + generic closing, understanding covers the request → stripped reply is sent.
- **QR:**
  - Q1: TR1 shape → guest sees "Otopark binanın arkasında."; RiskEvent `host_contact_open`, urgent, `human_review`.
  - Q2: G-TR → stripped reply sent, no escalation.
  - Q3: I5 shape → escalate `reply_host_contact_only`, nothing sent (unchanged).
- **AI öner:** A1: I1 shape → the draft lacks the sentence and `hostContactNotice.maybeUnanswered` is true.
- **Backstop:** BS1: a result whose final reply was changed after the filler and contains "message your host" → hold `reply_host_contact_only`.
- **Kill switch:** KS1: with `AI_HOST_CONTACT_PARTIAL_DISABLED=1`, TR1 is held whole + W.

**C6 – Lost key**

| # | Guest | Expected | Today |
|---|---|---|---|
| L1 | anahtari kaybetim iceri giremiyoz napcaz | `access_security`, held, urgent, A | no label |
| L2 | lost key / keys are lost | same | no label |
| L3 | Eve giremiyoruz / We can't get into the apartment | `access_security`, urgent, A | no label |
| L4 (over-apply check) | İçeri giremiyor muyuz erken? | no new `access_security` | — |
| L5 | Anahtarı nereden alacağız? | `checkin`, answered (`golden-scenarios.test.ts:511`) | — |
| L6 | Anahtar kaybolursa ne olur? | not lost-key | — |
| L7 | `classifyFallback("Anahtarı kaybettim")` | `general` / `urgent` | `checkin` / `standard` |
| L8 | J'ai perdu la cle / Perdi la llave | access (stashed fold) | — |
| L9 | "I lost my key. What's the Wi-Fi password?" | key item held + urgent; Wi-Fi answered | regression pin |

**C7 – Prompt**
- PR1: every layer combination gives `missing=[]`.
- PR2: with `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=1`, the prompt hash equals today's prompt.
- PR3: with the flag on, the ban bullet is present; the :362 and :508 texts are gone; the items-block and parts lines are present only in their modes.
- PR4: the anchors do not collide.

**C8 – Situation field (flag)**
- Flag off: schema, prompt and cache key are byte-identical (`.toBe`).
- Unknown value → `unclear`.
- The parse-option condition includes `sit`.
- `access_keys` + `ongoing` → `access_security`; `hypothetical` → no label.
- Call keep (B-TR5): guest "Anahtarı kaybedersem ne yapmalıyım?", knowledge base "…ev sahibini arayın", reply "Anahtarı kaybederseniz ev sahibinizi arayın."
  - flag off → hold, request ○, W;
  - flag on + hypothetical → sent, ✓;
  - flag on + ongoing → hold.

**C9 – Cost and mutation**
- Cost pins: detector and filler with 4k–50k character single word, whitespace run and repeated stem.
- Each of these mutants must turn a test red:
  - remove owner attribution → I1/I2/EN3;
  - remove "unattributed opens all" → I4;
  - remove coverage → I2/I7;
  - add a generic shortcut → TR1;
  - restore the suffix-based keep → B-TR5/SW1;
  - remove the lookaheads → SW1;
  - remove "drop everything after the condition" → PG1/PG2;
  - remove the `hostContactNotify` addition → I5/NI1;
  - remove the carry in `mergeSeniorRewrite` → I6;
  - remove the multilingual detector → FR1/AR1/TR2;
  - remove the backstop → BS1;
  - remove the typo list → L1/L2.

---

## (D) Prompt lines (exact text)

**D1 – Main prompt, inserted after `prompts.ts:425` ("…yanıtla ve dur.")** (layer `hostContactBan`, on by default)
```
  - EV SAHİBİNE YÖNLENDİRME CÜMLESİ YAZMA: misafir bu sohbette zaten ev sahibiyle yazışıyor ve sen ev sahibi adına
    yazıyorsun. Misafire ev sahibine yazmasını, mesaj atmasını, ulaşmasını, haber vermesini, iletişime geçmesini ya da
    ona sormasını söyleyen cümleyi HİÇBİR dilde, HİÇBİR biçimde yazma — koşullu ("Herhangi bir sorunda ev sahibinize
    yazın", "Should anything go wrong, message your host"), koşulsuz ("Feel free to message your host", "… için ev
    sahibinize yazabilirsiniz"), kapanış ya da yan cümle olarak da; "bir sıkıntı olursa bize yazın" da aynı. Ev sahibini
    ARAMASINI da yazma; tek istisna: misafir TAM o durumu sordu ("Anahtarı kaybedersem ne yapmalıyım?") ve bilgi tabanı
    o durumda aramayı söylüyor. Gaz, yangın, duman, acil numara gibi güvenlik uyarıları aynen kalır. Bir sorunun bilgisi
    yoksa yukarıdaki "bilgi yok" kuralı geçerli; boşluğu yönlendirme cümlesiyle doldurma.
      YANLIŞ: "Havlular dolapta. Bir sorun olursa ev sahibinize yazın."   DOĞRU: "Havlular dolapta."
```
English meaning: "Do not write sentences that send the guest to the host. The guest is already chatting with the host here, and you write as the host. In no language and no form (conditional, unconditional, closing or sub-clause; 'message us if anything comes up' included) tell the guest to write to, message, contact, inform or ask the host. Do not tell them to call the host either, except when the guest asked exactly that situation and the knowledge base says to call. Safety warnings stay. If information is missing, the existing no-information rule applies; do not fill the gap with a referral."

**D2 – `prompts.ts:361-362`.** Replace "…bilgi yoksa nazikçe alternatif öner ve ev sahibine yönlendir." with "…bilgi yoksa nazikçe alternatif öner; misafiri ev sahibine yönlendiren cümle yazma."

**D3 – `prompts.ts:508`.** The example becomes `      DOĞRU (b): "Şunu dener misiniz: ..."`

**D4 – Items block, inside the `KURALLAR:` text at `reply-block.ts:100-103`** (items mode and the ban flag only):
`Bir isteğe verebileceğin tek cevap misafiri ev sahibine yazmaya / ulaşmaya / aramaya yönlendirmek olacaksa o isteği CEVAPLAMA ve answeredRequests'e KOYMA (istek ev sahibinde açık kalır).`
English meaning: "If your only possible answer to a request would be to send the guest to write to, contact or call the host, do not answer it and do not list it; it stays open for the host."

**D5 – Parts addendum at `prompts.ts:1365`:**
`'  - status "no_info": bilgi yoksa, emin değilsen ya da bilginin o istek için tek söylediği "ev sahibine yazın / ulaşın / arayın" ise — text ve evidence BOŞ; o istek için reply\'da da "bilgim yok / ev sahibine\n'`
The next line is unchanged.

**D6 – Understanding addendum** (flag `AI_UNDERSTANDING_SITUATION_ENABLED`, English like the rest of that prompt; keep these examples out of every eval set):
```
SITUATION (additional field for every request):
- situation: what the guest is doing with THIS request. Judge by meaning in context, never by a single suffix or word; messages may have typos, no or wrong punctuation, missing words or diacritics, slang, voice dictation or mixed languages.
  ongoing = reports something happening now or still the case (a problem, a loss, being locked out, a key or card that is lost / missing / not working, something broken, a danger, a complaint), also when they ask what to do about it.
  hypothetical = asks what to do or what would happen IF something occurred; nothing has happened.
  past = happened earlier and is over; nothing needs fixing now.
  action_request = asks the host to do, bring, send, arrange, allow or change something (including asking permission).
  info = a plain question about information, with no event and no action asked.
  unclear = you cannot tell.
- A lost / missing / stolen key, key card or remote, being locked out, or a key code that does not work right now is intent access_keys with situation ongoing (add complaint_issue if something is broken).
```

**Not changed:** `prompts.ts:1709` (QR door code, F2) and `absence-judge.ts:83-84` (measure first).

---

## (E) What stays flagged or unmeasured, and how to measure when credit returns

| Item | State | Measurement | Gate to enable |
|---|---|---|---|
| Prompt ban (D1–D5) | ON by default, unmeasured; off switch `AI_HOST_CONTACT_PROMPT_BAN_DISABLED` | End-to-end dev set, switch on vs off: banned-sentence rate in raw output before the filler, answered rate, hold rate, over-open; about $2 | Required before Railway opens: 0 banned sentences reach the guest, answered rate not lower by more than 2 points |
| `situation` field | OFF | About 150 labelled requests in TR/EN/DE/FR/ES/RU/AR, with minimal pairs (kaybettim/kaybedersem, si/sí, wenn as "when", ise, -sa as a wish, "of course") × perturbations P1–P11; about $3 | ongoing recall ≥0.98 on access and hazard topics; hypothetical precision ≥0.95 (the only loosening consumer); unclear ≤10%; at least 90% of meaning-flipping perturbations caught |
| Reader (new call) | NOT BUILT (F5) | About 150 replies labelled per sentence | Banned-sentence recall ≥0.99, information wrongly removed ≤1%, attribution ≥0.9, p95 latency |
| Over-open from the code ban | No flag | Free tonight: S13 replay over `docs/olcum/*.json` | Report to the founder; if over-open exceeds 5% of turns, review the generic word list |
| Directive 4 leftovers (A14) | Unchanged | Free replay counts, then before/after examples to the founder | Founder approval |
| `absence-judge.ts:83-84` contradiction | Unchanged | Paid run of that reader with the ban on | — |

Hard limits for every run: unsafe flips 0, false "answered" 0, banned sentences reaching the guest 0. Order to enable: prompt ban (already on) → situation field → reader.

**Directive 8 (robustness to bad punctuation and typos):**
- **Word nets were measured** (stash, no model, 40 base messages in 7 languages):
  - Commas, punctuation and case: 100% unchanged (P1, P3, P4).
  - Typos: P5 unchanged in 68%; P11 (combined) in 65%.
  - Lost-key and fire messages with typos are missed in every language.
  - Conclusion: word nets are only a seat belt; meaning has to come from the model.
- **The model itself has never been measured** on clean/noisy pairs. Incidental evidence only: emergency probe 70/70 without punctuation; informal register 16/17; red-team slang 1/2, noise 3/5.
- **Plan:** `evals/robustness` × P1–P11 × 7 languages. Understanding arm about $3, end-to-end subset about $2, plus the dev set about $5. Targets: unchanged ≥95% for P1–P4 and ≥90% for P5–P9; 0 unsafe flips. Every paid run needs the founder's approval.

---

## (F) Morning questions for the founder

1. **"Arayın" until measurement (temporary).**
   - Önce: "Anahtarı kaybedersem ne yapmalıyım?" → "Anahtarı kaybederseniz ev sahibinizi arayın." gider.
   - Sonra (model sinyali ölçülene kadar): misafire bir şey gitmez, soru size açık iş + "Misafir cevabınızı bekliyor" e-postası. Ölçüm sonrası model "varsayım" derse yine gider.
   - Bu geçici gerileme uygun mu?
2. **QR kapı kodu satırı.** QR'da misafir sizin sohbetinizde değil.
   - Önce: "Kapı kodu ne?" → "Kapı kodu için ev sahibinize Airbnb üzerinden yazın."
   - (a) Bu da silinsin: misafir bir şey almaz, soru size acil devredilir.
   - (b) QR'a özel istisna olarak kalsın.
3. **"Bize mesaj atın" adım talimatı.**
   - Önce/bugün: "Çıkışta anahtarı kutuya bırakıp bize mesaj atın." gider.
   - (a) Böyle kalsın (eylem adımı).
   - (b) "Çıkışta anahtarı kutuya bırakın." (mesaj kısmı silinir).
4. **Ev sahibinin göreceği metinler.**
   - AI öner uyarısı önerisi: "Bu taslaktan misafiri size yönlendiren bir cümle çıkarıldı; misafirin bir sorusu cevapsız kalmış olabilir."
   - Yalnız yönlendirme varsa: "Bu taslak misafiri yalnız size yönlendiriyordu; bu soruyu kendiniz cevaplayın."
   - Ayrıca: taslağı gönderdiğinizde atlanmış soru da "Yanıtladınız" görünüyor. "Siz yazdınız" diye mi değişsin, yoksa soru bazında takip mi (veritabanı değişikliği)?
5. **İkinci model okuması (yeni çağrı).** Her aday cevabı cümle cümle "ev sahibine yönlendiriyor mu, hangi soruyu cevaplıyor" diye okur. Kelime listesinin kaçırdığı yazımları yakalar; maliyeti aday cevap başına bir çağrı. Kurulsun mu (anahtar kapalı)?
6. **Kayıp anahtarın paneldeki etiketi.** Bugün "Giriş" görünüyor, bu plan "Genel" + Acil yapıyor. "Ev sahibiyle görüşme" seçilmedi, çünkü onun yedek metni ("Talebinizi ev sahibimize ilettim") yasak. Ayrı "Erişim / kayıp anahtar" etiketi ister misiniz?
7. **Ücretli ölçüm onayı.** Kredi gelince yaklaşık 10 $ (istem kolu + anlama kolu + sağlamlık). Açılıştan önce şart.
8. Listede zaten bekleyenler (hatırlatma): gelen kutusu önceliğe göre mi sıralansın; "Kayıp anahtar ücreti ne?" sorusu cevaplansın mı (GD4-b)?

---

## (G) Ev sahibi ne zaman e-posta alır, ne zaman yalnız panelde görür

| Ne oldu | E-posta | Panelde |
|---|---|---|
| Misafir şikâyet, iade, tehlike (yangın / gaz / su), **kayıp anahtar / kilitli kaldım** yazdı | Evet, hemen ("Acil misafir mesajı"). Otomatik cevap kapalı olsa da gelir; konuşma başına bir | Kırmızı Acil işareti, "Dikkat Gerektirenler"in en üstü |
| Yapay zekâ cevabı riskli bulup tuttu | Evet (otomatik cevap açık, mesai içi, Premium) | Sorunlu |
| Olası tehlike var ama anlama katmanı çalışamadı | Evet, işletme başına saatte en çok 3 | Acil |
| Birden çok sorudan biri hassas olduğu için size kaldı (ödeme, şikâyet…) | Evet, mesaj başına bir | "N açık iş" |
| Cevap gitti ama bir soru cevapsız kaldı (**yeni:** "ev sahibinize yazın" cümlesi silinip soru açık kaldıysa da) | Evet, "Misafir cevabınızı bekliyor"; mesaj başına bir, aynı soru için bir yıl tekrar yok | Kartta "Açık", "N açık iş" |
| **Yeni:** cevap yalnız "ev sahibinize yazın" olduğu için hiçbir şey gitmedi | Evet, "Misafir cevabınızı bekliyor" (bugün e-posta yok, yalnız panel) | Açık iş |
| Karar kartı (erken giriş, uzatma) | Anahtar kapalı; açılınca "Karar bekliyor" | Karar rozeti |
| QR sohbetinde size devredilen mesaj (**yeni:** cevabın bir kısmı gitti, bir soru size kaldı) | Yalnız QR e-posta anahtarı açıksa; acil ve kayıp anahtar beklemesiz | Acil işareti |
| Elle açtığınız konuşmada şikâyet | Evet | Sorunlu |
| 6 saattir cevapsız mesaj, ayrılış yaklaşırken cevapsız, bağlantı sorunu, gönderilemeyen mesaj, söz gecikmesi, "AI'yı nereden biliyorsun" sorusu | Hayır | Yalnız panel |

- **Alıcı:** işletmenin uyarı adresi; yoksa en eski hesap sahibi. Personel ve operatör asla.
- **Sıralama:** gelen kutusu bugün öncelik değil son mesaj zamanına göre sıralı.
- **WhatsApp:** bugün WhatsApp / SMS gönderen kod yok. En önemli bildirimlerin ileride WhatsApp'tan gitmesi notu `docs/claude/acik-isler.md`'de; önce soru + tasarım.