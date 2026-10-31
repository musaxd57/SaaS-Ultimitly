import "server-only";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ CEVAP TEKRARI — GÖLGE KİP deposu (migration 85; tasarım docs/TASARIM-2026-10-23-dogrulanmis-cevap-tekrari.md §4).
//
// Misafire HİÇBİR ŞEY bu dosyadan gitmez. Taze, doğrulanmış ve GERÇEKTEN gönderilmiş her parçadan sonra:
//  1. ölçüm — aynı daire + aynı tür + aynı dil kayıtlarında bu ihtiyaca KULLANILABİLİR bir kayıt var mıydı (kapı + benzerlik + bugünkü
//     kalemle yeniden doğrulama)? Varsa "isabet"; kayıttaki cevap bu turun taze cevabıyla aynı bilgiyi vermiyorsa "uyuşmazlık" (hedef 0).
//  2. kayıt — aynı ihtiyacın kaydı varsa: aynı bilgi + aynı kalem izi + BAŞKA konuşma → teyit +1 ve kayıtlı metin iki cevabın ortak
//     içeriğine daralır (tek misafirin eklediği cümle kalıcılaşmaz — Opus güvenlik 10-23 F7); aynı konuşmanın tekrarı sayılmaz; değilse
//     kayıt TAZE cevaba sıfırlanır (teyit 1). Yoksa yeni kayıt (teyit 1).
// Anahtar: `AI_ANSWER_REUSE_SHADOW_ENABLED` (yalnız "1"). Hata ana akışı durdurmaz (çağıran yakalar).
// ---------------------------------------------------------------------------

import type { Prisma, PrismaClient } from "@prisma/client";
import { sanitizedReuseQuery } from "@/lib/conversation-items/topic-label";
import {
  REUSE_MAX_AGE_DAYS,
  REUSE_MIN_SIMILARITY,
  confirmAnswer,
  entryEligible,
  guestKey,
  relatedFingerprint,
  revalidateEntry,
  reuseGate,
  sameAnswer,
  type FingerprintItem,
  type ReuseNeed,
} from "./core";

type Db = PrismaClient | Prisma.TransactionClient;

export function answerReuseShadowEnabled(): boolean {
  return process.env.AI_ANSWER_REUSE_SHADOW_ENABLED === "1";
}

/** Kayıtlar bu kadar gün dokunulmadan kalırsa silinir (kalıcı bir misafir izi tutulmaz; içerik zaten 30 günde geçersiz). */
export const REUSE_PURGE_DAYS = 90;

export interface ObservedPart {
  need: ReuseNeed;
  partText: string;
  evidence: string;
  /** "kb:<kalem kimliği>" | "property". */
  sourceRef: string;
}

/** Kayıtta tutulan konuşma izi sayısı tavanı (kararlılık eşiğinin üstü yeter). */
export const REUSE_MAX_CONVERSATION_KEYS = 10;

/** Kayıt başına benzerlik denenecek aday tavanı (Opus 10-23 85 incelemesi: 50 aday × 2 sn gömme sıcak yolu yavaşlatabiliyordu). */
export const REUSE_MAX_CANDIDATES = 10;

export interface ObserveInput {
  organizationId: string;
  propertyId: string;
  /** Bu turun konuşması — aynı konuşmanın ikinci teyidi sayılmaz (tek misafir kendi cevabını "kararlı" yapamaz). */
  conversationId: string;
  /** Misafirin kalıcı olmayan iz bileşenleri (`core.guestKey`): bağımsız teyit MİSAFİR başına sayılır. */
  guest?: { reservationId?: string | null; externalReservationId?: string | null };
  /**
   * Parmak izi kaynakları: dairenin BÜTÜN onaylı + etkin kalemleri (misafirin konaklama durumuna göre süzülmemiş — Opus 10-23 85: süzülmüş
   * listeyle parmak izi misafirden misafire değişip kayıtları birbirine sıfırlatıyordu). Verilmezse `sources`.
   */
  fingerprintSources?: readonly FingerprintItem[];
  parts: readonly ObservedPart[];
  /** Dairenin bugünkü onaylı + etkin kalemleri ve mülk alanları (parmak izi + yeniden doğrulama). `id` = sourceRef biçimi. */
  sources: readonly FingerprintItem[];
  guestNames: readonly (string | null | undefined)[];
  now: Date;
  /** İki Türkçe sorgunun benzerliği (gömme; ulaşılamazsa `null` → yalnız birebir aynı sorgu eşleşir). */
  similarity: (a: string, b: string) => Promise<number | null>;
}

