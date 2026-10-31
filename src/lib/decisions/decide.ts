import "server-only";

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgTimezone } from "@/lib/timezone";
import { calendarDateOf, todayKey } from "@/modules/availability/core";
import { providerErrorMessageFromText } from "@/lib/provider-errors";
import { sendHostMessage } from "@/lib/host-send";
import { applyItemEvent } from "@/lib/conversation-items/store";
import { reportError } from "@/lib/report-error";
import {
  DECISION_SENDING_STALE_MS,
  TEXT_DECISION_KINDS,
  isDecisionKind,
  liveDecisionDayKey,
  parseHostTime,
  timeOnRightSide,
  type DecisionLang,
} from "./core";
import { listConversationDecisions } from "./store";
import { buildDecisionCards, decisionCardContextFor } from "./card";
import type { DecisionCardData } from "./view-types";
import { decisionAiTextEnabled } from "./ai-text";
import { checkDecisionText, decisionTextProblemsTr } from "./text-check";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR ÇEKİRDEĞİ (Faz 1; WhatsApp dilim 3 için rotadan BİREBİR çıkarıldı — tasarım
// `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md` §3.10). Ev sahibi kartta (panel) ya da WhatsApp düğmesiyle Onayla / Reddet / Kapat
// der. Onay ve ret misafire mesaj GÖNDERİR (cevap rotasıyla aynı çekirdek, `host-send.ts`). Göndermeden HEMEN önce yeniden doğrulama
// (TOCTOU, Faz 0 §4):
//  1. kilit: `pending` + sürüm eşleşmeli (CAS) — çift tıklama / eşzamanlı ikinci karar "stale", ikinci mesaj YOK;
//  2. misafir talepten SONRA yeniden yazdıysa önce okutulur (`guest_wrote_again`; "okudum" = son mesaj kimliğiyle tekrar);
//  3. rezervasyon iptal / hedef gün geçti → durur (kart kendiliğinden kapanır);
//  4. kontrol listesi ev sahibi baktıktan sonra değiştiyse (`factsHash`) karar ESKİ bilgiyle gitmez → `facts_changed`.
// Gönderim belirsizse (zaman aşımı, aynı metin az önce gitti / gidiyor, gönderim sırasında hata) kart "gönderim doğrulanamadı" kalır
// (mesaj ulaşmış OLABİLİR — kör tekrar yok); YALNIZ hiçbir şeyin gitmediği KESİN hatada kart yeniden açılır. Kilit onayın saatini ve karar
// vereni HEMEN yazar. Denetim kaydı metin / tutar taşımaz. Yetki (sahip / yönetici, bürünmede yazma yok) ÇAĞIRANDA denetlenir: panelde
// `withManage`, WhatsApp'ta bağlantının kullanıcısı (`host-channel/binding.ts` — yalnız sahip / yönetici bağlanabilir).
// ---------------------------------------------------------------------------

export interface DecideInput {
  action: "approve" | "decline" | "dismiss";
  version: number;
  time?: string;
  body?: string;
  seenMessageId?: string;
  /** Ev sahibinin gördüğü kartın olgu parmak izi (`decisionFactsHash`). */
  factsHash?: string;
  /** Ev sahibi hazır metni değiştirdi mi. */
  edited?: boolean;
  /** Ev sahibi metin denetiminin uyarısını gördü ve "Yine de gönder" dedi. */
  force?: boolean;
  /** Seçilen mesaj dili ve ücret / not seçimi — YALNIZ metin denetiminin dayanağı (gönderilen metin `body`). */
  lang?: DecisionLang;
  includeFee?: boolean;
  includeNote?: boolean;
}

export interface DecideActor {
  userId: string;
  /** Misafire giden mesajın gönderen adı (ev sahibinin adı). */
  name: string;
  /** Denetim kaydının kişisi (`auditActor`: bürünmede operatör). */
  auditActorId: string;
  /** Denetim kaydına eklenen sabit alanlar (bürünme işareti / kaynak `host_channel`). */
  auditExtra?: Record<string, unknown>;
}

export const DECISION_STALE_TEXT = "Bu kart az önce değişti; güncel hâli gösteriliyor.";
export const DECISION_UNVERIFIED_TEXT =
  "Gönderim doğrulanamadı — mesaj misafire ulaşmış olabilir. Konuşmayı kanaldan kontrol edin; ulaşmadıysa misafire buradan yazın.";

export type DecideOutcome =
  | { kind: "not_found" }
  | { kind: "bad_request"; field: "body" | "time"; error: string }
  | { kind: "conflict"; code: string; error: string; extra?: Record<string, unknown> }
  | { kind: "dismissed" }
  | { kind: "done"; status: "approved" | "declined"; resultMessageId: string | null; queued: boolean }
  | { kind: "unverified"; error: string }
  | { kind: "failed"; httpStatus: 502 | 503; error: string; version: number | undefined };

const CONVERSATION_SELECT = {
  id: true,
  channel: true,
  guestIdentifier: true,
  externalReservationId: true,
  propertyId: true,
  reservation: { select: { id: true, status: true, arrivalDate: true, departureDate: true } },
  property: { select: { checkInTime: true, checkOutTime: true, organization: { select: { timezone: true } } } },
} as const;

/**
 * Kartı sayfa ve karar çekirdeğiyle AYNI kurucudan yeniden kurar (WhatsApp bildirimi / önizlemesi / gönderimi — olgu izi üç yerde aynı
 * girdilerle). Karar ya da konuşma bu işletmede yoksa, ya da kart görünür değilse `null`.
 */
export async function freshDecisionCard(args: {
  organizationId: string;
  conversationId: string;
  decisionId: string;
  now: Date;
}): Promise<{ card: DecisionCardData; timeZone: string } | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: args.conversationId, property: { organizationId: args.organizationId } },
    select: CONVERSATION_SELECT,
  });
  if (!conversation) return null;
  const timeZone = orgTimezone(conversation.property.organization.timezone);
  const views = await listConversationDecisions(prisma, {
    organizationId: args.organizationId,
    conversationId: args.conversationId,
    timeZone,
    now: args.now,
  });
  const view = views.find((v) => v.id === args.decisionId);
  if (!view) return null;
  const ctx = await decisionCardContextFor({
    organizationId: args.organizationId,
    conversation: { ...conversation, messages: [] },
    timeZone,
    now: args.now,
    needsEarlyRule: view.kind === "early_checkin",
  });
  const [card] = await buildDecisionCards([view], ctx);
  return card ? { card, timeZone } : null;
}

