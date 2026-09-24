// ---------------------------------------------------------------------------
// TEMİZLİK "BİTTİ" → BEKLEYEN ERKEN GİRİŞ İSTEĞİ YENİDEN DEĞERLENDİRİLİR (09-24). Misafir çoğunlukla temizlik
// bitmeden sorar ("12'de gelebilir miyiz?" sabah 9'da); o an akış "temizlik bitmedi / görev yok" diye host'a bırakır
// ve oto-yanıt o mesajı bir daha denemez (damga). Bu tarama, kuralı OTOMATİK olan mülklerde, YALNIZ hazırlık yüzünden
// tutulmuş ve hâlâ cevapsız isteği, "bitti" işareti oturunca (≥5 dk, önceki çıkıştan sonra) BİR KEZ yeniden aday
// yapar. Karar VERMEZ, hiçbir şey GÖNDERMEZ: sonraki oto-yanıt geçişi tüm hattı (model + kapı + akış) baştan koşar.
//
// Döngü koruması: karar kaydı aynı mesaj için ikinci "insana" kararını yazmaz (tekillik anahtarı) — yani "son karar"
// yeniden kontrolden sonra değişmeyebilir. Bu yüzden yeniden kontrol, varış rezervasyonunun giriş hazırlığı görevine
// NOT olarak yazılır (host da görür) ve aynı "bitti" işaretinden sonra ikinci kez yapılmaz. Görev yoksa yeniden kontrol
// de yok (temkinli yön: bugünkü davranış).
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import { EARLY_CHECKIN_CHECKS } from "./core";
import { loadEarlyCheckinFacts } from "./load";
import { READY_SETTLE_MS } from "./readiness";
import { autoEarlyCheckinPropertyIds } from "./rules";

/** Host'un görev geçmişinde görünen not (sade dil) — aynı zamanda döngü korumasının işareti. */
export const EARLY_CHECKIN_RECHECK_NOTE = "Temizlik bitti; bekleyen erken giriş isteği yeniden kontrol ediliyor.";

/**
 * Yalnız bu kontroller düştüyse yeniden değerlendirmeye değer (başka her eksik host'ta kalır). Bekleyen (`pending`)
 * kararda temizlik bitince değişebilenler: hazır değil / bilinmiyor + önceki misafirin beklenen çıkışı (yalnız host
 * "çıkıştan önce hazır" rızası verdiyse bekler — çekirdek o zaman `pending` der). Çıkış saati bilinmiyorsa hazırlık hiç
 * ölçülemez (host). Gelecek varış günü (`not_arrival_day`) ayrı akış (henüz yok). Eski kayıtlar (`needs_host`) yalnız
 * hazırlık kodlarıyla.
 */
const WAITING_ON_READINESS: ReadonlySet<string> = new Set(["not_ready", "ready_unknown", "previous_still_in"]);
const LEGACY_READINESS_ONLY: ReadonlySet<string> = new Set(["not_ready", "ready_unknown"]);
const KNOWN_CHECKS: ReadonlySet<string> = new Set(EARLY_CHECKIN_CHECKS);
const LOOKBACK_MS = 24 * 60 * 60_000;
/** Varış günü her saat diliminde bu pencerenin içindedir (gün anahtarı kodda ayrıca doğrulanır). */
const ARRIVAL_WINDOW_MS = 36 * 60 * 60_000;
const MAX_PER_PASS = 25;

/** Karar kaydının `ec` kanıtı: tutuldu, otomatik gitmedi ve düşen kontrollerin HEPSİ hazırlıkla ilgili mi. Saf. */
export function heldOnlyForReadiness(kbEvidenceJson: string | null | undefined): boolean {
  if (typeof kbEvidenceJson !== "string") return false;
  let ec: unknown;
  try {
    ec = (JSON.parse(kbEvidenceJson) as { ec?: unknown }).ec;
  } catch {
    return false;
  }
  if (!ec || typeof ec !== "object") return false;
  const { s, f, a } = ec as { s?: unknown; f?: unknown; a?: unknown };
  // `pending` (kanıt modeli, 09-24) ya da eski kayıtların `needs_host`u — ikisinde de otomatik gitmemiş olmalı.
  if ((s !== "pending" && s !== "needs_host") || a !== "0" || !Array.isArray(f) || f.length === 0) return false;
  const allowed = s === "pending" ? WAITING_ON_READINESS : LEGACY_READINESS_ONLY;
  return f.every((c) => typeof c === "string" && KNOWN_CHECKS.has(c) && allowed.has(c));
}