export interface ObserveResult {
  hits: number;
  mismatches: number;
  confirmed: number;
  reset: number;
  created: number;
  skipped: number;
  /** Aynı konuşmadan gelen ikinci teyit (sayılmadı). */
  sameConversation: number;
  /** Aynı bilgi, farklı söyleyiş (teyit de sıfırlama da yok — ölçümde uyuşmazlık sayılmaz). */
  reworded: number;
  /** Eşzamanlı başka bir işçi aynı kaydı değiştirdi (teyit sayılmadı). */
  raced: number;
}

/** Gömme ulaşılamazsa tur boyunca bir daha denenmez (devre kesici; yalnız birebir aynı sorgu eşleşir). */
function similarityOf(input: ObserveInput): (a: string, b: string) => Promise<boolean> {
  let down = false;
  return async (a, b) => {
    if (a === b) return true;
    if (down) return false;
    const s = await input.similarity(a, b).catch(() => null);
    if (s === null) down = true;
    return s !== null && s >= REUSE_MIN_SIMILARITY;
  };
}

/**
 * Anahtardan BAĞIMSIZ süpürge (saatlik iş; Opus 10-23 85 incelemesi: silme yalnız anahtar açıkken yeni gözlemde koşuyordu — anahtar kapanınca
 * ya da daire sessizleşince satırlar sonsuza kalıyordu): 90 gün dokunulmayan kayıt + kaynağı silinmiş ya da kayıttan SONRA değişmiş bilgi
 * tabanı kalemine dayanan kayıt (Wi-Fi şifresi gibi değerin eski kopyası kalmasın).
 */
export async function sweepVerifiedAnswers(db: Db, now: Date = new Date()): Promise<{ purged: number }> {
  const old = await db.verifiedAnswer.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - REUSE_PURGE_DAYS * 86_400_000) } } });
  let purged = old.count;
  const rows = await db.verifiedAnswer.findMany({ where: { sourceRef: { startsWith: "kb:" } }, select: { id: true, sourceRef: true, lastConfirmedAt: true, propertyId: true }, take: 2000 });
  if (rows.length > 0) {
    const ids = [...new Set(rows.map((r) => r.sourceRef.slice(3)))];
    const items = await db.knowledgeBaseItem.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true, isActive: true, propertyId: true } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const stale = rows
      .filter((r) => {
        const k = byId.get(r.sourceRef.slice(3));
        return !k || !k.isActive || k.propertyId !== r.propertyId || k.updatedAt.getTime() > r.lastConfirmedAt.getTime();
      })
      .map((r) => r.id);
    if (stale.length > 0) purged += (await db.verifiedAnswer.deleteMany({ where: { id: { in: stale } } })).count;
  }
  return { purged };
}

