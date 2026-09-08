import { createHash, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { daysUntilDate } from "@/lib/utils";
import { orgTimezone } from "@/lib/timezone";
import { premiumAllowed } from "@/lib/billing/subscription";
import { loadErasureGuard } from "@/lib/erasure";
import { ANON_NAME } from "@/lib/data-retention";
import { isUniqueViolation } from "@/lib/db-errors";
import { qrPinEnabled } from "@/lib/guest-chat-pin";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { foldTurkishLower, foldTurkishAscii, classifyFallback, isClosingAck } from "@/lib/ai/fallback";
import {
  LEGACY_AI_RESUME_SENDER,
  LEGACY_AI_SENDER_NAMES,
  resolveMessageAuthor,
  SYSTEM_EVENT_GUEST_CHAT_AI_RESUMED,
} from "@/lib/message-author";

// ---------------------------------------------------------------------------
// Guest QR concierge — token resolution (FOUNDATION, no public surface yet).
//
// A guest in the apartment scans a fixed QR that carries an unguessable
// per-apartment token; this resolves that token to the apartment, its
// (secret-free) knowledge base, and the currently-staying reservation so the
// existing AI pipeline can answer general questions.
//
// SAFETY — a fixed, physically-posted QR is a BEARER credential: anyone who
// scans or photographs it (a past guest, a cleaner, a neighbour) holds it. So
// access SECRETS (door/keybox code, Wi-Fi password) are excluded from the chat
// context ENTIRELY — not merely "the model is told to decline" — so even a
// perfect prompt-injection has nothing to leak. Those secrets stay in the
// Airbnb-native check-in flow, delivered to the verified booked guest.
// ---------------------------------------------------------------------------

// KB categories whose content can carry access secrets. Excluded from the
// public QR context. (Matches the KnowledgeBaseItem category vocabulary.)
export const QR_SECRET_CATEGORIES = ["wifi", "checkin"] as const;

// ---------------------------------------------------------------------------
// HOST HANDOFF state. When a human host replies in a QR thread the AI hands off; it
// stays paused until the host EXPLICITLY re-enables it from the panel — never on a
// timer (the host may have stepped into a sensitive matter the AI would misread
// hours later). Both the state AND the visible transitions live in the message
// timeline, keyed off the RELIABLE `authorType` (migration 28), NEVER the message
// text or the host-controlled senderName:
//   • a host reply    → authorType "host"   (a real message; this IS the pause event)
//   • a resume event  → authorType "system", systemEventType guest_chat_ai_resumed
// The bot's own replies are authorType "ai" and are NOT handoff markers.
// ---------------------------------------------------------------------------

// The resume event's DISPLAY senderName (audit only). State is decided by authorType,
// not this string; kept so pre-migration rows still render/read correctly.
export const AI_RESUME_MARKER = LEGACY_AI_RESUME_SENDER;

/**
 * Is the QR AI currently PAUSED for this thread? True when the most recent handoff
 * event is a host reply not yet followed by a system resume event. Keys off the
 * reliable authorType (falls back to the legacy derivation for any pre-migration /
 * old-deployment row). Pure — rows ordered oldest→newest; only the latest transition
 * decides, so any number of takeover/resume cycles resolves deterministically.
 */
export function guestChatAiPausedFromMessages(
  messages: { direction: string; senderName: string; authorType?: string | null; systemEventType?: string | null }[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const { authorType, systemEventType } = resolveMessageAuthor(messages[i]);
    if (authorType === "guest" || authorType === "ai") continue; // not handoff markers
    if (authorType === "system") {
      // Only the "AI re-enabled" event flips it back on; other system events are neutral.
      if (systemEventType === SYSTEM_EVENT_GUEST_CHAT_AI_RESUMED) return false;
      continue;
    }
    return true; // host reply → paused
  }
  return false; // no host activity at all → AI active
}

// ---------------------------------------------------------------------------
// Per-thread advisory lock (Codex 07-24 #4). The host-handoff contract is "the
// AI must never talk over the host", but the guest route's send-time re-check
// and its message insert were two separate statements — a host reply committing
// between them still let the AI reply land BEHIND the host's message. Both
// writers (the guest route's recheck+insert transaction and the host reply
// route's insert transaction) now serialize on this per-conversation
// pg_advisory_xact_lock, so whichever commits first is visible to the other:
// host first → the in-tx recheck sees it and vetoes the AI reply; AI first →
// the host reply simply lands after it (honest ordering, no talk-over).
// ---------------------------------------------------------------------------

/** A client the lock/record helpers can run on — the global client or a tx. */
export type GuestChatDb = Prisma.TransactionClient | typeof prisma;

// Namespace disjoint from erasure (40) and feed-reconcile (23).
const GUEST_CHAT_LOCK_NS = 41;

/**
 * Acquire the per-conversation guest-chat advisory lock on THIS transaction
 * (auto-released at commit/rollback). $executeRaw, not $queryRaw:
 * pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize.
 */
export async function acquireGuestChatThreadLock(
  tx: Prisma.TransactionClient,
  conversationId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${GUEST_CHAT_LOCK_NS}::int4, hashtext(${conversationId}))`,
  );
}

/**
 * TEST-ONLY seam: widens the window between the canonical read and the create
 * in `ensureGuestChatConversation`, so the race branches can be exercised
 * deterministically. Null in production.
 */
export const __guestChatHooks: { afterCanonicalRead: null | (() => Promise<void>) } = {
  afterCanonicalRead: null,
};

/** QR marker prefix — the preflight/dedupe tooling classifies rows off this. */
export const QR_CONVERSATION_MARKER_PREFIX = "qr-chat:";

/**
 * The single QR conversation for one stay, created on first scan.
 *
 * IDENTITY: `(propertyId, "qr-chat:{propertyId}:{reservationId}")`. That key is
 * derived purely from ids we already hold, so two concurrent first-scans of the
 * same stay compute the SAME key and the SAME deterministic primary key —
 * a duplicate is therefore a lost race, never a second legitimate thread.
 *
 * WHY TWO ACCEPTED P2002 TARGETS (2026-07-26): the row is protected by the
 * deterministic PK today, and additionally by the planned composite
 * `@@unique([propertyId, externalReservationId])`. A racing insert violates
 * BOTH at once, and PostgreSQL does not guarantee WHICH index it reports. So
 * both targets are treated as "expected race"; every OTHER P2002 rethrows —
 * a foreign unique violation must never be swallowed here.
 *
 * On the composite target the winner's id is NOT assumed: the row is re-read
 * from the identity key. Missing, or carrying an id other than the
 * deterministic one, means our identity model is wrong — fail closed and let
 * the caller surface it rather than hand back an id that may not exist.
 *
 * (Historical note: an earlier comment claimed several genuine threads per
 * reservation were legitimate. The 2026-07-26 production preflight measured
 * the opposite — all seven conflicting groups carried the SAME provider
 * `externalConversationId` — so the duplicates were our own race, not a
 * provider shape. Scoped to what was measured: on the API surface this app
 * uses, one stay maps to one thread.)
 */
export async function ensureGuestChatConversation(
  propertyId: string,
  reservation: { id: string; guestName: string },
  db: GuestChatDb = prisma,
): Promise<string> {
  const marker = `${QR_CONVERSATION_MARKER_PREFIX}${propertyId}:${reservation.id}`;
  const existing = await db.conversation.findFirst({
    where: { propertyId, externalReservationId: marker },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (__guestChatHooks.afterCanonicalRead) await __guestChatHooks.afterCanonicalRead();

  const qrConversationId = `qrconv_${reservation.id}`;
  try {
    const created = await db.conversation.create({
      data: {
        id: qrConversationId,
        propertyId,
        channel: "chat",
        guestIdentifier: reservation.guestName,
        status: "answered",
        priority: "standard",
        lastMessageAt: new Date(),
        reservationId: reservation.id,
        externalReservationId: marker,
        ingestedAt: new Date(), // V0.4 provenance: misafir ingress'i açtı; iç thread → connectionId yok
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // PK reported → a row with exactly this id exists; that IS the canonical row.
    if (isUniqueViolation(err, ["id"])) return qrConversationId;
    if (!isUniqueViolation(err, ["propertyId", "externalReservationId"])) throw err;

    // Composite reported → re-read from the identity key, never assume the id.
    const winner = await db.conversation.findFirst({
      where: { propertyId, externalReservationId: marker },
      select: { id: true },
    });
    if (!winner) {
      throw new Error("QR konusma kimlik catismasi: kazanan satir bulunamadi");
    }
    if (winner.id !== qrConversationId) {
      throw new Error("QR konusma kimlik catismasi: beklenmeyen satir kimligi");
    }
    return winner.id;
  }
}

// CONTENT-level guard (belt to the category suspenders). The category filter
// alone "fails open" if a host files a door/keybox code or Wi-Fi password under
// faq/rules/general/etc. — so ANY KB item whose text looks like an access secret
// is dropped regardless of category. Over-redaction is the SAFE direction here:
// at worst the chat says it can't help (and escalates), never leaks a code.
// (\b avoided around Turkish letters like ş/ı — JS word boundaries are ASCII.)
const SECRET_PATTERNS: RegExp[] = [
  // door / keybox / entry / lock + code word (TR suffixes ok), e.g. "kapı kodu",
  // "anahtar kutusu kodu", "keybox code", "giriş şifresi", "door/lock code".
  /(kap[ıi]|giri[şs]|anahtar\s*kutu|key\s*?box|keybox|door|lock|entry|gate)\w{0,24}[\s:]{0,3}\w{0,6}[\s:]{0,3}(kod|şifre|sifre|parola|code|pin)/i,
  // a code/PIN/password word followed by a value, e.g. "PIN: 5678", "kodu 0000",
  // "şifre HUNTER2", "parola: abc12".
  /(pin|kod|code|şifre|sifre|parola|password|passcode)\w{0,24}\s*[:=#]?\s*([0-9]{3,}|[^\s.\n]{0,64}\d)/i,
  // Wi-Fi / wireless / internet ... password word.
  /(wi-?fi|kablosuz|internet)\w{0,24}[^.\n]{0,40}(şifre|sifre|parola|password|passcode|key)/i,
  // a password/parola label with a colon/equals, e.g. "Şifre: ...", "parola = ...".
  /(şifre|sifre|parola|password|passcode)\w{0,24}\s*[:=]/i,
  // Wi-Fi / network NAME or PASSWORD stated conversationally WITHOUT a secret
  // keyword — e.g. "İnternet ağımız 'NuveEv', bağlanmak için 12345678 girin".
  // The value is quoted or digit-bearing (SSID / password), which the keyword
  // patterns above miss. Over-redaction stays the safe side (escalate, no leak).
  /(wi-?fi|wlan|kablosuz|ssid|internet\s*a[ğg])\w{0,24}[^.\n]{0,40}(["'«][^"'»\n]{2,64}["'»]|[A-Za-z0-9!@#._-]{0,64}\d[A-Za-z0-9!@#._-]{3,64})/i,
  // ⚠️ GİRİŞ İSMİ + BİTİŞİK 4-8 RAKAM — kod kelimesi OLMADAN (denetim 08-07).
  // Yukarıdaki iki kalıp da bir "kod/şifre/pin" KELİMESİ arıyordu; host
  // "Kapı: 4590" ya da "Anahtar kutusu 7788" yazdığında hiçbiri eşleşmiyordu.
  // Kategori elemesi de kurtarmıyor: elle ekleme formunun VARSAYILANI `general`
  // ve `wifi`/`checkin` dışındaki her kategori isteme giriyor.
  //
  // 🚨 BİTİŞİKLİK ŞARTI (`\s*[:=#.\-–—]?\s*`) BU KALIBIN CAN DAMARI — araya
  // "serbest metin" (`[^.\n]{0,20}` gibi) İZNİ VERME. İlk yazımı tam olarak
  // öyleydi ve ÖLÇÜLDÜ: 12 meşru bilgi-tabanı kaleminin 6'sını birden eliyordu —
  // ADRES ("Kapı 3, 34710 Kadıköy" → posta kodu), ACİL TELEFON ("girişindeki
  // güvenlik 0212 555 4433"), check-in telefonu, daire numarası, yıl (2024).
  // ⚠️ Eleme burada "güvenli yön" DEĞİLDİR: `looksLikeSecret` KALEMİN TAMAMINA
  // (`${title}\n${content}`, ↓kb filtresi) uygulanır ve eşleşen kalem KOMPLE
  // düşer — yani misafir "adres ne?" diye sorduğunda AI'ın elinde adres KALMAZ.
  // Bir erişim kodu kelimenin hemen ardındadır; adres/telefon araya metin sokar.
  //
  // 🚨 EŞİK 4 RAKAM, ÜST SINIR 8 — ikisi de BİLİNÇLİ ve ikisi de test-pinli.
  // Alt sınır: "Giriş saati 15:00" ve "Kapı 3. katta" QR'ın ASIL işidir.
  // Üst sınır + `(?!\d)`: 10-11 haneli TR telefonu bitişik yazılsa bile
  // ("Kapıcı 05321112233") 8 haneyi aşar ve eşleşemez.
  //
  // 🚨 `(?![\s\-.]\d)` = TELEFONUN DEVAMI KORUMASI, süs değil. Türk telefonu
  // ÖBEKLİ yazılır ("Kapıcı 0532 111 2233") ve ilk öbek "0532" TAM 4 hanedir,
  // yani üst sınır onu KURTARMAZ. Ayırt edici şey şu: bir erişim kodu sayısal
  // içeriğin SONUDUR, telefon ise daha fazla rakam öbeğiyle DEVAM eder.
  // "kapıcı" (= apartman görevlisi) Türkçe bilgi tabanlarında çok yaygın ve
  // `kap[ıi]\w*` onu da kapsıyor → bu koruma olmadan görevlinin telefonunu
  // taşıyan kalem KOMPLE düşerdi. Ölçüldü: bu satırsız 2/13 yanlış pozitif.
  //
  // ÖLÇÜLDÜ (kalıp yok / serbest-metin / bugünkü): yanlış-pozitif 0 → 6 → 0,
  // yakalanan saldırı 0 → 11 → 13. Yani bugünkü hâl İKİ eksene göre de en iyisi.
  /(kap[ıi]|giri[şs]|anahtar\s*kutu|key\s*?box|keybox|door|lock|entry|gate)\w{0,24}\s*[:=#.\-–—]?\s*\d{4,8}(?!\d)(?![\s\-.]\d)/i,
];

/**
 * ⚠️ ÜÇ KATLAMAYA BİRDEN BAKAR (CLAUDE.md "KATLAMA KURALI", denetim 08-01).
 *
 * Kalıplar `/i` bayrağıyla yazılmış, ama JS'in basit case-folding'i Türkçenin iki
 * harfini ÇEVİRMEZ: `İ`(U+0130) → `i` OLMAZ, `I`(U+0049) → `ı` OLMAZ. Sonuç somut
 * bir delikti: cümle "İnternet ağımız 'NuveEv', bağlanmak için 12345678 girin"
 * diye başlıyorsa hiçbir kalıp eşleşmiyordu — yani Türkçede en doğal yazımıyla
 * bir Wi-Fi şifresi, sır sayılmadan QR bağlamına girebiliyordu.
 *
 * Bu detektör KISITLAYICIDIR: yalnız içerik ELER, hiçbir izin genişletmez.
 * Kural gereği katlama tam olarak burada uygulanır (nezaket/beyaz-liste
 * kontrollerinde ASLA). Kalıplar Türkçe sözcüklerin ASCII karşılıklarını
 * (`sifre`, `sifre|parola`) zaten içerdiği için ASCII katlaması eşleşmeyi
 * bozmaz, yalnız EKLER.
 */
/**
 * Sır taramasının ÜST SINIRI = kabul edilen en uzun kalem. `kbSchema.content`
 * 20.000 + `title` 300 + ayraç; pay bırakıldı. Bu sınırın ÜSTÜ normal girdiyle
 * ULAŞILMAZ — ulaşılıyorsa içerik doğrulayıcıyı atlamıştır ve o hâlde hüküm
 * "doğrulanamadı" = elenir (↓looksLikeSecret). `validators.ts` tavanı büyürse
 * bu sayı da büyütülmeli; küçük kalırsa etkisi yalnız fazladan eleme (güvenli yön).
 */
const SECRET_SCAN_MAX_CHARS = 24_000;

function looksLikeSecret(text: string): boolean {
  // 🚨 İÇERİĞİN TAMAMI TARANIR (Codex F02, P1 — 08-09'daki yarım düzeltmenin
  // KAPANIŞI). Tarihçe: bu fonksiyon önce yalnız İLK 4.000 karakteri tarıyordu
  // (08-07 (2), ReDoS kemeri); 08-09'da "sonda `Kapı kodu: 4590` geçiyor"
  // ölçülünce İKİ UÇ (ilk 4.000 + son 4.000) taranır oldu ve gerekçesi şuydu:
  // "ortaya gömmek için iki uçtan 4.000 dolgu gerekir, o da bütçeye çarpar".
  // ⚠️ O GEREKÇE YANLIŞTI: `kbSchema.content` 20.000 karakter kabul ediyor, yani
  // 18.000 karakterlik TEK bir kalemin ortası (4.000 < ofset < 14.000) sıradan
  // uygulama girdisiyle ulaşılır ve HİÇ taranmıyordu; filtre "temiz" deyince
  // özgün içeriğin TAMAMI modele gidiyordu. Codex 18.019 karakterlik kalemin
  // ortasındaki sentetik kapı koduyla yeniden üretti.
  //
  // Yeni sözleşme: kabul edilen sınıra kadar TAMAMI taranır; sınırı aşan içerik
  // hakkında hüküm VERİLMEZ → fail-closed elenir. "Taramadım ama geçsin" dalı
  // artık yok. ReDoS kemeri bu üst sınırdır: ÖLÇÜLDÜ (24k adversarial girdi ×
  // 6 kalıp × 3 katlama, tekrarlı "kapı"/"şifre"/near-miss rakam dolguları)
  // kalem başına ≪ 50 ms — kalıpların nicelikleri sınırlı (asıl ReDoS düzeltmesi
  // 08-07 (2)'de), yani maliyet doğrusala yakın.
  if (text.length > SECRET_SCAN_MAX_CHARS) return true; // doğrulanamayan → sır say
  const variants = [text, foldTurkishLower(text), foldTurkishAscii(text)];
  return SECRET_PATTERNS.some((re) => variants.some((v) => re.test(v)));
}

/**
 * Ev sahibinin STİL REHBERİNİ halka açık QR yüzeyi için temizle.
 *
 * ⚠️ BU MODÜLÜN DEĞİŞMEZİNİ KORUR (↑dosya başı): "sırlar bağlamdan TAMAMEN
 * çıkarılır — 'modele söyleriz reddeder' DEĞİL; öyle ki kusursuz bir prompt
 * injection'ın bile sızdıracak bir şeyi olmasın."
 *
 * `aiStyleProfile` bu değişmezi deliyordu (denetim, 08-01): rehber, ev sahibinin
 * GEÇMİŞ MİSAFİR CEVAPLARINDAN (40 örneğe kadar) bir modelle damıtılıyor ve o
 * cevaplar rutin olarak Wi-Fi şifresi, kapı kodu ve adres içeriyor. Damıtma
 * isteminde "bunları ASLA koyma" YAZILI — ama bu bir MODEL RİCASI, deterministik
 * bir garanti değil. Rehber QR yoluna olduğu gibi geçiyordu, yani bilgi tabanı
 * için kurulan tüm sır-eleme çabası yan kapıdan atlanabiliyordu.
 *
 * Neden satır satır: rehber madde listesidir. Tamamını atmak üslup eşlemesini
 * (özelliğin tek faydası) yok ederdi; yalnız sır-benzeri SATIRI atmak hem faydayı
 * hem değişmezi korur. Hiçbir temiz satır kalmazsa null döner.
 *
 * Aşırı-eleme GÜVENLİ yöndür: en kötü ihtimalle AI biraz daha jenerik konuşur.
 */
/**
 * Erişim sırrı taşıyan bilgi-tabanı kalemlerini eler.
 *
 * 🚨 İKİ ÇAĞIRAN, TEK KURAL (denetim 08-09). Bu eleme uzun süre YALNIZ QR
 * concierge yolunda vardı. Kanal (Airbnb/Booking) oto-yanıtı bilgi tabanını
 * SÜZMEDEN modele veriyordu ve rezervasyon ÖNCESİ soru soran biri (henüz
 * rezervasyonu yok, `conversation.reservation === null`) için tek koruma
 * prompt'taki bir paragraftı — üstelik önbellekli sistem önekindeki few-shot
 * örneklerin BEŞİ wifi şifresini VEREREK gösteriyor. Prompt talimatı bir MODEL
 * RİCASIDIR; bu fonksiyon deterministiktir.
 *
 * ⚠️ ONAYLI/TAMAMLANMIŞ konaklamada ÇAĞRILMAZ: rezervasyonu olan misafire kapı
 * kodunu vermek ürünün ta kendisidir, kusur değil.
 * ⚠️ ÖLÇÜLDÜ (12 kalemlik gerçekçi bilgi tabanı): düşen 2 — Wi-Fi ve Giriş
 * Talimatı. Adres, acil telefon, otopark, çöp, ev kuralları, çevre, klima,
 * çıkış, ulaşım, check-in saati HEPSİ kalıyor. Yani bedel tam olarak
 * amaçlanan bedel; aday müşteri hâlâ cevap alabiliyor.
 */
export function withoutSecretKbItems<T extends { title: string; content: string }>(
  items: T[],
): T[] {
  return items.filter((k) => !looksLikeSecret(`${k.title}\n${k.content}`));
}

export function scrubStyleProfileForPublic(profile: string | null | undefined): string | null {
  const raw = profile?.trim();
  if (!raw) return null;
  const kept = raw
    .split(/\r?\n/)
    .filter((line) => line.trim() && !looksLikeSecret(line));
  const out = kept.join("\n").trim();
  return out.length > 0 ? out : null;
}

/** Unguessable per-apartment chat token — two UUIDs, ~256-bit (icalToken style). */
export function generateChatToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// ---------------------------------------------------------------------------
// Per-stay device binding (fixes the fixed-physical-QR history leak).
//
// The QR is a FIXED, physically-posted bearer credential, so it cannot tell one
// person from another: a past guest / cleaner who photographed it could scan it
// during the NEXT guest's stay and read that guest's live chat history. The fix
// is first-scan device binding: the FIRST device to open the chat during a stay
// mints a per-stay secret (kept in an httpOnly cookie); only that device sees
// the history / can send. Any other device scanning the same QR that stay gets
// "mismatch" → no history, no send. Rotates automatically — each reservation
// starts unbound, so a secret captured in one stay is useless the next.
// ---------------------------------------------------------------------------

/** Fresh per-stay device secret — two UUIDs, ~256-bit (goes into the cookie). */
export function generateStaySecret(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

function hashStaySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time compare of two equal-length hex digests (defence in depth). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export type StayBinding =
  | { status: "bound"; secret: string } // we just claimed this stay → caller sets the cookie
  | { status: "match" } //                 the presented secret matches the bound device
  | { status: "mismatch" } //              a DIFFERENT device already holds this stay
  | { status: "unclaimed" }; //            unbound AND claiming was withheld (PIN gate: allowClaim=false)

/**
 * Claim-or-verify a stay's chat for the calling device. Unbound → mint a secret
 * and atomically claim the stay (returns it so the route can set the cookie).
 * Already bound → "match" iff the presented cookie secret is the one that claimed
 * it, else "mismatch". The claim is a conditional updateMany (only succeeds while
 * still unbound), so two devices racing the first scan can't both win — mirrors
 * the TOTP-burn / lock-acquire pattern used elsewhere.
 */
export async function bindOrCheckStay(
  reservationId: string,
  presentedSecret: string | null | undefined,
  // REQUIRED (Codex 2): no default. Every callsite must state its intent — a
  // forgotten opts object previously fell through to "claim", so a new caller
  // added on the PIN-required path could have silently bound a stay without a
  // PIN. Making this explicit turns that into a compile error.
  opts: { allowClaim: boolean },
): Promise<StayBinding> {
  const row = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { chatBoundHash: true },
  });
  if (!row) return { status: "mismatch" };

  if (row.chatBoundHash) {
    if (presentedSecret && safeEqualHex(hashStaySecret(presentedSecret), row.chatBoundHash)) {
      return { status: "match" };
    }
    return { status: "mismatch" };
  }

  // Unbound. When claiming is WITHHELD (PIN gate, Faz 5): report "unclaimed" so
  // the caller can require a PIN before anyone binds — WITHOUT this device
  // silently winning the stay just by scanning first. Callers on the old
  // first-scan-wins path pass { allowClaim: true } explicitly.
  if (!opts.allowClaim) return { status: "unclaimed" };

  // Unbound → mint a FRESH secret (rotation: never reuse a previous stay's cookie
  // as this stay's binding) and claim atomically.
  const secret = generateStaySecret();
  const claimed = await prisma.reservation.updateMany({
    where: { id: reservationId, chatBoundHash: null },
    data: { chatBoundHash: hashStaySecret(secret), chatBoundAt: new Date() },
  });
  if (claimed.count === 1) return { status: "bound", secret };

  // Lost the first-scan race: another device bound between our read and write.
  // Re-check the now-set hash against whatever this device holds.
  const now = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { chatBoundHash: true },
  });
  if (now?.chatBoundHash && presentedSecret && safeEqualHex(hashStaySecret(presentedSecret), now.chatBoundHash)) {
    return { status: "match" };
  }
  return { status: "mismatch" };
}

