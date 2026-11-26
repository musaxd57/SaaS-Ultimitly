import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// TAKİP NUMARASI (correlation ID — kurucu kararı 10-10, `docs/TASARIM-2026-10-10-correlation-id-takip-numarasi.md` §5). YAPRAK modül
// (yalnız Node yerleşikleri): sunucu rotaları, `report-error-core` ve tsx altında koşan operatör betikleri aynı kaynağı kullanır.
//
// Bir işlem = bir numara. Numara YALNIZ SUNUCUDA üretilir — istemcinin gönderdiği başlık / gövde değeri KABUL EDİLMEZ (başkasının
// zincirine satır yazdırılamaz, log zehirlenmez). Ödeme zinciri tek istisna değil: webhook numarayı Paddle'ın taşıdığı istemci
// verisinden değil, sunucunun yazdığı onay kaydından okur (`billing/correlation.ts`).
// ---------------------------------------------------------------------------

export interface CorrelationContext {
  id: string;
  /** Oturumdan gelen işletme (olay günlüğü satırının sahibi); sistem işinde yok. */
  organizationId: string | null;
  /**
   * Numara kullanıcıya (hata ekranında) GÖSTERİLEBİLİR mi — kurucu kararı 10-12 sabah: "yalnız ödeme ekranında" (`/api/billing/*`).
   * Göstermediğimiz istekte numara yine günlük / Sentry / alarm e-postası / yanıt başlığında durur.
   */
  showToUser?: boolean;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Ekranda gösterilen kısa biçim: ilk 8 onaltılık karakter (operatör araması bu ön ekle de bulur). */
const SHORT_ID = /^[0-9a-f]{8}$/;

export function newCorrelationId(): string {
  return randomUUID();
}

/** Tam numara biçimi (UUID v4, küçük harf). */
export function isCorrelationId(v: unknown): v is string {
  return typeof v === "string" && UUID_V4.test(v);
}

/** Kısa numara biçimi (ekrandaki 8 karakter). */
export function isShortCorrelationId(v: unknown): v is string {
  return typeof v === "string" && SHORT_ID.test(v);
}

export function shortCorrelationId(id: string): string {
  return id.slice(0, 8);
}

/**
 * İşletmesiz (sistem) arka plan işini YENİ bir numarayla koşturur (zamanlanmış senkron geçişi, kuyruk boşaltımı). Çağıranın numarasını
 * MİRAS ALMAZ.
 */
export function runAsNewSystemOperation<T>(fn: () => T): T {
  return storage.run({ id: newCorrelationId(), organizationId: null, showToUser: false }, fn);
}

/** `fn`i verilen numarayla koşturur; içindeki her `await` zinciri numarayı görür, eşzamanlı istekler birbirininkini görmez. */
export function runWithCorrelation<T>(ctx: CorrelationContext, fn: () => T): T {
  return storage.run({ id: ctx.id, organizationId: ctx.organizationId, showToUser: ctx.showToUser === true }, fn);
}

export function currentCorrelation(): CorrelationContext | null {
  return storage.getStore() ?? null;
}

export function currentCorrelationId(): string | null {
  return storage.getStore()?.id ?? null;
}

/** Süren işlemin numarası kullanıcıya gösterilebilir mi (yalnız ödeme ekranı — kurucu kararı 10-12 sabah). */
export function correlationShownToUser(): boolean {
  return storage.getStore()?.showToUser === true;
}

/** Takip numarasının ekranda gösterildiği API yolu (kurucu kararı 10-12 sabah: "yalnız ödeme ekranında"). TEK kaynak. */
export const USER_VISIBLE_CORRELATION_PREFIX = "/api/billing/";

/**
 * Süren işlemi sunucunun ÖNCEDEN ürettiği bir zincire bağlar (ödeme webhook'u → onay kaydının numarası). Yalnız geçerli biçimdeki
 * numara kabul edilir; bağlam yoksa etkisiz. Çağıran numarayı yalnız sunucunun yazdığı satırdan okur.
 */
export function adoptCorrelation(id: string, organizationId?: string | null): boolean {
  const store = storage.getStore();
  if (!store || !isCorrelationId(id)) return false;
  store.id = id;
  if (organizationId !== undefined) store.organizationId = organizationId;
  return true;
}