/**
 * Org'un otomatik kurallı mülklerinde yalnız hazırlık yüzünden tutulmuş erken giriş isteklerini yeniden aday yapar.
 * Döner: yeniden aday yapılan konuşma sayısı. Hata fırlatabilir (çağıran aşama alarmına bağlar).
 */
export async function recheckEarlyCheckinsAfterCleaning(organizationId: string, now: Date): Promise<number> {
  const propertyIds = await autoEarlyCheckinPropertyIds(organizationId);
  if (propertyIds.length === 0) return 0;

  // Aday kümesi DAR tutulur (açlık olmasın): hazırlık yüzünden tutulmuş karar tanım gereği VARIŞ GÜNÜ verilmiştir →
  // yalnız varışı bugün civarında olan rezervasyonların konuşmaları; en yeni önce (başka sebeple tutulmuş eski
  // konuşmalar tavanı doldurup asıl adayları dışarıda bırakamasın).
  const conversations = await prisma.conversation.findMany({
    where: {
      propertyId: { in: propertyIds },
      property: { organizationId },
      status: "new",
      reservationId: { not: null },
      reservation: { arrivalDate: { gte: new Date(now.getTime() - ARRIVAL_WINDOW_MS), lte: new Date(now.getTime() + ARRIVAL_WINDOW_MS) } },
      autoReplyAttemptedAt: { not: null },
      lastMessageAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
    },
    select: { id: true, propertyId: true, reservationId: true, autoReplyAttemptedAt: true, lastMessageAt: true },
    orderBy: { lastMessageAt: "desc" },
    take: MAX_PER_PASS,
  });

  let reopened = 0;
  for (const c of conversations) {
    // Damga GÜNCEL mesaj için değilse normal geçiş zaten deneyecek.
    if (!c.reservationId || !c.autoReplyAttemptedAt || !c.lastMessageAt || c.autoReplyAttemptedAt < c.lastMessageAt) continue;
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: c.id, direction: "inbound" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (!lastInbound) continue;
    const held = await prisma.riskEvent.findFirst({
      where: { organizationId, surface: "auto_reply", conversationId: c.id, triggerId: lastInbound.id, finalDecision: "human_review" },
      select: { kbEvidenceJson: true, occurredAt: true },
    });
    if (!held || !heldOnlyForReadiness(held.kbEvidenceJson)) continue;

    // Hazırlık ŞİMDİ: aynı yükleyici, aynı kural (önceki çıkıştan sonra, ≥5 dk). Saat/tek konu burada önemsiz — karar
    // yeniden koşan hatta verilir.
    const loaded = await loadEarlyCheckinFacts({
      organizationId,
      propertyId: c.propertyId,
      reservationId: c.reservationId,
      now,
      requested: { time: null, sources: 0, conflict: false },
      singleIntent: false,
    });
    // Karar, işaret OTURMADAN verilmiş olmalı (oturmuş işareti gören karar hazırlık yüzünden tutulamazdı; 5 dk'lık
    // pencerede verilen karar ise "hazır değil" görmüştür ve yeniden değerlendirmeye değer).
    if (!loaded || loaded.facts.readiness !== "ready" || !loaded.readyAt) continue;
    if (loaded.readyAt.getTime() + READY_SETTLE_MS <= held.occurredAt.getTime()) continue;

    const prep = await prisma.task.findFirst({
      where: { reservationId: c.reservationId, propertyId: c.propertyId, type: "checkin_prep" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!prep) continue;
    const already = await prisma.taskUpdate.findFirst({
      where: { taskId: prep.id, note: EARLY_CHECKIN_RECHECK_NOTE, createdAt: { gte: loaded.readyAt } },
      select: { id: true },
    });
    if (already) continue;

    const done = await prisma.$transaction(async (tx) => {
      const claim = await tx.conversation.updateMany({
        where: { id: c.id, status: "new", autoReplyAttemptedAt: c.autoReplyAttemptedAt },
        data: { autoReplyAttemptedAt: null },
      });
      if (claim.count !== 1) return false;
      // Zaman damgası taramanın `now`u: koruma sorgusu (`createdAt ≥ readyAt`) aynı saat ekseninde kıyaslar.
      await tx.taskUpdate.create({ data: { taskId: prep.id, userId: null, note: EARLY_CHECKIN_RECHECK_NOTE, createdAt: now } });
      return true;
    });
    if (done) reopened++;
  }
  return reopened;
}
