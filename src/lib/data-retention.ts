import { markTrialIdentitiesOrphaned } from "@/lib/billing/trial-identity";
import { ANON_ID, ANON_NAME } from "@/lib/anon-sentinels";
import { subMonths, startOfDay } from "date-fns";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ERASABLE_STATUSES } from "@/lib/outbox/state";
import { redactNameInCodeGreetingLine } from "@/lib/ai/code-greeting";
import { nameSource } from "@/lib/name-source";
// G7-a (kurucu kararı 10-13): süpürülen metinlerde ad maskesinden SONRA telefon + e-posta maskesi (yaprak modül).
import { redactContactsFromText } from "@/lib/contact-redact";

// ---------------------------------------------------------------------------
// KVKK / data-retention + erasure.
//
//  * anonymizeOldGuestData — automatic retention sweep. OFF by default; only does
//    work when DATA_RETENTION_MONTHS is set (>0). Once a guest's stay is older than
//    that window, their PERSONAL data (name/phone/email + the guest's own message
//    bodies + the guest-identifier on the thread) is irreversibly scrubbed. We
//    ANONYMIZE rather than hard-delete so occupancy/report history stays intact
//    while the personal data is gone. Batched → the cron chips away, no long lock.
//
//  * deleteAccountData — full account erasure (the host's "delete my account" /
//    KVKK right-to-erasure). Deleting the Organization cascades to users,
//    properties → reservations/conversations/messages/tasks/KB/templates/calendar,
//    automation rules, audit logs, subscription, invoices (all onDelete: Cascade).
//    ChatUsage has no FK relation, so it's cleared explicitly first.
// ---------------------------------------------------------------------------

// Exported so the sync engine can DETECT an already-anonymized row and refuse to
// overwrite the sentinel with fresh channel PII (KVKK resurrection guard).
// Sentinel değerler yaprak modülde (istemci bileşenleri de okur); buradan yeniden dışa verilir.
export { ANON_ID, ANON_NAME };
// Exported for the explicit-erasure executor (src/lib/erasure.ts): it reuses the
// EXACT same scrub sentinels as the retention sweep, so every existing
// resurrection guard / classifier keeps working unchanged on erased threads.
export const ANON_BODY = "[saklama süresi doldu — içerik silindi]";
const ANON_BODY_NAME = "[Misafir]"; // in-body name redaction — keeps the host's record, drops the name
const MIN_NAME_LEN = 3; // skip 2-char names ("Al"/"Su") — too collision-prone

/**
 * Redact a guest's known name(s) from an OUTBOUND body — the host's own record is
 * kept, only the identifying token is removed. Automated greetings use only the
 * FIRST name ("Merhaba Ahmet,"); manual host replies may use the full name, so
 * redact both (longest first). Boundaries are Unicode-aware (JS \b is ASCII-only
 * and breaks on Turkish ç/ğ/ı/ö/ş/ü). Insertion is literal; idempotent.
 */