/** Gölge ölçüm + kayıt (bkz. dosya başı). Yalnız mülke ait kayıtlara dokunur (org + mülk kapsamı her sorguda). */
export async function observeVerifiedParts(db: Db, input: ObserveInput): Promise<ObserveResult> {
  const out: ObserveResult = { hits: 0, mismatches: 0, confirmed: 0, reset: 0, created: 0, skipped: 0, sameConversation: 0, reworded: 0, raced: 0 };
  const convKey = guestKey({ conversationId: input.conversationId, ...(input.guest ?? {}) });
  const similar = similarityOf(input);
  const fpSources = input.fingerprintSources ?? input.sources;
  const scope = { organizationId: input.organizationId, propertyId: input.propertyId };
  await db.verifiedAnswer
    .deleteMany({ where: { ...scope, updatedAt: { lt: new Date(input.now.getTime() - REUSE_PURGE_DAYS * 86_400_000) } } })
    .catch(() => {});
  const sourceText = (ref: string) => input.sources.find((s) => s.id === ref)?.text ?? null;
  for (const p of input.parts) {
    const query = sanitizedReuseQuery(p.need.query, input.guestNames);
    // Alıntı da taranır: istemdeki kalem yer tutucusu doldurulmuş olabilir ("Hoş geldiniz {misafir}") → misafirin adı kayda girmez.
    if (!query || entryEligible(p.need, `${p.partText}\n${p.evidence}`, input.guestNames) !== "ok") {
      out.skipped += 1;
      continue;
    }
    const need: ReuseNeed = { ...p.need, query };
    const fingerprint = relatedFingerprint(fpSources, query);
    const rows = await db.verifiedAnswer.findMany({
      where: { ...scope, kind: need.kind, language: need.language, disabledAt: null },
      // Kararlı kayıt önce (Haiku 10-23 gece-3: yalnız son teyit sırası 3 teyitli kaydı 10 yeni söyleyişin arkasına itiyordu).
      orderBy: [{ confirmations: "desc" }, { lastConfirmedAt: "desc" }],
      take: REUSE_MAX_CANDIDATES,
    });
    // Aynı ihtiyacın kaydı: kapı (soru + kayıtlı cevap) + benzerlik.
    let match: (typeof rows)[number] | null = null;
    for (const r of rows) {
      const cached: ReuseNeed = { kind: r.kind, query: r.query, language: r.language };
      if (reuseGate(cached, need, r.partText) !== "ok") continue;
      if (!(await similar(r.query, query))) continue;
      match = r;
      break;
    }
    if (match) {
      // ① Ölçüm: kayıt bu ihtiyaca BUGÜN kullanılabilir miydi?
      const usable = revalidateEntry(
        {
          need: { kind: match.kind, query: match.query, language: match.language },
          partText: match.partText,
          evidence: match.evidence,
          sourceId: match.sourceRef,
          fingerprint: match.fingerprint,
          confirmations: match.confirmations,
          createdAt: match.createdAt,
        },
        { sourceText: sourceText(match.sourceRef), otherSources: input.sources.filter((s) => s.id !== match!.sourceRef).map((s) => s.text), fingerprint, now: input.now },
        need,
      );
      const verdict = confirmAnswer(match.partText, p.partText);
      // Ölçümde "aynı cevap" = aynı BİLGİ (değerler + olumluluk); söyleyiş farkı uyuşmazlık değildir (Opus 10-23 85 incelemesi).
      const agrees = sameAnswer(match.partText, p.partText);
      if (usable.ok) {
        if (agrees) out.hits += 1;
        else out.mismatches += 1;
      }
      // ② Kayıt: aynı bilgi + aynı iz + süresi dolmamış + BAŞKA konuşma → teyit (metin ortak içeriğe daralır); aynı konuşmanın tekrarı
      // sayılmaz; değilse taze cevaba sıfırla.
      const fresh = input.now.getTime() - match.createdAt.getTime() <= REUSE_MAX_AGE_DAYS * 86_400_000;
      if (verdict.same && match.fingerprint === fingerprint && fresh) {
        if (match.conversationKeys.includes(convKey)) {
          out.sameConversation += 1;
          continue;
        }
        // Koşullu güncelleme (Opus 10-23 85 incelemesi: iki işçi aynı anda +1 yapıyor, yalnız birinin izi kalıyordu): okunan teyit sayısı
        // değişmediyse ve bu misafirin izi yoksa.
        const updated = await db.verifiedAnswer.updateMany({
          where: { id: match.id, ...scope, confirmations: match.confirmations, NOT: { conversationKeys: { has: convKey } } },
          data: {
            confirmations: { increment: 1 },
            partText: verdict.text,
            ...(verdict.text === p.partText ? { evidence: p.evidence, sourceRef: p.sourceRef } : {}),
            conversationKeys: [...match.conversationKeys, convKey].slice(-REUSE_MAX_CONVERSATION_KEYS),
            lastConfirmedAt: input.now,
            ...(usable.ok ? { shadowHits: { increment: 1 }, lastHitAt: input.now } : {}),
          },
        });
        if (updated.count === 0) out.raced += 1;
        else out.confirmed += 1;
      } else if (agrees && match.fingerprint === fingerprint && fresh) {
        // Aynı bilgi, farklı söyleyiş: kayıt korunur (sıfırlanırsa iki söyleyişli soru kaydı sonsuza dek teyit 1'de kalırdı), teyit sayılmaz;
        // kullanılabilir kayıt ölçümde isabettir.
        out.reworded += 1;
        if (usable.ok) {
          await db.verifiedAnswer.updateMany({ where: { id: match.id, ...scope }, data: { shadowHits: { increment: 1 }, lastHitAt: input.now } });
        }
      } else {
        await db.verifiedAnswer.updateMany({
          where: { id: match.id, ...scope },
          data: {
            query,
            partText: p.partText,
            evidence: p.evidence,
            sourceRef: p.sourceRef,
            fingerprint,
            confirmations: 1,
            conversationKeys: [convKey],
            createdAt: input.now,
            lastConfirmedAt: input.now,
            ...(usable.ok && !agrees ? { shadowMismatches: { increment: 1 }, lastHitAt: input.now } : {}),
          },
        });
        out.reset += 1;
      }
      continue;
    }
    await db.verifiedAnswer.create({
      data: {
        ...scope,
        kind: need.kind,
        language: need.language,
        query,
        partText: p.partText,
        evidence: p.evidence,
        sourceRef: p.sourceRef,
        fingerprint,
        conversationKeys: [convKey],
        lastConfirmedAt: input.now,
        createdAt: input.now,
      },
    });
    out.created += 1;
  }
  return out;
}
