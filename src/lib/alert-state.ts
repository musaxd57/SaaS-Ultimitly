import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { IngestError } from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// GEÇİŞ TABANLI ALARM — kalıcı bir arıza için "bir kez", yeniden başlatmaya dayanıklı
// (09-23 olayının SINIF düzeltmesi).
//
// 🚨 ÖLÇÜLEN MEKANİZMA (alarm ajanı, gerçek modülle): `reportError`ın e-posta kısıtı
// SÜREÇ BELLEĞİNDE, bağlam başına 10 dakikadır. 2 dakikalık senkron döngüsünde KALICI
// bir arıza bu yüzden günde ~130 e-posta üretir (tavan 144; her yeniden başlatma +1) ve
// Sentry ayağı hiç kısıtlanmaz (~720 olay/gün). 09-23'te kurucunun gelen kutusunu dolduran
// şey tam buydu; 402 yalnız o günkü TETİKTİ. Aynı akış başka kalıcı durumlarda da
// bekliyordu: env token'ına kalıcı 401 (senkron yolu bilinçli olarak revoke etmez),
// Hospitable kesintisi (her org için saatte 6).
//
// Sözleşme: durum `SystemLock` satırında (`alert-state:<anahtar>`, holder = hata SINIFI,
// lockedUntil = sonraki hatırlatma). MIGRATION YOK — depo aynı tabloyu bu amaçla zaten iki
// yerde kullanıyor (`lifecycle-alarm:*`, `paddle-unmapped-price:*`).
//   · İLK arıza ya da SINIF DEĞİŞİMİ → alarm (e-posta + Sentry) bir kez,
//   · AYNI sınıf sürerken → yalnız log; `remindMs` (24 sa) dolunca bir hatırlatma,
//   · `clearAlertState` (başarı) → satır silinir; sonraki arıza yeniden alarm üretir,
//   · alarm e-postası GİTMEDİYSE (sağlayıcı hatası) hatırlatma 15 dk'ya çekilir,
//   · DB'ye ulaşılamazsa SUSMAZ: eski (bellek-içi kısıtlı) alarm yoluna düşer.
// Hata sınıfı SINIRLI çeşitliliktedir ve mesaj METNİ taşımaz (PII + sınırsız kardinalite).
// ---------------------------------------------------------------------------

const PREFIX = "alert-state:";
/** Aynı arıza sürerken hatırlatma aralığı. */
export const ALERT_REMIND_MS = 24 * 60 * 60 * 1000;
/** Alarm e-postası gönderilemediyse yeniden deneme aralığı. */
export const ALERT_RETRY_AFTER_FAILED_SEND_MS = 15 * 60 * 1000;

/** Hata SINIFI: tip + (varsa) kod/durum. Mesaj metni ASLA girmez. */
export function errorClassOf(err: unknown): string {
  if (err instanceof IngestError) return `ingest:${err.kind}:${err.status ?? "-"}`;
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const status = (err as { status?: unknown }).status;
    return [err.name || "Error", typeof code === "string" ? code : "", typeof status === "number" ? String(status) : ""]
      .filter(Boolean)
      .join(":");
  }
  return `non-error:${typeof err}`;
}

/**
 * Kalıcı bir arızanın alarmını YALNIZ durum geçişinde (ya da hatırlatma zamanı gelince)
 * üretir. `context` e-postanın konusudur (değişmez — kurucu aynı başlığı tanır); `key`
 * durumun kimliğidir (ör. `scheduled-sync:sync:<orgId>`).
 */