const conflict = (code: string, error: string, extra?: Record<string, unknown>): DecideOutcome =>
  extra ? { kind: "conflict", code, error, extra } : { kind: "conflict", code, error };

export async function decideHostDecision(args: {
  organizationId: string;
  conversationId: string;
  decisionId: string;
  actor: DecideActor;
  input: DecideInput;
  now?: Date;
}): Promise<DecideOutcome> {
  const { organizationId, actor, input } = args;
  const id = args.conversationId;
  const decision = await prisma.decisionRequest.findFirst({
    where: { id: args.decisionId, conversationId: id, organizationId },
  });
  if (!decision || !isDecisionKind(decision.kind)) return { kind: "not_found" };
  const conversation = await prisma.conversation.findFirst({ where: { id, property: { organizationId } }, select: CONVERSATION_SELECT });
  if (!conversation) return { kind: "not_found" };
  const now = args.now ?? new Date();
  const audit = (action: string, extra: Record<string, unknown> = {}) =>
    writeAudit({
      organizationId,
      actorUserId: actor.auditActorId,
      action,
      metadata: { decisionId: decision.id, kind: decision.kind, ...extra, ...(actor.auditExtra ?? {}) },
    });

  // ── KAPAT: "gerek kalmadı / kendim hallettim" (karar bekleyen, gönderimi doğrulanamayan ya da gönderimi yarıda kalmış kart) ──
  if (input.action === "dismiss") {
    const res = await prisma.decisionRequest.updateMany({
      where: {
        id: decision.id,
        organizationId,
        version: input.version,
        OR: [
          { status: { in: ["pending", "send_unverified"] } },
          // Gönderim sırasında süreç düştü: kart "doğrulanamadı" görünür; taze gönderim (sürüyor) KAPATILAMAZ.
          { status: "sending", updatedAt: { lt: new Date(now.getTime() - DECISION_SENDING_STALE_MS) } },
        ],
      },
      data: { status: "dismissed", decidedById: actor.userId, decidedAt: now, version: { increment: 1 } },
    });
    if (res.count !== 1) return conflict("stale", DECISION_STALE_TEXT);
    if (decision.itemId) {
      await applyItemEvent(prisma, { organizationId, ids: [decision.itemId], event: "host_done", now });
    }
    await audit("decision.dismissed");
    return { kind: "dismissed" };
  }

  // ── ONAYLA / REDDET ──
  if (decision.status !== "pending" || decision.version !== input.version) {
    return conflict("stale", DECISION_STALE_TEXT);
  }
  const body = input.body?.trim() ?? "";
  if (!body) return { kind: "bad_request", field: "body", error: "Misafire gidecek mesaj boş olamaz." };
  const approve = input.action === "approve";
  const time = approve ? parseHostTime(input.time) : null;
  if (approve && TEXT_DECISION_KINDS.has(decision.kind) && !time) return { kind: "bad_request", field: "time", error: "Geçerli bir saat seçin." };
  // Standardın yanlış tarafındaki onay ("16:00 erken giriş" — standart 15:00) misafiri yanıltır; arayüz göndermez, uç da kabul etmez.
  const standard = decision.kind === "early_checkin" ? conversation.property.checkInTime : conversation.property.checkOutTime;
  if (approve && time && timeOnRightSide(decision.kind, time, standard) === false) {
    return {
      kind: "bad_request",
      field: "time",
      error:
        decision.kind === "early_checkin"
          ? `Bu saat standart giriş saatinizden (${standard}) erken değil.`
          : `Bu saat standart çıkış saatinizden (${standard}) geç değil.`,
    };
  }

  // Yeniden doğrulama — göndermeden HEMEN önce.
  if (/cancel/i.test(conversation.reservation?.status ?? "")) {
    return conflict("reservation_cancelled", "Rezervasyon iptal edilmiş; misafire karar mesajı gönderilmedi.");
  }
  const tz = orgTimezone(conversation.property.organization.timezone);
  // Gün CANLI (rezervasyon değiştiyse kartın kayıtlı günü değil, bugünkü tarihi — sayfadaki kartla aynı kural).
  const res = conversation.reservation;
  const dayKey = liveDecisionDayKey(
    { kind: decision.kind, dayKey: decision.dayKey, reservationId: decision.reservationId },
    res
      ? { id: res.id, arrivalKey: calendarDateOf(res.arrivalDate, tz).key, departureKey: calendarDateOf(res.departureDate, tz).key }
      : null,
  );
  if (dayKey && dayKey < todayKey(now, tz)) {
    return conflict("expired", "Talep edilen gün geçti; misafire karar mesajı gönderilmedi.");
  }
  const requestMessage = await prisma.message.findFirst({
    where: { id: decision.messageId, conversationId: id },
    select: { createdAt: true },
  });
  // Talebin mesajı bulunamazsa (birleştirmede ayıklanmış kopya) çapa kartın açıldığı an — kontrol atlanmaz.
  const anchor = requestMessage?.createdAt ?? decision.createdAt;
  const latestGuest = await prisma.message.findFirst({
    where: { conversationId: id, direction: "inbound", createdAt: { gt: anchor } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (latestGuest && latestGuest.id !== input.seenMessageId) {
    return conflict("guest_wrote_again", "Misafir bu talepten sonra yeniden yazdı. Mesajı okuyun, sonra tekrar gönderin.", {
      latestMessageId: latestGuest.id,
    });
  }

  // Olgular değişti mi: kart, sayfayla AYNI kurucudan yeniden kurulur (mesajlar iz dışı). İz yoksa (eski istemci) kontrol atlanır.
  // Aynı kart metin denetiminin de dayanağıdır (yapay zekâ metni anahtarı açıkken).
  const textCheckOn = decisionAiTextEnabled() && TEXT_DECISION_KINDS.has(decision.kind);
  if (input.factsHash || textCheckOn) {
    const views = await listConversationDecisions(prisma, { organizationId, conversationId: id, timeZone: tz, now });
    const view = views.find((v) => v.id === decision.id);
    const ctx = await decisionCardContextFor({
      organizationId,
      conversation: { ...conversation, messages: [] },
      timeZone: tz,
      now,
      needsEarlyRule: decision.kind === "early_checkin",
    });
    const [fresh] = view ? await buildDecisionCards([view], ctx) : [];
    if (input.factsHash && (!fresh || fresh.factsHash !== input.factsHash)) {
      return conflict("facts_changed", "Bu talebin kontrol listesi siz baktıktan sonra değişti. Güncel hâline bakıp tekrar karar verin.");
    }
    // KOD DENETİMİ (Sabah Kararları 62 h): saat / gün / ücret karar kaydıyla eşleşmeli — ev sahibinin düzenlediği metin dahil.
    // Uyuşmazsa gitmez, sade uyarı döner; ev sahibi "Yine de gönder" derse (`force`) gider ve denetim kaydına işlenir.
    if (textCheckOn && fresh && input.force !== true) {
      const facts = {
        kind: decision.kind,
        resolution: approve ? ("approve" as const) : ("decline" as const),
        lang: input.lang ?? fresh.lang,
        dayKey,
        time,
        requestedTime: fresh.requestedTime,
        standardTime: fresh.standardTime,
        fee: input.includeFee === false ? null : fresh.fee,
        note: input.includeNote === false ? null : fresh.note,
        checklist: fresh.lines.map((l) => l.text),
      };
      const check = checkDecisionText(body, facts);
      if (!check.ok) {
        return conflict("text_mismatch", "Mesaj karar kaydınızla uyuşmuyor. Düzeltin ya da yine de gönderin.", {
          problems: decisionTextProblemsTr(check, facts),
        });
      }
    }
  }

  // Kilit (CAS): yalnız bu sürümdeki BEKLEYEN kart gönderime geçer. Onayın saati ve karar veren HEMEN yazılır (gönderim sürerken
  // komşu konaklamanın kartı / erken giriş kontrolü onu görür — ret saat taşımaz; kesin hatada geri alınır).
  const lock = await prisma.decisionRequest.updateMany({
    where: { id: decision.id, organizationId, status: "pending", version: input.version },
    data: { status: "sending", decidedTime: time, decidedById: actor.userId, decidedAt: now, version: { increment: 1 } },
  });
  if (lock.count !== 1) return conflict("stale", DECISION_STALE_TEXT);
  const lockedVersion = input.version + 1;
  const reopen = () =>
    prisma.decisionRequest.updateMany({
      where: { id: decision.id, organizationId, status: "sending", version: lockedVersion },
      data: { status: "pending", decidedTime: null, decidedById: null, decidedAt: null, version: { increment: 1 } },
    });
  const settle = (status: "approved" | "declined" | "send_unverified", resultMessageId: string | null) =>
    prisma.decisionRequest.updateMany({
      where: { id: decision.id, organizationId, status: "sending", version: lockedVersion },
      data: { status, resultMessageId, version: { increment: 1 } },
    });
  // Mesaj misafire ulaşmış OLABİLİR: kart "gönderim doğrulanamadı" (kör tekrar yok — ev sahibi kanaldan bakar).
  const unverified = async (why: string): Promise<DecideOutcome> => {
    const fin = await settle("send_unverified", null).catch(() => ({ count: 0 }));
    if (decision.itemId) {
      await applyItemEvent(prisma, { organizationId, ids: [decision.itemId], event: "host_done", now }).catch(() => {});
    }
    await audit(approve ? "decision.approved" : "decision.declined", { delivery: "unverified", why, ...(fin.count === 1 ? {} : { finalize: "lost" }) });
    return { kind: "unverified", error: DECISION_UNVERIFIED_TEXT };
  };

  let sent: Awaited<ReturnType<typeof sendHostMessage>>;
  try {
    sent = await sendHostMessage({
      organizationId,
      conversation,
      body,
      claimBody: body,
      senderName: actor.name,
      // Kurucu kararı 10-07 (Sabah Kararları 62 / 6): karar mesajı raporda YALNIZ "ev sahibi yazdı" — varsayılanda "yapay zekâ
      // destekli" etiketi YOK. (Ayarlardan açılan etiket — 62 / 7 — yalnız düzenlenmemiş metne yazılır: `edited` bunun için gelir.)
      aiAssisted: false,
      idempotencyKey: `decision:${decision.id}:v${lockedVersion}`,
      strictIdempotency: true,
    });
  } catch (err) {
    // Gönderim sırasında hata: teslim olmuş ama kaydedilememiş olabilir (kanal kabul etti, veritabanı yazamadı) → yeniden açmak
    // ikinci bir mesaja yol açardı.
    void reportError(`host-decisions send org=${organizationId}`, err);
    return unverified("error");
  }

  if (sent.status === "failed_ambiguous") return unverified("ambiguous");
  // Aynı metin az önce gitti / hâlâ gidiyor (başka yoldan): misafir onu görmüş olabilir.
  if (sent.status === "duplicate") return unverified("duplicate");
  // Bu kilidin kimliğiyle kuyrukta başka bir içerik var: o gönderim sürüyor olabilir.
  if (sent.status === "idempotency_conflict") return unverified("idempotency_conflict");

  if (sent.status === "sent" || sent.status === "queued") {
    const resultMessageId = sent.message?.id ?? null;
    const fin = await settle(approve ? "approved" : "declined", resultMessageId);
    if (decision.itemId) {
      await applyItemEvent(prisma, { organizationId, ids: [decision.itemId], event: "host_done", now });
    }
    // Mesaj gitti; kart o arada başka bir yoldan değiştiyse (yarıda kalan gönderim sayılıp kapatıldı) sonuç yine "gitti"dir.
    await audit(approve ? "decision.approved" : "decision.declined", {
      ...(fin.count === 1 ? {} : { finalize: "lost" }),
      ...(textCheckOn && input.force === true ? { textCheck: "overridden" } : {}),
    });
    return { kind: "done", status: approve ? "approved" : "declined", resultMessageId, queued: sent.status === "queued" };
  }

  // Kesin olumsuz sonuçlar: hiçbir şey gitmedi → kart yeniden açılır (ev sahibi düzeltip tekrar dener). Yeni sürüm sonuçta döner:
  // istemci bir sonraki denemede onu gönderir (yoksa her yeniden deneme önce "kart değişti" ile düşerdi).
  const reopened = await reopen();
  const version = reopened.count === 1 ? lockedVersion + 1 : undefined;
  switch (sent.status) {
    case "not_connected":
      return { kind: "failed", httpStatus: 502, error: "Kanal hesabınız bağlı değil — mesaj gönderilemiyor. Ayarlar'dan bağlantınızı kurun.", version };
    case "claim_unavailable":
      return { kind: "failed", httpStatus: 503, error: "Şu anda gönderilemedi — lütfen birazdan tekrar deneyin.", version };
    case "failed_definitive":
      return {
        kind: "failed",
        httpStatus: 502,
        error: providerErrorMessageFromText(sent.error, "Mesaj gönderilemedi. Lütfen kısa bir süre sonra tekrar deneyin."),
        version,
      };
  }
}