/** "HH:MM" → minutes since midnight (tolerant of a single-digit hour). */
function hhmmToMinutes(s: string): number {
  const m = /(\d{1,2}):(\d{2})/.exec(s ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Current wall-clock time in the ORG's timezone as minutes since midnight. */
function nowMinutesInTz(now: Date, tz: string): number {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return hhmmToMinutes(hhmm);
}

export interface GuestChatContext {
  property: {
    id: string;
    organizationId: string;
    name: string;
    checkInTime: string;
    checkOutTime: string;
    address: string | null;
    city: string | null;
  };
  /** True only during an active stay (arrival day → checkOutTime on departure day,
   *  Istanbul). When false the chat is closed (vacant / before check-in / after
   *  checkout) and answers nothing. */
  open: boolean;
  /** The guest currently in residence, if any. */
  activeReservation: {
    id: string;
    guestName: string;
    arrivalDate: Date;
    departureDate: Date;
    status: string;
  } | null;
  /** Active KB items with secret-bearing categories removed. */
  knowledgeBase: { category: string; title: string; content: string }[];
  /** Adet tavanı yüzünden istemin dışında kalan kalem sayısı (istem bunu modele söyler). */
  knowledgeBaseDropped: number;
  /** True when this stay must present a PIN before it can be claimed on a device
   *  (Faz 5). Derived: QR_PIN_ENABLED env on AND (this reservation has a PIN OR the
   *  org runs strict mode). NEVER exposes the hash — only the boolean gate. */
  pinRequired: boolean;
}

/**
 * Resolve a public chat token to its apartment + secret-free knowledge base +
 * the currently-staying reservation. Returns null when the token is missing,
 * too short, unknown, or the apartment's chat is disabled — so an invalid or
 * switched-off token is indistinguishable from a 404.
 *
 * The token is globally unique, so it resolves to exactly one apartment in one
 * organization; there is no cross-tenant path.
 */
/**
 * ESKALASYON CEVABI — SÖZ, GERÇEĞE UYGUN OLMAK ZORUNDA (denetim 08-01 + Codex 09-08).
 *
 * Metin bir dönem KOŞULSUZ "ev sahibine ilettim" diyordu; 08-01'de bayrağa
 * bağlandı (`QR_ESCALATION_EMAIL_ENABLED` kapalıyken doğru metin). 09-08 canlı
 * turunda BAYRAK AÇIKKEN de yanlış beyan olduğu ölçüldü: e-posta o an
 * gönderilmemiş olabilir ve KOD BUNU BİLMEZ — olay-kimliği dedupe, 5 dk
 * anti-flood cooldown, alıcı yokluğu (org alertEmail + owner boş) ve sağlayıcı
 * hatası dallarının hepsi sessizce `{sent:false}` döner. Üstelik yanıt metni
 * kayıt transaction'ında, e-posta çağrısından ÖNCE yazılır ve
 * `sendQrEscalationAlertBounded` `Promise<void>` döndürür — sonuç hiç okunmaz.
 * Canlı transkriptte dört ardışık devirde dördü de "ilettim" dedi; cooldown
 * yüzünden en fazla biri mail üretmiş olabilir.
 *
 * Bu yüzden metin artık YALNIZ garanti edileni söyler: mesaj kaydedildi ve ev
 * sahibi sohbet ekranından görür (kayıt, yanıtla AYNI transaction'da yazılır).
 * E-posta bir BONUS kanaldır; sözü verilmez.
 *
 * KALAN İŞ (ayrı tur): e-posta gerçekten gönderildiğinde metni zenginleştirmek —
 * alert çağrısının kayıttan ÖNCE koşmasını ve olay kimliğinin mesaj id'sinden
 * bağımsız üretilmesini gerektirir.
 */
// ---------------------------------------------------------------------------
// QR BAĞLAM PENCERESİ (kurucu AI kalite turu, 2026-09-08).
//
// Sınır TUR değil MESAJ cinsindendir — eski `QR_HISTORY_CAP = 12` yaklaşık 6 tur
// taşıyordu ve adı da bunu söylemiyordu. Modelin bağlam penceresi buna kıyasla
// çok geniş; yine de sınırsız geçmiş doğru değil: uzun bağlamda ortadaki bilgi
// silikleşir ve her istek pahalılaşır. Bu yüzden İKİ sınır birlikte uygulanır ve
// hangisi önce dolarsa o keser (en YENİ mesajlar korunur).
export const QR_HISTORY_MESSAGE_CAP = 24; // ≈ 12 tur
export const QR_HISTORY_CHAR_CAP = 8_000;
/** Pencere DIŞINDA açık konu aranırken taranacak en fazla mesaj (maliyet tavanı). */
const QR_TOPIC_SCAN_CAP = 120;

/** Modelin göreceği tek bir geçmiş satırı (yön mesajın KENDİ alanından gelir). */
export interface GuestChatHistoryItem {
  direction: "inbound" | "outbound";
  body: string;
}

export interface GuestChatContextWindow {
  history: GuestChatHistoryItem[];
  /**
   * Pencere DIŞINA taşan, misafirin CEVAPSIZ/KAPANMAMIŞ konularının kapalı-küme
   * kategori kodları (PII YOK — metin taşınmaz). Amaç: uzun sohbette eski bir
   * şikâyet sessizce kaybolmasın. Bu bir DEVİR sebebi DEĞİLDİR; kapı yalnız
   * GÜNCEL mesaja bakar, yani geçmiş şikâyet sonraki bağımsız soruyu engellemez.
   */
  openTopics: string[];
}

/**
 * "Bu konu kapandı" işareti — YALNIZ açık-konu hesabı için, dar ve deterministik.
 *
 * ⚠️ `isClosingAck` BİLEREK genişletilmedi: o, güvenlik tarafında kullanılan bir
 * BEYAZ LİSTEDİR ve deponun kuralı gereği katlama/gevşetme uygulanmaz
 * (CLAUDE.md). Ölçüldü: "buldum teşekkürler" ve "tamam düzeldi" orada `false`
 * dönüyor — kurucunun canlıda gördüğü kapanış cümleleri tam da bunlar. Bu
 * yardımcı yalnız "eski şikâyeti gündemde tutayım mı" sorusunu etkiler; hiçbir
 * devir/oto-gönderim kararına girmez, yani yanılması güvenlik açığı üretmez.
 */
const CLOSURE_WORDS = [
  "teşekkür", "tesekkur", "sağol", "sagol", "thanks", "thank you",
  "buldum", "düzeldi", "duzeldi", "halloldu", "hallettim", "çözüldü", "cozuldu", "tamamdır", "tamamdir",
];
function looksLikeTopicClosure(body: string): boolean {
  if (isClosingAck(body)) return true;
  const text = body.trim();
  if (text.length > 80 || text.includes("?")) return false; // soru = kapanış değil
  const folded = foldTurkishLower(text);
  return CLOSURE_WORDS.some((w) => folded.includes(foldTurkishLower(w)));
}

/** Açık konu olarak taşınabilecek kapalı küme (kategori kodu, serbest metin değil). */
const OPEN_TOPIC_INTENTS = new Set(["complaint", "refund", "early_departure", "human_request"]);

/**
 * Sohbetin modele verilecek penceresini kurar.
 *
 * · KRONOLOJİK; eşit `createdAt` damgalarında `id` kopma noktasıyla DETERMİNİSTİK
 *   (QR yolu misafir+bot satırını tek transaction'da yazar → damgalar eşit olabilir).
 * · Sistem olayları ve gövdesiz satırlar dışarıda.
 * · Güncel mesaj burada YOKTUR: sohbet, misafirin mesajı yazılmadan ÖNCE okunur.
 */
export async function buildGuestChatContextWindow(conversationId: string): Promise<GuestChatContextWindow> {
  const rows = await prisma.message.findMany({
    where: { conversationId, systemEventType: null, NOT: { body: "" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { direction: true, body: true },
    take: QR_TOPIC_SCAN_CAP,
  });
  const chronological = rows.slice().reverse();

  // Pencere: sondan başlayarak hem SAYI hem KARAKTER bütçesine uyan en uzun kuyruk.
  const window: GuestChatHistoryItem[] = [];
  let chars = 0;
  for (let i = chronological.length - 1; i >= 0; i--) {
    const r = chronological[i];
    if (window.length >= QR_HISTORY_MESSAGE_CAP) break;
    if (chars + r.body.length > QR_HISTORY_CHAR_CAP && window.length > 0) break;
    window.unshift({ direction: r.direction === "inbound" ? "inbound" : "outbound", body: r.body });
    chars += r.body.length;
  }

  // ── AÇIK KONULAR: kapanış YALNIZ İLGİLİ konuyu kapatır ────────────────────
  //
  // 🚨 İlk sürüm hatalıydı (kurucu yakaladı): herhangi bir kapanış cümlesi TÜM
  // açık konuları siliyordu. "Klima bozuk → havlu nerede? → teşekkürler"
  // dizisinde teşekkür ARADAKİ soruya aittir; klima şikâyetini kapatmamalı.
  //
  // YAKINLIK KURALI (deterministik, sınıflandırıcısız): sohbet kronolojik
  // taranır; misafirin açtığı her konu bir yığına eklenir, misafirin yazdığı
  // her kapanış cümlesi yığının EN ÜSTÜNDEKİ (en son açılan) konuyu kapatır.
  // Böylece "klima düzeldi, teşekkürler" klimayı kapatır; araya başka bir konu
  // girmişse kapanış onu kapatır ve şikâyet açık kalır.
  // ⚠️ Kapanışın hangi konuya ait olduğunu METİNDEN çıkarmıyoruz: "teşekkürler"
  // konu taşımaz. Yakınlık, elde olan tek dürüst sinyaldir; yanılması hâlinde
  // bedeli yalnız bir bağlam notudur (devir/güvenlik kararına girmez).
  const openStack: { intent: string; index: number }[] = [];
  for (let i = 0; i < chronological.length; i++) {
    const r = chronological[i];
    if (r.direction !== "inbound") continue;
    if (looksLikeTopicClosure(r.body)) {
      openStack.pop();
      continue;
    }
    // ⚠️ YIĞINA MİSAFİRİN HER KONUSU GİRER, yalnız "önemli" olanlar değil.
    // İlk denemede yığın yalnız şikâyet/insan-talebi tutuyordu ve araya giren
    // sıradan bir soru ("havlu nerede?") yer kaplamadığı için sonraki
    // "teşekkürler" yine şikâyeti kapatıyordu (ölçüldü, test kırmızıydı).
    // Kapanışın neye ait olduğunu belirleyen şey, o sırada gündemde olan SON
    // konudur — sıradan sorular da gündemi işgal eder.
    const c = classifyFallback(r.body);
    const intent = c.isComplaint ? "complaint" : c.intent;
    openStack.push({ intent, index: i });
  }
  // Yalnız pencere DIŞINDA açılmış olanlar taşınır: pencere içindekiler zaten
  // geçmişin kendisinde görünüyor, ikinci kez anlatmaya gerek yok.
  const firstWindowIndex = chronological.length - window.length;
  const open = new Set(
    openStack
      .filter((t) => t.index < firstWindowIndex && OPEN_TOPIC_INTENTS.has(t.intent))
      .map((t) => t.intent),
  );
  return { history: window, openTopics: [...open].sort() };
}

export function escalationReply(): string {
  return "Mesajınız kaydedildi; ev sahibiniz sohbet ekranından görüntüleyebilir.";
}

export async function resolveGuestChat(
  token: string,
  now: Date = new Date(),
): Promise<GuestChatContext | null> {
  if (!token || token.length < 16) return null;

  const property = await prisma.property.findFirst({
    where: { chatToken: token },
    select: {
      id: true,
      organizationId: true,
      name: true,
      checkInTime: true,
      checkOutTime: true,
      address: true,
      city: true,
      chatEnabled: true,
      // Org strict-mode toggle (Faz 5): when on, EVERY not-yet-claimed stay needs
      // a PIN. Read here so the PIN gate is computed in one place. timezone: the
      // open-window (check-in/out hour gate) runs on the HOST'S local clock.
      organization: { select: { qrChatPinRequired: true, timezone: true } },
    },
  });
  if (!property || !property.chatEnabled) return null;

  // Tie the QR concierge to premium access, using the SAME gate as every other
  // paid AI surface (inbox reply / ai-suggest / test / translate / hazirlik) so
  // the feature can't be stricter than the rest. When billing is enforced and the
  // org's subscription has lapsed/canceled, the QR stops working (resolves to 404,
  // exactly like a disabled chat). Grandfathered (no subscription — existing
  // customers / founder) and active/trialing orgs are unaffected. DORMANT-SAFE:
  // premiumAllowed is always true while BILLING_ENFORCED is off, so flipping that
  // kill-switch restores the QR alongside everything else (getEntitlement().active
  // would have kept blocking a canceled org even while dormant — the outlier this
  // fixes).
  if (!(await premiumAllowed(property.organizationId))) return null;

  const propertyPublic = {
    id: property.id,
    organizationId: property.organizationId,
    name: property.name,
    checkInTime: property.checkInTime,
    checkOutTime: property.checkOutTime,
    address: property.address,
    city: property.city,
  };

  // OPEN only during an active stay: from the arrival day through the property's
  // checkOutTime on the departure day (Istanbul). Before check-in, after checkout,
  // or while vacant → CLOSED. So a past guest who kept the QR can't keep using it,
  // and it resets for the next guest automatically.
  const candidates = await prisma.reservation.findMany({
    where: {
      propertyId: property.id,
      status: { in: ["confirmed", "completed"] },
      // Wide net; the precise open/closed decision is the Istanbul day/time check.
      arrivalDate: { lte: new Date(now.getTime() + 12 * 60 * 60 * 1000) },
      departureDate: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    // Ascending (earliest arrival first): on a back-to-back turnover day the
    // INCUMBENT stay wins until it checks out, then the next one takes over.
    orderBy: { arrivalDate: "asc" },
    // chatPinHash is selected ONLY to derive the pinRequired boolean below — it is
    // stripped from the returned activeReservation (the hash never leaves this fn).
    // `sourceReference` KVKK tombstone eşleşmesi için (↓DÖRDÜNCÜ INGRESS).
    select: { id: true, guestName: true, arrivalDate: true, departureDate: true, status: true, chatPinHash: true, sourceReference: true },
  });

  // Evaluate EVERY candidate, not just one row: the 12h look-ahead pulls the NEXT
  // guest's reservation into the set before they arrive, so a bare findFirst(desc)
  // would return that not-yet-started row and (a) CLOSE the chat for the guest
  // currently on-site the afternoon before turnover, and (b) on turnover morning
  // serve the on-site guest's thread under the next guest's id (cross-guest PII).
  const tz = orgTimezone(property.organization?.timezone);
  const isOpenNow = (r: { arrivalDate: Date; departureDate: Date }): boolean => {
    const arrDiff = daysUntilDate(r.arrivalDate, now, tz); // 0 = today, >0 future, <0 past
    const depDiff = daysUntilDate(r.departureDate, now, tz);
    // Symmetric HARD gate (org-local clock): on the arrival day the chat only opens
    // once the property's check-in time is reached — not from the day-start. This
    // closes the turnover window (prev guest checked out, next guest not yet checked
    // in) so a cleaner / past guest can't scan the fixed QR and claim the INCOMING
    // stay's chat before the real guest arrives. Trade-off (documented): a host-
    // approved EARLY check-in can't use the QR chat until the official check-in time.
    const afterCheckin =
      arrDiff < 0 ||
      (arrDiff === 0 && nowMinutesInTz(now, tz) >= hhmmToMinutes(property.checkInTime));
    const beforeCheckout =
      depDiff > 0 ||
      (depDiff === 0 && nowMinutesInTz(now, tz) < hhmmToMinutes(property.checkOutTime));
    return afterCheckin && beforeCheckout;
  };
  // ── KVKK AÇIK SİLME KAPISI — DÖRDÜNCÜ INGRESS YOLU (P1 #2, 08-09 (2)) ─────
  //
  // 🚨 `erasure.ts`'in başlık yorumu "every tombstone-scoped ingress writer"
  // deyip ÜÇ yol sayıyordu (hospitable-sync · iCal feed · elle .ics/.csv
  // yüklemesi). QR concierge DÖRDÜNCÜSÜYDÜ ve kapısızdı: `loadErasureGuard`
  // bu dosyada HİÇ geçmiyordu.
  //
  // Senaryo: misafir m.11 silme talebi yapar → `eraseReservationData` satırı
  // maskeler + tombstone yazar → misafir (ya da dairedeki QR'ı tarayan biri)
  // konaklama penceresi hâlâ açıkken QR'ı okutur → `ensureGuestChatConversation`
  // YENİ bir Conversation açar ve `recordGuestChatExchange` YENİ Message satırları
  // yazar. Silinmiş bir konaklama kendi kanalından geri doğar (Yön. m.8
  // "tekrar kullanılamaz" şartının ihlali).
  //
  // İKİ BACAK, çünkü tek başına hiçbiri yetmiyor:
  //   (a) `blocksSourceReference` — ASIL mekanizma, kardeş üç yolla aynı. Ama
  //       `sourceReference` OLMAYAN (elle girilmiş) bir rezervasyonda ölü kalır.
  //   (b) `guestName === ANON_NAME` — maskeleme sentinel'i. `sourceReference`
  //       yoksa da çalışır ve `erasure.ts` ile `data-retention.ts` AYNI sabiti
  //       yazdığı için iki rejimi birden kapsar.
  // ⚠️ `blocksGuestStay` BİLİNÇLİ ÇAĞRILMIYOR: kişi anahtarları e-posta/telefon/
  // sağlayıcı-id ve maskeleme onları ZATEN null'lamış olur → burada ölü kod
  // olurdu (elle yükleme yolunun aynı gerekçesi).
  const erasureGuard = await loadErasureGuard(property.organizationId);
  const notErased = (r: { guestName: string; sourceReference: string | null }) =>
    r.guestName !== ANON_NAME && !erasureGuard.blocksSourceReference(r.sourceReference);

  const activeRow = candidates.filter(notErased).find(isOpenNow) ?? null;
  const open = activeRow !== null;
  // PIN gate (Faz 5): env master switch AND (this stay has a PIN OR org strict mode).
  // Computed from the hash PRESENCE only; the hash itself is never returned.
  const pinRequired =
    open && qrPinEnabled() && (Boolean(activeRow.chatPinHash) || property.organization?.qrChatPinRequired);
  // Strip chatPinHash from the exposed shape.
  const activeReservation: GuestChatContext["activeReservation"] = activeRow
    ? {
        id: activeRow.id,
        guestName: activeRow.guestName,
        arrivalDate: activeRow.arrivalDate,
        departureDate: activeRow.departureDate,
        status: activeRow.status,
      }
    : null;

  // Closed → return the property (so the page can show a branded "no active stay"
  // screen) but no reservation and an empty knowledge base (nothing to answer).
  if (!open) {
    return { property: propertyPublic, open: false, activeReservation: null, knowledgeBase: [], knowledgeBaseDropped: 0, pinRequired: false };
  }

  // QR yolunda hiç tavan YOKTU — 60 aktif kayıtlı bir dairede istem sınırsız
  // büyüyordu. Tek yol `ai/kb-fetch.ts` (tavan + kaç kalemin düştüğü).
  // Gizli kategoriler WHERE'de eleniyor, yani tavan yalnız GÖSTERİLEBİLİR
  // kalemler arasından seçiyor — slot israfı yok ve düşen sayısı da doğru.
  const { items: kbRaw, dropped: kbDropped } = await fetchKnowledgeBaseForPrompt({
    propertyId: property.id,
    isActive: true,
    category: { notIn: [...QR_SECRET_CATEGORIES] },
  });
  // Drop any item whose text looks like an access secret, even in an allowed
  // category — the public bearer-token surface must never have a code in context.
  const knowledgeBase = withoutSecretKbItems(kbRaw);
  // ⚠️ İKİ AYRI ELEME, TEK SAYAÇ OLAMAZ (denetim, 07-31). `fetchKnowledgeBaseForPrompt`
  // yalnız SQL tavanında düşenleri sayar; `looksLikeSecret` KATEGORİYE değil
  // İÇERİĞE baktığı için tavanı geçmiş bir kalemi burada ayrıca eleyebiliyor.
  // Bir süre yalnız SQL sayısı geçiliyordu → istemdeki "N kalem yer sınırı
  // nedeniyle alınamadı, 'bilgi yok' DEME, insana devret" notu eksik sayıyla
  // gidiyor, hiç düşmemiş göründüğünde ise HİÇ gitmiyordu. Yani bu modülün var
  // olma sebebi olan arıza (AI'ın host'un yazdığı konuda emin dille "bilgim yok"
  // demesi) tam da en halka açık yüzeyde açıktı.
  const droppedTotal = kbDropped + (kbRaw.length - knowledgeBase.length);

  return { property: propertyPublic, open: true, activeReservation, knowledgeBase, knowledgeBaseDropped: droppedTotal, pinRequired };
}

/**
 * Birden çok QR sohbeti için "AI duraklatıldı mı" durumunu OTORİTER hesaplar —
 * thread'lerin mesajlarını çekmeden.
 *
 * Neden gerekli: liste ekranı rozeti önce satır başına son N mesajdan türetiyordu.
 * Devir işareti o pencerenin dışında kaldığında (üstüne yalnız misafir mesajı
 * gelmişse) rozet SESSİZCE kaybolabiliyordu. Müşteriye gösterilen bir rozetin
 * "bazen yanlış" olması kabul edilebilir bir taviz değil (Codex).
 *
 * Nasıl kesin: `guestChatAiPausedFromMessages` zaten yalnız EN YENİ "misafir de
 * AI de olmayan" mesaja bakar — host yanıtı ise duraklatılmış, AI-yeniden-etkin
 * işareti ise etkin, hiç yoksa etkin. O tek satır konuşma başına DISTINCT ON ile
 * getirilir: tek sorgu, konuşma başına tek satır, gövde okunmaz.
 *
 * Aday küme = OUTBOUND ve AI olmayan mesajlar. Misafir mesajları inbound olduğu
 * için doğal olarak elenir; eski (authorType NULL) satırlarda AI, senderName ile
 * ayrılır — resolveMessageAuthor ile aynı kural.
 */
export async function guestChatPausedByConversation(
  conversationIds: string[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (conversationIds.length === 0) return out;
  const rows = await prisma.$queryRaw<
    { conversationId: string; direction: string; senderName: string; authorType: string | null; systemEventType: string | null }[]
  >(Prisma.sql`
    SELECT DISTINCT ON ("conversationId")
      "conversationId", "direction", "senderName", "authorType", "systemEventType"
    FROM "Message"
    WHERE "conversationId" IN (${Prisma.join(conversationIds)})
      AND "direction" = 'outbound'
      AND ("authorType" IS NULL OR "authorType" <> 'ai')
      AND NOT ("authorType" IS NULL AND "senderName" IN (${Prisma.join([...LEGACY_AI_SENDER_NAMES])}))
    ORDER BY "conversationId", "createdAt" DESC, "id" DESC
  `);
  for (const r of rows) {
    // Tek satırlık zaman çizelgesi: fonksiyon sondan başa yürüdüğü için bu
    // satırın verdiği cevap, tüm geçmişin vereceği cevapla AYNIDIR.
    out.set(r.conversationId, guestChatAiPausedFromMessages([r]));
  }
  return out; // satırı olmayan konuşma → devir yok → AI etkin (varsayılan false)
}