export async function alertOnTransition(
  key: string,
  context: string,
  err: unknown,
  opts: { remindMs?: number; now?: Date } = {},
): Promise<"alerted" | "suppressed"> {
  const name = PREFIX + key;
  const cls = errorClassOf(err);
  const now = opts.now ?? new Date();
  const next = new Date(now.getTime() + (opts.remindMs ?? ALERT_REMIND_MS));
  let claimed: boolean;
  try {
    const created = await prisma.systemLock.createMany({
      data: [{ name, lockedUntil: next, holder: cls }],
      skipDuplicates: true,
    });
    claimed =
      created.count === 1 ||
      (
        await prisma.systemLock.updateMany({
          // ⚠️ Prisma'nın `not` filtresi NULL'u DIŞLAR (SQL `<>`) → NULL ayrıca yazılır.
          where: { name, OR: [{ holder: null }, { holder: { not: cls } }, { lockedUntil: { lte: now } }] },
          data: { holder: cls, lockedUntil: next },
        })
      ).count === 1;
  } catch {
    // Durum okunamıyor: susmak yerine eski alarm yoluna düş (fail-open ALARM yönünde).
    await reportError(context, err);
    return "alerted";
  }
  if (!claimed) {
    console.warn(`[alert-state] ${key} hâlâ ${cls} — alarm bastırıldı (durum değişmedi)`);
    return "suppressed";
  }
  const outcome = await reportError(context, err);
  // `?.`: sözleşme her zaman nesne döndürür ama alarm yolu, bozuk bir sonuç yüzünden
  // senkron geçişini DÜŞÜREMEZ (testlerdeki `undefined` döndüren mock'lar da buraya girer).
  if (outcome?.configured === true && outcome.notified === false) {
    // E-posta GİTMEDİ: bu durumu "bildirildi" sayıp 24 saat susmak yanlış olurdu.
    // 🚨 `throttled` DA BURAYA GİRER: `reportError`ın kısıtı CONTEXT başınadır ve birden
    // çok anahtar AYNI context'i paylaşır (ör. senkronun dört aşaması tek
    // "scheduled-sync org <id>" başlığıyla gider). Senkron aşaması e-posta attıktan
    // saniyeler sonra uyarı aşaması YENİ bir arızayla düşerse onun e-postası kısıta
    // takılır; bu dal olmasa o arıza 24 saat boyunca HİÇ bildirilmezdi.
    await prisma.systemLock
      .updateMany({
        where: { name, holder: cls },
        data: { lockedUntil: new Date(now.getTime() + ALERT_RETRY_AFTER_FAILED_SEND_MS) },
      })
      .catch(() => {});
  }
  return "alerted";
}

/** Arıza bitti: bir sonraki arıza yeniden alarm üretsin. Asla fırlatmaz. */
export async function clearAlertState(key: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { name: PREFIX + key } }).catch(() => {});
}

export interface AlertTracker {
  /** Aşama düştü: geçiş tabanlı alarm (`alertOnTransition`). */
  fail(key: string, context: string, err: unknown): Promise<"alerted" | "suppressed">;
  /** Aşama başarılı: bu anahtar alarm hâlindeyse temizle (değilse SORGU YOK). */
  ok(key: string): Promise<void>;
}

/**
 * Bir geçiş (senkron turu, tek org'un senkronu) için izleyici. Başarı yolunun maliyeti
 * sorun değil gibi görünür ama değildir: 2 dakikalık döngüde org × aşama başına koşulsuz
 * bir `deleteMany` günde on binlerce boş yazma demek. Bunun yerine geçiş başında `prefix`
 * altındaki AKTİF durumlar TEK sorguyla okunur; başarı yalnız gerçekten alarm hâlindeki
 * anahtara dokunur. Okuma düşerse (DB sorunlu) bu geçişte temizleme yapılmaz — alarm
 * tarafı yine çalışır, sonraki geçiş temizler.
 */
export async function alertTracker(prefix: string): Promise<AlertTracker> {
  let active: Set<string> | null;
  try {
    const rows = await prisma.systemLock.findMany({
      where: { name: { startsWith: PREFIX + prefix } },
      select: { name: true },
    });
    active = new Set(rows.map((r) => r.name.slice(PREFIX.length)));
  } catch {
    active = null;
  }
  return {
    async fail(key, context, err) {
      const full = prefix + key;
      const outcome = await alertOnTransition(full, context, err);
      active?.add(full);
      return outcome;
    },
    async ok(key) {
      const full = prefix + key;
      if (!active?.has(full)) return;
      active.delete(full);
      await clearAlertState(full);
    },
  };
}

/**
 * Sahipsiz durum satırlarını temizle (silinmiş org'un süren arızası vb.). Hatırlatma her
 * 24 saatte `updatedAt`i tazelediği için yalnız 30 gündür DOKUNULMAMIŞ satırlar gider.
 */
export async function sweepStaleAlertStates(now: Date = new Date()): Promise<number> {
  const r = await prisma.systemLock.deleteMany({
    where: { name: { startsWith: PREFIX }, updatedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
  });
  return r.count;
}