export function redactNameFromBody(body: string, names: string[]): string {
  const all = Array.from(
    new Set(names.flatMap((n) => { const full = n.trim(); return [full, full.split(/\s+/)[0] ?? ""]; })),
  )
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== ANON_NAME && t !== ANON_ID);
  const tokens = all.filter((t) => t.length >= MIN_NAME_LEN).sort((a, b) => b.length - a.length);
  let out = body;
  for (const t of tokens) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${nameSource(t)}(?![\\p{L}\\p{N}])`, "giu"), ANON_BODY_NAME);
  }
  // 🚨 KISA AD YALNIZ KODUN SELAM SATIRINDAN (kurucu kararı 09-30): 2 harfli adlar ("Su", "Al") gövdede aranmaz — "Su gelmiyor"
  // şikâyeti bozulurdu — ama kodun / karşılama mesajının ilk satırı ("Merhaba Su,") adı kalıcı taşıyordu. O satır tablodaki adlı
  // selamla BİREBİR aynıysa ad gizlenir; başka hiçbir yere dokunulmaz.
  for (const t of all.filter((x) => x.length < MIN_NAME_LEN)) out = redactNameInCodeGreetingLine(out, t, ANON_BODY_NAME);
  return out;
}

/** Ad eşleşme kalıbı — tek kaynak yaprak modül `name-source.ts` (istem ad maskesi de kullanır); eski içe aktaranlar için yeniden dışa. */
export { nameSource };

/**
 * ÜSLUP PROFİLİ DE SÜPÜRÜLÜR (G7-b, kurucu kararı 10-13 "İkisi de"; DENETIM 08-09 #21). `Organization.aiStyleProfile` ev sahibinin son
 * cevaplarından damıtılır; örnek cümlelerde misafir adı / telefon / e-posta geçebilir ve iki süpürgenin de dışındaydı. Süpürülen
 * misafirin adları + metindeki telefon / e-posta, o işletmenin profilinde de maskelenir (sürüm işareti satırı adsızdır, korunur).
 * Koşullu yazma: okuma ile yazma arasında profil yenilendiyse bu tur ona dokunmaz (yeni profil zaten ad maskeli girdiden üretilir).
 */
export async function scrubStyleProfile(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  names: readonly string[],
): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { aiStyleProfile: true } });
  const current = org?.aiStyleProfile;
  if (!current) return false;
  const red = redactNameFromBody(redactContactsFromText(current), [...names]);
  if (red === current) return false;
  const res = await db.organization.updateMany({ where: { id: organizationId, aiStyleProfile: current }, data: { aiStyleProfile: red } });
  return res.count > 0;
}

/** How many old reservations to scrub per call — bounds work / lock time. */
const RETENTION_BATCH = 300;

/**
 * The retention cutoff instant: data from stays that ended BEFORE this is due for
 * (or already) anonymization. Null when retention is disabled. Shared with the
 * sync so a deep re-fetch never re-imports the very era retention erased.
 */
export function retentionCutoff(now: Date = new Date()): Date | null {
  const months = Number(process.env.DATA_RETENTION_MONTHS);
  if (!Number.isFinite(months) || months <= 0) return null;
  return subMonths(startOfDay(now), months);
}

/**
 * Süre-bazlı süpürgenin ÇAPASINI mesaj yaşına bağlayan bayrak — DEFAULT KAPALI.
 *
 * KAPALIYKEN davranış BİREBİR eskisidir (test-pinli), yani bu commit canlıda
 * hiçbir satırı farklı işlemez. Geri alma = env'i silmek, deploy gerekmez.
 * Depo deseni: `GUEST_ERASURE_ENABLED` · `UNVERIFIED_SWEEP_ENABLED` ·
 * `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` — GERİ ALINAMAZ veri işlemleri hep
 * kapalı doğar ve kullanıcı açar.
 *
 * AÇIKKEN İKİ ŞEY BİRDEN değişir ve ikisi de AYNI fikrin yüzüdür — "hüküm
 * MESAJIN kendi yaşına göre verilir, konaklamanın yaşına göre değil":
 *
 *   (a) SEÇİCİ tekrarlanabilir olur → bir kez temizlenmiş konaklamaya SONRADAN
 *       yazılan eski-yeterli misafir metni artık kaçmaz (ÖLÇÜLMÜŞ sızıntı).
 *   (b) TEMİZLİK cutoff'tan eski mesajlarla SINIRLANIR → bugün gelen bir mesaj
 *       artık ilk geçişte silinmez (ÖLÇÜLMÜŞ aşırı-silme: öksüz dalda yaş
 *       çapası eski kaldığında BUGÜN gelen mesaj ilk koşuda yok edildi).
 *
 * 🚨 (b) OLMADAN (a) YAPILAMAZ: yalnız seçiciyi genişletmek, taze mesajı olan
 * her eski konaklamayı sonsuza dek yeniden seçip o taze mesajı her geçişte
 * silmeye çalışırdı — host'un cevaplamak için okuması gereken CANLI mesajı yok
 * ederdi. İkisi tek bayrakta çünkü tek bir kararın iki yarısı.
 */
export function messageAgeAnchorEnabled(): boolean {
  return process.env.RETENTION_MESSAGE_AGE_ANCHOR === "1";
}

/**
 * Yapay zekâ üretim izi (migration 60) — `Message` gövdesiyle AYNI yaş kuralı: bayrak AÇIKKEN yalnız cutoff'tan eski iz (bugün yazılmış
 * bir taslak, eski bir konaklamaya bugün gelen mesaja verilmiş cevaptır; mesajın kendisi gibi korunur). Bayrak kapalıyken eski
 * davranış: seçilen konuşmanın bütün izi.
 */
function aiTraceAge(cutoff: Date): { createdAt?: { lt: Date } } {
  return messageAgeAnchorEnabled() ? { createdAt: { lt: cutoff } } : {};
}
/**
 * Hâlâ metin taşıyan iz — taslak, gönderilen ya da kurucu etiket NOTU (Haiku 10-09: metni süpürüldükten SONRA eklenen notlu etiket
 * hiçbir bacağa düşmüyordu). Seçim bacağı = temizlik koşulu: süpürge üçünü de null'lar → sonlanır.
 */
function aiTraceTextLeft(cutoff: Date) {
  return {
    ...aiTraceAge(cutoff),
    OR: [{ draftText: { not: null } }, { sentText: { not: null } }, { labels: { some: { note: { not: null } } } }],
  };
}

/**
 * Anonymize guest personal data for stays that ended before the retention window.
 * No-op unless DATA_RETENTION_MONTHS is a positive number. Returns how many
 * reservations were scrubbed (0 when disabled or nothing is due).
 */
export async function anonymizeOldGuestData(now: Date = new Date()): Promise<{ anonymized: number }> {
  const months = Number(process.env.DATA_RETENTION_MONTHS);
  if (!Number.isFinite(months) || months <= 0) return { anonymized: 0 }; // disabled by default
  const cutoff = subMonths(startOfDay(now), months);

  let anonymized = 0;

  // (1) Reservation-linked guest data. Reservations whose stay ended before the
  // cutoff and still carry real PII (guestName not yet anonymized). Bounded batch.
  const oldRes = await prisma.reservation.findMany({
    where: {
      departureDate: { lt: cutoff },
      ...(messageAgeAnchorEnabled()
        ? {
            // 🚨 SÜPÜRGE ARTIK TEK ATIMLIK DEĞİL (bayrak AÇIKKEN).
            //
            // Eski koşul YALNIZ `guestName != ANON_NAME` idi ve o sentinel'i
            // süpürgenin KENDİSİ yazıyor → bir kez temizlenen konaklama SONSUZA
            // DEK dışarıda kalıyordu. ÖLÇÜLDÜ (08-09 (2), geçici probe): 40 ay
            // önce çıkışlı bir rezervasyon süpürüldükten SONRA aynı konuşmaya
            // yazılan yeni bir misafir mesajı, ikinci süpürge koşusunda BİREBİR
            // sağ kaldı ve bir daha ASLA seçilmez (çapa `departureDate` ve o hiç
            // ilerlemez). Ulaşılabilir senaryo sıradan: misafir yıllar sonra
            // "şarj aletimi unuttum" / yorum-iadesi için yazar.
            //
            // İkinci koşul TERMİNE EDER: aşağıdaki `updateMany` cutoff'tan eski
            // TÜM inbound gövdeleri temizliyor, yani bir sonraki geçişte `some`
            // yanlışa döner ve satır seçilmez. Sonsuz döngü YOK.
            OR: [
              { guestName: { not: ANON_NAME } },
              {
                conversations: {
                  some: {
                    messages: {
                      some: { direction: "inbound", body: { not: ANON_BODY }, createdAt: { lt: cutoff } },
                    },
                  },
                },
              },
              // ── TAM YENİDEN-TEMİZLENEBİLİRLİK (Codex F07, P1) ────────────────
              // Yukarıdaki iki bacak YETMİYORDU: adı zaten anonim, eski inbound'u
              // kalmamış bir kayda SONRADAN telefon / e-posta / not / görev
              // açıklaması / triyaj metni bağlanırsa hiçbiri seçilme sebebi
              // değildi → süresiz yaşıyordu (Codex predicate'i yakalayıp gösterdi).
              //
              // 🚨 BACAK KURALI = SONLANMA KURALI: yalnız bu süpürgenin KENDİSİNİN
              // aşağıdaki TX'te null/sentinel YAPTIĞI alanlar bacak olabilir; aksi
              // hâlde satır her geçişte yeniden seçilir (sonsuz döngü, m48'in
              // "tek atımlık" dersinin tersi). Ad-redaksiyonuyla temizlenen
              // metinler (TaskUpdate.note, outbound gövde) bu yüzden bacak DEĞİL —
              // redaksiyon metni bırakır. O sınıf bir işaret kolonu (migration)
              // ister; bilinçli açık bırakıldı ve test-pinli.
              { guestPhone: { not: null } },
              { guestEmail: { not: null } },
              { guestExternalId: { not: null } },
              { guestGivenName: { not: null } }, // hitap adı (migration 57) — süpürge null yapar → sonlanır
              { guestCheckoutTime: { not: null } },
              { notes: { not: null } },
              { conversations: { some: { guestIdentifier: { not: ANON_ID } } } },
              {
                conversations: {
                  some: { OR: [{ aiActionSuggestion: { not: null } }, { aiMissingInfoJson: { not: null } }] },
                },
              },
              // Yapay zekâ üretim izi (migration 60): süpürge eski izin metnini null'lar → sonlanır. Yaş sınırı Message ile AYNI.
              { conversations: { some: { aiGenerations: { some: aiTraceTextLeft(cutoff) } } } },
              // Görev açıklaması misafirin HAM metni (şikayet / akıllı görev) —
              // aşağıda ANON_BODY yapılır → sonlanır. NULL hariç (Prisma `not`
              // NULL'u dışlar; açıkça yazıldı ki niyet okunabilsin).
              { tasks: { some: { AND: [{ description: { not: null } }, { description: { not: ANON_BODY } }] } } },
            ],
          }
        : { guestName: { not: ANON_NAME } }),
    },
    select: { id: true, guestName: true, guestGivenName: true, property: { select: { organizationId: true } } },
    take: RETENTION_BATCH,
  });
  if (oldRes.length > 0) {
    const resIds = oldRes.map((r) => r.id);
    // Tam ad + kanalın hitap adı (migration 57): hitap adı tam adın ilk sözcüğünden uzun olabilir ("Mehmet Ali").
    const resNamesById = new Map(
      oldRes.map((r) => [r.id, [r.guestName, r.guestGivenName].filter((n): n is string => Boolean(n))]),
    );
    const convs = await prisma.conversation.findMany({
      where: { reservationId: { in: resIds } },
      select: { id: true, reservationId: true, guestIdentifier: true },
    });
    const convIds = convs.map((c) => c.id);

    // Outbound (host/AI) bodies are the host's own record → KEPT, but the guest's
    // NAME is scrubbed out of them. Names are captured HERE, before the same
    // transaction overwrites reservation.guestName / conversation.guestIdentifier.
    const namesByConv = new Map<string, string[]>();
    for (const c of convs) {
      namesByConv.set(
        c.id,
        [...(c.reservationId ? resNamesById.get(c.reservationId) ?? [] : []), c.guestIdentifier].filter(
          (n): n is string => Boolean(n),
        ),
      );
    }
    const outbound = convIds.length
      ? await prisma.message.findMany({
          where: { conversationId: { in: convIds }, direction: "outbound" },
          select: { id: true, conversationId: true, body: true },
        })
      : [];
    const bodyRedactions: { id: string; body: string }[] = [];
    for (const m of outbound) {
      const red = redactNameFromBody(redactContactsFromText(m.body), namesByConv.get(m.conversationId) ?? []);
      if (red !== m.body) bodyRedactions.push({ id: m.id, body: red });
    }

    // Lifecycle tasks embed the guest's REAL NAME in their title
    // ("Çıkış temizliği - Ahmet Yılmaz" / "Ahmet Yılmaz girişi için hazırlık" —
    // createReservationTasks). Nothing else in this sweep reaches Task, so the
    // name used to outlive the retention window in the task list; worse,
    // Task.reservationId is onDelete:SetNull, so deleting the booking later would
    // strip the only link that could ever find it. Same helper as the outbound
    // bodies: word-boundary safe, idempotent, and the host's own work record
    // ("Çıkış temizliği") stays readable.
    //
    // ⚠️ "Descriptions are fixed template text" ARTIK DOĞRU DEĞİL (derin denetim,
    // 08-01) — ve bu yorum bir süre yanlış yöne sevk etti. Yaşam-döngüsü görevleri
    // için doğruydu, ama ŞİKAYET görevi (`automation.ts`) ve AKILLI GÖREV
    // (`tasks/detect.ts`) `description` alanına misafirin KENDİ MESAJINI 500
    // karaktere kadar KELİMESİ KELİMESİNE yazıyor. O metin misafirin adını,
    // telefonunu, sağlık durumunu — ne yazdıysa onu — taşıyabilir ve hiçbir
    // süpürge ona dokunmuyordu. CLAUDE.md'nin kendi SCRUB KAPSAMI KURALI:
    // "misafir metni/adı taşıyan HER yeni kolon İKİ süpürgeye birden bağlanır".
    const namesByRes = new Map<string, string[]>();
    for (const [resId, names] of resNamesById) {
      if (names.length) namesByRes.set(resId, [...names]);
    }
    for (const c of convs) {
      if (!c.reservationId || !c.guestIdentifier) continue;
      namesByRes.set(c.reservationId, [...(namesByRes.get(c.reservationId) ?? []), c.guestIdentifier]);
    }
    // ⚠️ İKİ BAĞ BİRDEN (denetim, 08-01 — beşinci tur, ajan bulgusu). Yalnız
    // `reservationId` ile seçmek bir sınıfı KAÇIRIYORDU: şikayet/akıllı görev,
    // konuşma HENÜZ rezervasyona bağlı DEĞİLKEN doğduysa `Task.reservationId`
    // NULL kalır (`automation.ts` `conversation.reservation?.id ?? null` geçer) ve
    // konuşma SONRADAN bağlanır (`hospitable-sync` mevcut konuşmaya
    // `reservationId` yazar). O andan itibaren görev:
    //   · bu dala girmez (kendi `reservationId`'si NULL),
    //   · yetim dalına da girmez (konuşma artık bağlı),
    // yani misafirin HAM MESAJI (`description`) ve ADI (`title`) İKİ SÜPÜRGENİN
    // DE dışında kalıp SÜRESİZ yaşıyordu. `sourceMessageId` bağı yetim dalının
    // zaten kullandığı bağdır; burada da kullanılır (Task'ta `conversationId`
    // kolonu YOK — eklemek migration ister).
    const scopedMsgIds = convIds.length
      ? (
          await prisma.message.findMany({
            where: { conversationId: { in: convIds } },
            select: { id: true },
          })
        ).map((m) => m.id)
      : [];
    const tasks = await prisma.task.findMany({
      where: {
        OR: [
          { reservationId: { in: resIds } },
          ...(scopedMsgIds.length ? [{ sourceMessageId: { in: scopedMsgIds } }] : []),
        ],
      },
      select: { id: true, reservationId: true, title: true, description: true },
    });
    const titleRedactions: { id: string; title: string; description?: string }[] = [];
    const namesByTask = new Map<string, string[]>();
    // Bağsız (yalnız `sourceMessageId` ile yakalanan) görevlerde rezervasyon adı
    // yok — kapsamdaki TÜM adlar kullanılır (redaksiyon kelime-sınırı güvenli ve
    // idempotent; fazladan ad yalnız daha fazla maskeleme demektir, kayıp değil).
    const allScopedNames = [...new Set([...namesByRes.values()].flat())];
    for (const t of tasks) {
      const names = t.reservationId ? namesByRes.get(t.reservationId) ?? [] : allScopedNames;
      namesByTask.set(t.id, names);
      const red = redactNameFromBody(redactContactsFromText(t.title), names);
      // AÇIKLAMA misafirin HAM MESAJIDIR (şikayet / akıllı görev) — ad redaksiyonu
      // yetmez, tıpkı `Message.body` gibi TAMAMEN anonimleştirilir. Görevin
      // başlığı ve tipi host'un iş kaydı olarak okunur kalır.
      const guestText = t.description && t.description !== ANON_BODY ? ANON_BODY : undefined;
      if (red !== t.title || guestText) {
        titleRedactions.push({ id: t.id, title: red, ...(guestText ? { description: guestText } : {}) });
      }
    }
    // Crew notes on those tasks are free text a human typed ("Ahmet'in odası…") —
    // same class as an outbound reply, so the same treatment: the note stays as the
    // host's operational record, only the identifying token goes.
    const noteRows = tasks.length
      ? await prisma.taskUpdate.findMany({
          where: { taskId: { in: tasks.map((t) => t.id) }, note: { not: null } },
          select: { id: true, taskId: true, note: true },
        })
      : [];
    const noteRedactions: { id: string; note: string }[] = [];
    for (const n of noteRows) {
      const red = redactNameFromBody(redactContactsFromText(n.note ?? ""), namesByTask.get(n.taskId) ?? []);
      if (red !== n.note) noteRedactions.push({ id: n.id, note: red });
    }

    await prisma.$transaction([
      ...titleRedactions.map((t) =>
        prisma.task.update({
          where: { id: t.id },
          data: { title: t.title, ...(t.description ? { description: t.description } : {}) },
        }),
      ),
      ...noteRedactions.map((n) => prisma.taskUpdate.update({ where: { id: n.id }, data: { note: n.note } })),
      // The guest's OWN messages (inbound) carry their words/PII — scrub the body.
      ...(convIds.length
        ? [
            prisma.message.updateMany({
              where: {
                conversationId: { in: convIds },
                direction: "inbound",
                body: { not: ANON_BODY },
                // 🚨 BAYRAK AÇIKKEN YAŞ SINIRI (08-09 (2)): hüküm MESAJIN kendi
                // yaşına göre verilir. Eski kodda bu filtre YOKTU → eski bir
                // konaklamaya BUGÜN yazılmış bir mesaj ilk geçişte siliniyordu
                // (öksüz dalda ölçüldü). Host'un cevaplamak için okuması gereken
                // canlı metni yok etmek, korumanın amacı DEĞİL.
                ...(messageAgeAnchorEnabled() ? { createdAt: { lt: cutoff } } : {}),
              },
              data: { body: ANON_BODY, senderName: ANON_ID, aiSuggestedReply: null },
            }),
            prisma.conversation.updateMany({
              where: { id: { in: convIds } },
              data: {
                guestIdentifier: ANON_ID,
                // m48 (KVKK): triyaj METİNLERİ misafirin mesajından TÜREMİŞ
                // model çıktısıdır — içinde misafirin adı, telefonu,
                // rezervasyon ayrıntısı ve şikayetinin içeriği geçebilir,
                // çünkü model tam da onları okuyarak yazıyor. Yani misafir
                // kişisel verisi ve SCRUB KAPSAMI KURALI'na tabi.
                // ⚠️ Kardeş dal (ÖKSÜZ konuşmalar) AYRICA bağlanır — parite
                // testi DOSYA düzeyinde küme karşılaştırdığı için dal düzeyinde
                // KÖRDÜR ve bu boşluğu göremez (`TaskUpdate.note` dersi).
                aiActionSuggestion: null,
                aiMissingInfoJson: null,
              },
            }),
          ]
        : []),
      // Outbound bodies: keep the host's record, remove only the guest's name.
      ...bodyRedactions.map((r) => prisma.message.update({ where: { id: r.id }, data: { body: r.body } })),
      // Outbox delivery artifacts duplicate the SENT text (greetings carry the
      // guest's first name; hosts may have typed PII into replies) — without this
      // they would outlive the retention window at rest. Mirror the explicit-
      // erasure scrub (erasure.ts parity): a stale undelivered UNCLAIMED row is
      // canceled (a 24-month-old pending row must never deliver a sentinel later),
      // then every remaining linked body is anonymized. The host's readable record
      // stays on Message (name-redacted above); /sent/queue never shows bodies.
      //
      // ⚠️ Kapsam `ERASABLE_STATUSES` — TEK KAYNAK, açık silmeyle ORTAK (denetim,
      // 08-01). `blocked`/`failed`/`review` de teslim EDİLMEMİŞ ve diriltme yolu
      // olan durumlar; listede olmadıkları için 2 yıllık bir satır abonelik
      // yenilenince ya da ops ekranından tek tıkla gönderilebiliyordu.
      prisma.messageOutbox.updateMany({
        where: {
          OR: [
            { reservationId: { in: resIds } },
            ...(convIds.length ? [{ conversationId: { in: convIds } }] : []),
          ],
          status: { in: [...ERASABLE_STATUSES] },
          claimedBy: null,
        },
        data: { body: ANON_BODY, status: "canceled" },
      }),
      prisma.messageOutbox.updateMany({
        where: {
          OR: [
            { reservationId: { in: resIds } },
            ...(convIds.length ? [{ conversationId: { in: convIds } }] : []),
          ],
          body: { not: ANON_BODY },
        },
        data: { body: ANON_BODY },
      }),
      // 🚨 YAPAY ZEKÂ ÜRETİM İZİ (migration 60, kurucu §D-1 10-09): taslak / gönderilen METİN `Message` ile AYNI süpürgede maskelenir.
      ...(convIds.length
        ? [
            prisma.aiGeneration.updateMany({
              where: { conversationId: { in: convIds }, ...aiTraceAge(cutoff), OR: [{ draftText: { not: null } }, { sentText: { not: null } }] },
              data: { draftText: null, sentText: null },
            }),
            // Kurucu etiket notu misafir metnini alıntılayabilir → aynı süpürgede, izle AYNI yaş kuralıyla silinir.
            prisma.aiReviewLabel.updateMany({
              where: { generation: { conversationId: { in: convIds }, ...aiTraceAge(cutoff) }, note: { not: null } },
              data: { note: null },
            }),
          ]
        : []),
      prisma.reservation.updateMany({
        where: { id: { in: resIds } },
        data: {
          guestName: ANON_NAME,
          guestGivenName: null,
          guestPhone: null,
          guestEmail: null,
          guestExternalId: null,
          guestCheckoutTime: null,
          notes: null,
          qrEscalationEmailMessageId: null, // acil mesaj metninin özetini taşıyabilir — silmeyle eş (Haiku 10-14)
        },
      }),
    ]);
    anonymized += resIds.length;
    // G7-b: bu partide süpürülen misafirlerin adları işletme başına → o işletmenin üslup profili (telefon / e-posta da).
    const namesByOrg = new Map<string, string[]>();
    for (const r of oldRes) {
      const orgId = r.property.organizationId;
      namesByOrg.set(orgId, [...(namesByOrg.get(orgId) ?? []), ...(namesByRes.get(r.id) ?? [])]);
    }
    for (const [orgId, names] of namesByOrg) await scrubStyleProfile(prisma, orgId, names);
  }

  // (2) Orphaned conversations with NO reservation link. These never reach the
  // reservation-driven sweep above, so their guest PII would otherwise live
  // FOREVER: manual/unmatched threads, or — critically — threads whose reservation
  // the host deleted (Conversation.reservation is onDelete: SetNull). Age them by
  // their own lastMessageAt so the privacy promise ("veriler saklama süresi
  // sonunda anonimleştirilir") actually holds for every thread, not just linked ones.
  // 🚨 `guestIdentifier != ANON_ID` KOŞULU KALDIRILDI (denetim, 08-01 — beşinci
  // tur, ajan bulgusu). `ANON_ID` ("Misafir") aynı zamanda MEŞRU placeholder'dır:
  // Hospitable misafir kaydını çözemezse `importThread` bu değeri yazar (iCal'de
  // SUMMARY boşsa aynı şekilde). Kardeş modül bu çakışmayı zaten AÇIKÇA biliyor
  // (`hospitable-sync.ts`: "ANON_ID is ALSO the legitimate no-name placeholder").
  // Filtre "zaten temizlenmiş" varsayıyordu; sonuç, adı çözülememiş bir misafirin
  // KENDİ mesaj gövdelerinin (telefon, adres, ne yazdıysa) 24 ay sonra da HİÇ
  // anonimleşmemesiydi — gizlilik vaadinin doğrudan ihlali.
  //
  // Yerine İÇERİK koşulu: hâlâ temizlenmemiş bir inbound gövdesi olan yetimler.
  // Bu hem doğru kümeyi seçer hem tamamen temizlenmiş satırları tekrar tekrar
  // işlemeyi önler (eski filtrenin asıl amacı buydu).
  const orphanConvs = await prisma.conversation.findMany({
    where: {
      reservationId: null,
      lastMessageAt: { lt: cutoff },
      OR: [
        { guestIdentifier: { not: ANON_ID } },
        {
          messages: {
            some: {
              direction: "inbound",
              body: { not: ANON_BODY },
              ...(messageAgeAnchorEnabled() ? { createdAt: { lt: cutoff } } : {}),
            },
          },
        },
        // (F07) Öksüz dal paritesi: sonradan yazılan triyaj metinleri de yeniden
        // seçilir; aşağıdaki TX ikisini null yapar → sonlanır. Bayrak kapalıyken
        // davranış birebir eski.
        ...(messageAgeAnchorEnabled()
          ? [
              { aiActionSuggestion: { not: null } },
              { aiMissingInfoJson: { not: null } },
              { aiGenerations: { some: aiTraceTextLeft(cutoff) } },
            ]
          : []),
      ],
    },
    select: { id: true, guestIdentifier: true, property: { select: { organizationId: true } } },
    take: RETENTION_BATCH,
  });
  if (orphanConvs.length > 0) {
    const orphanIds = orphanConvs.map((c) => c.id);
    // Redact the guest name from OUTBOUND bodies too (host record kept). For an
    // orphan the guestIdentifier is the ONLY name source (no reservation row).
    const nameByConv = new Map(orphanConvs.map((c) => [c.id, c.guestIdentifier]));
    const outbound = await prisma.message.findMany({
      where: { conversationId: { in: orphanIds }, direction: "outbound" },
      select: { id: true, conversationId: true, body: true },
    });
    const bodyRedactions: { id: string; body: string }[] = [];
    for (const m of outbound) {
      const name = nameByConv.get(m.conversationId);
      const red = name ? redactNameFromBody(redactContactsFromText(m.body), [name]) : redactContactsFromText(m.body);
      if (red !== m.body) bodyRedactions.push({ id: m.id, body: red });
    }
    // ⚠️ YETİM DALI DA GÖREVLERE DOKUNMALI (denetim, 08-01 — ikinci tur).
    //
    // Bu dal yalnız Message + Conversation'ı temizliyordu. Oysa REZERVASYONSUZ
    // bir konuşmadan da görev doğuyor (şikayet görevi + akıllı görev) ve o görev
    // BAŞLIKTA misafirin adını, AÇIKLAMADA ham mesajını taşıyor. Rezervasyon
    // kapsamlı dal onu bulamaz (`reservationId` null), bu dal ise Task'a hiç
    // bakmıyordu → misafir metni SÜRESİZ kalıyordu. Bugün kapatılan bulgunun
    // kalan yarısı.
    //
    // Bağ `sourceMessageId`: `Task`'ta `conversationId` kolonu YOK (eklemek
    // migration ister), ama görev kendisini doğuran MESAJA bağlı ve o mesaj bu
    // konuşmanın mesajları arasında.
    const orphanMsgIds = (
      await prisma.message.findMany({
        where: { conversationId: { in: orphanIds } },
        select: { id: true },
      })
    ).map((m) => m.id);
    const orphanTasks = orphanMsgIds.length
      ? await prisma.task.findMany({
          where: { sourceMessageId: { in: orphanMsgIds } },
          select: { id: true, title: true, description: true },
        })
      : [];
    // Konuşma başına ad: yetimde `guestIdentifier` TEK ad kaynağıdır.
    const orphanNames = orphanConvs.map((c) => c.guestIdentifier).filter(Boolean) as string[];
    const taskRedactions: { id: string; title: string; description?: string }[] = [];
    for (const t of orphanTasks) {
      const redTitle = redactNameFromBody(redactContactsFromText(t.title), orphanNames);
      // Açıklama misafirin HAM MESAJI → tıpkı `Message.body` gibi tamamen
      // anonimleştirilir; başlık ve tip host'un iş kaydı olarak okunur kalır.
      const guestText = t.description && t.description !== ANON_BODY ? ANON_BODY : undefined;
      if (redTitle !== t.title || guestText) {
        taskRedactions.push({ id: t.id, title: redTitle, ...(guestText ? { description: guestText } : {}) });
      }
    }

    // 🚨 PERSONEL NOTU DA BU DALDA TEMİZLENİR (08-09 (2), kırmızı-önce testli).
    //
    // Rezervasyonlu dal `TaskUpdate.note`u ZATEN redakte ediyordu; bu dalda
    // `taskUpdate` sorgusu HİÇ YOKTU → rezervasyona bağlanamamış bir konuşmadan
    // doğan göreve temizlikçinin yazdığı not ("Ahmet Yılmaz odayı erken
    // boşalttı…") misafirin adını SÜRESİZ taşıyordu.
    //
    // ⚠️ `scrub-scope-parity.test.ts` BU BOŞLUĞU GÖREMEZ ve bu tesadüf değil:
    // o test (model, kolon) KÜMELERİNİ DOSYA düzeyinde karşılaştırır ve
    // `TaskUpdate.note` kümeye KARDEŞ daldan zaten giriyor. Dal düzeyinde
    // kördür — CLAUDE.md'nin kendi `TaskUpdate.note` dersinin ikinci kez
    // yaşanmış hâli. Gerçek pin dal düzeyindedir
    // (`tests/integration/task-description-scrub.test.ts`).
    //
    // Muamele kardeş dalla BİREBİR aynı: not host'un İŞ KAYDIDIR → silinmez,
    // yalnız kimlik belirten token gider (`redactNameFromBody` kelime-sınırı
    // güvenli ve idempotent).
    const orphanNoteRows = orphanTasks.length
      ? await prisma.taskUpdate.findMany({
          where: { taskId: { in: orphanTasks.map((t) => t.id) }, note: { not: null } },
          select: { id: true, note: true },
        })
      : [];
    const orphanNoteRedactions: { id: string; note: string }[] = [];
    for (const n of orphanNoteRows) {
      const red = redactNameFromBody(redactContactsFromText(n.note ?? ""), orphanNames);
      if (red !== n.note) orphanNoteRedactions.push({ id: n.id, note: red });
    }

    await prisma.$transaction([
      prisma.message.updateMany({
        where: {
          conversationId: { in: orphanIds },
          direction: "inbound",
          body: { not: ANON_BODY },
          // Kardeş dalla BİREBİR aynı sınır — parite kuralı.
          ...(messageAgeAnchorEnabled() ? { createdAt: { lt: cutoff } } : {}),
        },
        data: { body: ANON_BODY, senderName: ANON_ID, aiSuggestedReply: null },
      }),
      prisma.conversation.updateMany({
        where: { id: { in: orphanIds } },
        data: {
          guestIdentifier: ANON_ID,
          // m48 (KVKK) — ÖKSÜZ DAL. Rezervasyonlu daldaki gerekçenin aynısı.
          // 🚨 Bu dal, bu deponun daha önce YANDIĞI yer: `TaskUpdate.note`
          // burada unutulmuştu ve parite testi dal düzeyinde kör olduğu için
          // görmemişti. Dal-düzeyi testi ayrıca yazıldı.
          aiActionSuggestion: null,
          aiMissingInfoJson: null,
        },
      }),
      // 🚨 OUTBOX YETİM DALINDA DA TEMİZLENİR (denetim, 08-01 — beşinci tur,
      // ajan bulgusu). Rezervasyon dalı bunu yapıyordu, yetim dalı YAPMIYORDU.
      // `MessageOutbox.reservationId` FK değil, yani host rezervasyonu silince
      // konuşma yetim olur ama outbox satırı OLDUĞU GİBİ kalır: gövdesi misafire
      // gidecek TAM METİN (adı dahil). `reactivateBlockedOutbox`'ın WHERE'inde
      // YAŞ FİLTRESİ YOK → abonelik yenilendiğinde 2 yıllık bir mesaj gerçekten
      // gönderilebiliyordu. Kapsam ve sıra rezervasyon dalıyla BİREBİR aynı.
      prisma.messageOutbox.updateMany({
        where: {
          conversationId: { in: orphanIds },
          status: { in: [...ERASABLE_STATUSES] },
          claimedBy: null,
        },
        data: { body: ANON_BODY, status: "canceled" },
      }),
      prisma.messageOutbox.updateMany({
        where: { conversationId: { in: orphanIds }, body: { not: ANON_BODY } },
        data: { body: ANON_BODY },
      }),
      // Üretim izi (migration 60) — öksüz dalda da (kardeş dalla BİREBİR; parite kuralı).
      prisma.aiGeneration.updateMany({
        where: { conversationId: { in: orphanIds }, ...aiTraceAge(cutoff), OR: [{ draftText: { not: null } }, { sentText: { not: null } }] },
        data: { draftText: null, sentText: null },
      }),
      prisma.aiReviewLabel.updateMany({
        where: { generation: { conversationId: { in: orphanIds }, ...aiTraceAge(cutoff) }, note: { not: null } },
        data: { note: null },
      }),
      ...bodyRedactions.map((r) => prisma.message.update({ where: { id: r.id }, data: { body: r.body } })),
      ...taskRedactions.map((t) =>
        prisma.task.update({
          where: { id: t.id },
          data: { title: t.title, ...(t.description ? { description: t.description } : {}) },
        }),
      ),
      ...orphanNoteRedactions.map((n) =>
        prisma.taskUpdate.update({ where: { id: n.id }, data: { note: n.note } }),
      ),
    ]);
    anonymized += orphanIds.length;
    // G7-b (öksüz dal paritesi): öksüz konuşmanın tek ad kaynağı `guestIdentifier` → işletmenin üslup profilinde de maskelenir.
    const orphanNamesByOrg = new Map<string, string[]>();
    for (const c of orphanConvs) {
      if (!c.guestIdentifier) continue;
      const orgId = c.property.organizationId;
      orphanNamesByOrg.set(orgId, [...(orphanNamesByOrg.get(orgId) ?? []), c.guestIdentifier]);
    }
    for (const [orgId, names] of orphanNamesByOrg) await scrubStyleProfile(prisma, orgId, names);
  }

  return { anonymized };
}

/**
 * Delete marketing leads past the lead-retention window. Prospect PII (name /
 * email / phone / message) has no other lifecycle — Lead has no org link, so it is
 * NOT covered by account erasure or the guest-data sweep — and would otherwise be
 * kept indefinitely. Gated by its OWN env var (default OFF) so a host's active
 * sales pipeline is never silently purged: set LEAD_RETENTION_MONTHS to enable.
 */
export async function purgeOldLeads(now: Date = new Date()): Promise<{ purged: number }> {
  const months = Number(process.env.LEAD_RETENTION_MONTHS);
  if (!Number.isFinite(months) || months <= 0) return { purged: 0 }; // disabled by default
  const cutoff = subMonths(startOfDay(now), months);
  const res = await prisma.lead.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { purged: res.count };
}

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/**
 * Rebuild a Paddle webhook payload keeping ONLY a minimal financial/reconciliation
 * skeleton (allowlist = fail-closed, so any future PII field Paddle adds is
 * dropped by default). Amount/currency are financial-record fields, NOT direct
 * PII, so they're kept for the books; customer email/name/address/card and the
 * rest of the raw body are dropped.
 */
/**
 * Saklanan Paddle yükü daha önce küçültülmüş mü (`redactPaddlePayload` çıktısı: üst düzeyde `redactedAt` + `note`). Ham Paddle olayında bu
 * iki alan yoktur (imzalı gövde). Webhook yeniden işlemesinde küçültülmüş yük HAM gövdeyle EZİLMEZ (Codex 10-16).
 */
export function isRedactedPaddlePayload(json: string | null | undefined): boolean {
  if (!json) return false;
  try {
    const p = JSON.parse(json) as unknown;
    return p !== null && typeof p === "object" && typeof (p as Record<string, unknown>).redactedAt === "string" && typeof (p as Record<string, unknown>).note === "string";
  } catch {
    return false;
  }
}

export function redactPaddlePayload(raw: string, note: "kvkk-erasure" | "retention-1y" | "retention-2y" | "org-deleted" = "kvkk-erasure"): string {
  let p: Record<string, unknown>;
  try {
    p = asObj(JSON.parse(raw));
  } catch {
    return JSON.stringify({ redactedAt: new Date().toISOString(), note, raw: "unparseable" });
  }
  const d = asObj(p.data);
  const totals = asObj(asObj(d.details).totals);
  const period = asObj(d.current_billing_period);
  const cd = asObj(d.custom_data);
  return JSON.stringify({
    event_id: p.event_id ?? null,
    event_type: p.event_type ?? null,
    occurred_at: p.occurred_at ?? null,
    data: {
      id: d.id ?? null,
      status: d.status ?? null,
      customer_id: d.customer_id ?? null, // provider id (reconciliation), not direct PII
      subscription_id: d.subscription_id ?? null,
      currency_code: d.currency_code ?? null,
      current_billing_period: { ends_at: period.ends_at ?? null },
      details: { totals: { grand_total: totals.grand_total ?? null } },
      custom_data: { organizationId: cd.organizationId ?? null },
    },
    redactedAt: new Date().toISOString(),
    note,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PADDLE OLAY KAYITLARI 1 YIL SONRA KÜÇÜLÜR (G6, kurucu kararı 10-13 "1 yıl"; ACIK-ISLER 08-08 §15)
//
// Ham yük müşterinin adını / e-postasını / fatura adresini taşır ve yalnız hesap SİLİNİNCE küçülüyordu → silinmeyen müşterinin her
// ödeme olayı süresiz ham kalıyordu. Kural: İŞLENMİŞ (`processed`) ve 12 aydan eski satırın yükü, hesap silmedeki AYNI izin listesine
// (`redactPaddlePayload`) indirilir — olay kimliği (`providerEventId`, tekrar koruması), tür, durum, tarihler ve finansal iskelet KALIR;
// ad / e-posta / adres ve gövdenin geri kalanı gider. `error` / `received` satırları 24 aya kadar ham kalır (inceleme için); 24 aydan eskisi
// de aynı biçimde küçülür (kurucu 10-18 T6b, aynen: "2 yıl sonra küçülsün" — inceleme bir yıl sonra da yapılmıyorsa ham iz yalnız risk;
// durum + hata kodu + olay türü kalır, not "retention-2y"). Zaten küçültülmüş satır
// (`redactedAt`) atlanır. Saatlik iş, parti başına sınırlı (birikmiş geçmiş birkaç saatte erir). `DATA_RETENTION_MONTHS`tan bağımsız.
// 🚨 İNCELEME SATIRLARI (Opus F1, 10-16): ödeme S1/S2 sonrası incelemeye düşen olay `status:"error"` + `error:"needs_review: <kod>"` yazılır
// (yeniden işlenebilsin diye "processed" DEĞİL). Bunlar da 12 ayda küçülür — yoksa ham yük süresiz kalırdı. Gerçek hata (`needs_review`
// öneki yok) ve `received` satırları yine dokunulmaz. Durum / kod değişmez (inceleme izi kalır).
// ─────────────────────────────────────────────────────────────────────────────

/** İncelemeye düşen ödeme olayının `error` öneki (ödeme S1/S2, kurucu 10-16) — webhook rotası yazar, küçültme okur. */
export const NEEDS_REVIEW_PREFIX = "needs_review:";

/** Ham ödeme olayı yükünün saklama süresi (ay) — kurucu kararı. */
export const PADDLE_WEBHOOK_RAW_RETENTION_MONTHS = 12;
/** İşlenememiş (`error` / `received`) ödeme olayı yükünün saklama süresi (ay) — kurucu 10-18 T6b. */
export const PADDLE_WEBHOOK_UNPROCESSED_RETENTION_MONTHS = 24;
const PADDLE_MINIMIZE_BATCH = 500;

export async function minimizeOldPaddleWebhooks(now: Date = new Date()): Promise<{ minimized: number }> {
  const cutoff = subMonths(now, PADDLE_WEBHOOK_RAW_RETENTION_MONTHS);
  const unprocessedCutoff = subMonths(now, PADDLE_WEBHOOK_UNPROCESSED_RETENTION_MONTHS);
  const rows = await prisma.webhookEvent.findMany({
    where: {
      provider: "paddle",
      OR: [
        { status: "processed", createdAt: { lt: cutoff } },
        { status: "error", error: { startsWith: NEEDS_REVIEW_PREFIX }, createdAt: { lt: cutoff } },
        { status: { in: ["error", "received"] }, createdAt: { lt: unprocessedCutoff } },
      ],
      NOT: { payloadJson: { contains: '"redactedAt"' } },
    },
    select: { id: true, payloadJson: true, status: true, error: true },
    orderBy: { createdAt: "asc" },
    take: PADDLE_MINIMIZE_BATCH,
  });
  let minimized = 0;
  for (const r of rows) {
    // Koşullu yazma: okuma ile yazma arasında satır değiştiyse (yeniden işleme, hesap silme) bu tur ona dokunmaz.
    const res = await prisma.webhookEvent.updateMany({
      where: { id: r.id, status: r.status, error: r.error, payloadJson: r.payloadJson },
      data: {
        payloadJson: redactPaddlePayload(
          r.payloadJson,
          r.status === "processed" || r.error?.startsWith(NEEDS_REVIEW_PREFIX) ? "retention-1y" : "retention-2y",
        ),
      },
    });
    minimized += res.count;
  }
  return { minimized };
}

/**
 * Minimize customer PII in Paddle WebhookEvent rows for a deleted org. WebhookEvent
 * has NO org FK (so it doesn't cascade — it's the surviving financial trail once
 * Invoice/Subscription cascade away). Linked only via payloadJson custom_data.
 * organizationId: pre-filter by substring (org id is a high-entropy cuid), then
 * parse-verify before touching. status:"processed" so a Paddle retry can't re-store
 * raw PII (the webhook route only reprocesses non-"processed" rows).
 */
async function redactPaddleWebhooksForOrg(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
): Promise<void> {
  // AUTHORITATIVE attribution anchors — read BEFORE the org row is deleted.
  // Paddle dedups customers by billing email, so a customer id is NOT guaranteed
  // unique to one org (adversarial-review finding): a cid learned loosely could
  // let one tenant's erasure strip ANOTHER tenant's rows. So:
  //   • primary: Subscription.customerId — stored by the webhook only for events
  //     whose org was resolved via consent/providerRef (never client custom_data);
  //   • legacy fallback (no stored cid yet): learn from an org-stamped row ONLY
  //     when that row is anchored to one of the org's OWN provider refs.
  const customerIds = new Set<string>();
  const providerRefs = new Set<string>();
  const sub = await db.subscription.findUnique({
    where: { organizationId },
    select: { customerId: true, providerRef: true },
  });
  if (sub?.customerId) customerIds.add(sub.customerId);
  if (sub?.providerRef) providerRefs.add(sub.providerRef);
  for (const inv of await db.invoice.findMany({
    where: { organizationId },
    select: { providerRef: true },
  })) {
    if (inv.providerRef) providerRefs.add(inv.providerRef);
  }

  // Pass 1 — rows that carry OUR org id in custom_data (stamped at checkout).
  const redacted = new Set<string>();
  const rows = await db.webhookEvent.findMany({
    where: { provider: "paddle", payloadJson: { contains: organizationId } },
    select: { id: true, payloadJson: true },
  });
  for (const r of rows) {
    let belongs = false;
    try {
      const parsed = JSON.parse(r.payloadJson) as {
        data?: {
          id?: unknown;
          subscription_id?: unknown;
          customer_id?: unknown;
          custom_data?: { organizationId?: unknown };
        };
      };
      belongs = parsed?.data?.custom_data?.organizationId === organizationId;
      // Legacy learn (only when nothing stored): the row must ALSO be tied to the
      // org's own subscription/transaction ref — custom_data alone is client-
      // writable and must never be the sole source of a customer id.
      const cid = parsed?.data?.customer_id;
      const anchored =
        (typeof parsed?.data?.id === "string" && providerRefs.has(parsed.data.id)) ||
        (typeof parsed?.data?.subscription_id === "string" && providerRefs.has(parsed.data.subscription_id));
      if (belongs && anchored && customerIds.size === 0 && typeof cid === "string" && cid.length > 0 && cid.length <= 64) {
        customerIds.add(cid);
      }
    } catch {
      belongs = false; // unparseable → not attributable to this org, skip
    }
    if (!belongs) continue;
    await db.webhookEvent.update({
      where: { id: r.id },
      data: { payloadJson: redactPaddlePayload(r.payloadJson), status: "processed", processedAt: new Date() },
    });
    redacted.add(r.id);
  }

  // Pass 2 — Paddle-generated rows matching the org's customer id. customer.*
  // events put the customer ENTITY in data (data.id === ctm_...), other events
  // reference it as data.customer_id; accept either, parse-verified. TENANT
  // GUARD: a row stamped with a DIFFERENT org's custom_data is never touched —
  // even if it shares the customer id (Paddle email-dedup can genuinely entangle
  // two orgs on one customer). Residual, documented: an un-stamped customer.*
  // row of a genuinely shared customer is still redacted (ambiguous ownership;
  // the allowlist keeps the reconciliation skeleton, redaction only removes).
  for (const cid of customerIds) {
    const cidRows = await db.webhookEvent.findMany({
      where: { provider: "paddle", payloadJson: { contains: cid } },
      select: { id: true, payloadJson: true },
    });
    for (const r of cidRows) {
      if (redacted.has(r.id)) continue;
      let belongs = false;
      try {
        const parsed = JSON.parse(r.payloadJson) as {
          data?: { id?: unknown; customer_id?: unknown; custom_data?: { organizationId?: unknown } };
        };
        const stampedOrg = parsed?.data?.custom_data?.organizationId;
        if (typeof stampedOrg === "string" && stampedOrg.length > 0 && stampedOrg !== organizationId) {
          continue; // another tenant's row — NEVER redact through a shared cid
        }
        belongs = parsed?.data?.customer_id === cid || parsed?.data?.id === cid;
      } catch {
        belongs = false;
      }
      if (!belongs) continue;
      await db.webhookEvent.update({
        where: { id: r.id },
        data: { payloadJson: redactPaddlePayload(r.payloadJson), status: "processed", processedAt: new Date() },
      });
      redacted.add(r.id);
    }
  }
}

/**
 * Full account erasure for one organization. Irreversible. The caller MUST have
 * already authorized this (owner re-authenticated). Returns silently on success.
 */
/**
 * İşlemin İLK adımı olarak koşan ön koşul (U41 / U42 / U44, Codex 10-07): çağıranın işlem DIŞINDA yaptığı denetimler (parola,
 * oturum sürümü, abonelik, süpürge aday koşulları) silme anında hâlâ geçerli mi. `null` = devam; dize = gerekçe, HİÇBİR şey
 * silinmez. Org satırı ön koşuldan önce `FOR UPDATE` kilitlenir (eşzamanlı yazanlar sıralanır).
 */
export type AccountDeletionPrecondition = (tx: Prisma.TransactionClient) => Promise<string | null>;

export async function deleteAccountData(
  organizationId: string,
  opts: { precondition?: AccountDeletionPrecondition } = {},
): Promise<{ deleted: true } | { deleted: false; reason: string }> {
  // KVKK erasure: WebhookEvent has no org FK (won't cascade) and its Paddle
  // payload carries customer email/name/address. The financial skeleton stays,
  // the PII goes — and this now happens INSIDE the same transaction as the org
  // delete (↓aşağıda), not before it.

  // Storage-backed task photos (S3/R2): read the object keys NOW, before any
  // delete, then record the durable deletion INTENTS ATOMICALLY with the org
  // delete (one transaction, below). The StorageDeletion table has NO org FK on
  // purpose — the rows SURVIVE the cascade so the drain can remove the objects
  // afterwards. Atomicity is the safety property: org-delete rolls back ⇒ NO
  // intents (never queue a deletion for a still-live org), org-delete commits ⇒
  // intents are recorded (a later provider outage can't fake success; the drain
  // retries). Legacy /uploads files are handled by the local rm below, unchanged.
  const { enqueueStorageDeletions } = await import("@/lib/storage/deletion-queue");
  const { STORAGE_PHOTO_URL_PREFIX, keyFromPhotoUrl } = await import("@/lib/storage/keys");
  const photoRows = await prisma.taskUpdate.findMany({
    where: {
      task: { property: { organizationId } },
      photoUrl: { startsWith: STORAGE_PHOTO_URL_PREFIX },
    },
    select: { photoUrl: true },
  });
  const storageKeys = photoRows.map((r) => keyFromPhotoUrl(r.photoUrl)).filter((k): k is string => k !== null);

  // ChatUsage rows key on propertyId but have no FK relation → won't cascade.
  const props = await prisma.property.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const propIds = props.map((p) => p.id);
  // Everything else cascades from the organization row — AND the ChatUsage delete
  // (no FK, wouldn't cascade) + storage deletion intents are written in the SAME
  // transaction (Codex P3): if the org-delete rolls back, the usage counters must
  // NOT already be gone (an account that lives on with wiped counters). Atomic.
  const refused = await prisma.$transaction(async (tx) => {
    if (opts.precondition) {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
      const reason = await opts.precondition(tx);
      if (reason) return reason;
    }
    // ⚠️ WEBHOOK REDAKSİYONU ARTIK BU TX'İN İÇİNDE (Codex denetimi, 08-01 — madde 3).
    //
    // DAVRANIŞ DEĞİŞİMİ, bilinçli: eskiden TX'ten ÖNCE koşuyordu ve gerekçesi
    // "silme patlasa bile PII en aza insin" idi. Bedeli tutarsız bir ara hâldi:
    // org SİLİNMEMİŞ ama fatura webhook'ları redakte edilmiş — yani hâlâ MÜŞTERİ
    // olan birinin kayıtları yarım budanmış oluyordu ve hiçbir yerde iz kalmıyordu.
    // Artık ya İKİSİ de olur ya HİÇBİRİ: silme geri sarılırsa redaksiyon da sarılır.
    //
    // Gizlilik kaybı YOK: silme başarısız olduğunda kullanıcıya hata döner ve
    // yeniden dener; başarılı denemede redaksiyon yine yapılır. Kalıcı olarak
    // silinemeyen bir org zaten hâlâ müşteridir — verisinin durması TUTARLIDIR.
    //
    // ⚠️ SIRA ÖNEMLİ: `Subscription`/`Invoice` satırlarını OKUR ve onlar org ile
    // birlikte cascade siliniyor → org silinmeden ÖNCE çağrılmalı.
    await redactPaddleWebhooksForOrg(tx, organizationId);
    // Deneme kimliği izi (kurucu 10-10: "hesap silindikten sonra 24 ay"): iz KALIR (FK boşa çekilir); 24 ay silinme anından sayılır.
    await markTrialIdentitiesOrphaned(tx, organizationId);
    if (propIds.length > 0) {
      await tx.chatUsage.deleteMany({ where: { propertyId: { in: propIds } } });
    }
    await tx.organization.delete({ where: { id: organizationId } });
    if (storageKeys.length > 0) await enqueueStorageDeletions(tx, organizationId, storageKeys);
    return null;
  },
  // 🚨 AÇIK SÜRE SINIRI ŞART (bağımsız denetim, 08-01 — bu turda AÇTIĞIM risk).
  // Redaksiyonu bu TX'e almak, işi Prisma'nın VARSAYILAN 5 saniyelik interactive-
  // transaction penceresine hapsetti (`db.ts` `transactionOptions` vermiyor).
  // Redaksiyon `payloadJson: { contains }` ile İKİ kez indekslenemez bir LIKE
  // '%…%' taraması yapıyor ve eşleşen her satıra ayrı UPDATE atıyor; `WebhookEvent`
  // hiçbir yerde budanmıyor (grep: 0 `deleteMany`) → tablo sınırsız büyür.
  // Süre aşılırsa P2028 ile TÜM silme geri sarılır: düzeltmeye çalıştığım "yarım
  // redaksiyon" hâli, "hesap HİÇ silinemiyor" hâline dönüşürdü.
  // Değerler kardeş KVKK yollarıyla birebir (`erasure.ts`, `hospitable-sync.ts`).
  { timeout: 180_000, maxWait: 15_000 });
  if (refused) return { deleted: false, reason: refused };

  // KVKK: task photos live on local disk (public/uploads/{orgSlug}), NOT in the DB,
  // so the cascade above leaves them. Physically remove the org's upload folder.
  // Best-effort — an FS error must never fail the erasure (the DB rows are gone
  // either way) — but it must be VISIBLE (Codex #7): the user was told "deleted",
  // so a leftover file is an operator to-do, never something to swallow silently.
  // rm(force:true) doesn't throw on a missing dir; what lands here is a real
  // permission/IO failure. A durable retry queue is the eventual fix (backlog,
  // together with S3/R2 object storage); alerting is the honest interim.
  try {
    const orgSlug = organizationId.replace(/[^a-zA-Z0-9-]/g, "");
    if (orgSlug) {
      const { rm } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await rm(join(process.cwd(), "public", "uploads", orgSlug), { recursive: true, force: true });
    }
  } catch (err) {
    const { reportError } = await import("@/lib/report-error");
    await reportError(`account-delete photo cleanup (org ${organizationId})`, err).catch(() => {});
  }
  return { deleted: true };
}
