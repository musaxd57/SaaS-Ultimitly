// ---------------------------------------------------------------------------
// KANAL BAĞLANTISI SAĞLIĞI — sağlayıcıdan BAĞIMSIZ (V0 §2f, kurucu talimatı değişmez 9; kurucu 09-23: "bağlantı sağlığı gibi yüzeyler
// ChannelConnection üzerine kurulur", Hospitable'a özgü ekran YOK). Girdi yalnız bağlantı satırının okuma kaydı (migration 60 C:
// `lastReadOkAt / lastReadErrorAt / lastReadErrorKind`, yazıcı `CHANNEL_METADATA_WRITE` arkasında). Saf modül (DB yok); metin ev sahibine
// gider (sade — teknik sözcük yok, ne yapacağı söylenir), misafire GİTMEZ. Ölçüm yoksa "bilinmiyor" — hiçbir şey çizilmez (sahte "sağlıklı" yok).
// ---------------------------------------------------------------------------

import type { IngestErrorKind } from "./ingest";

/** Senkron 2 dakikada bir koşar; bu süreden eski son başarılı okuma "bayat" sayılır (birkaç kaçırılmış tur payı). */
export const CONNECTION_STALE_MINUTES = 30;

export type ConnectionHealthState = "unknown" | "ok" | "stale" | "error";

export interface ConnectionHealth {
  state: ConnectionHealthState;
  /** Son başarılı okumadan bu yana dakika (yoksa null). */
  minutesSinceOk: number | null;
  /** Son hatalı okumanın türü (yalnız `error`). */
  errorKind: IngestErrorKind | null;
}

/** Hata türünün ev sahibine anlatımı (ne oldu + ne yapmalı; sade). */
export const CONNECTION_ERROR_TEXT: Record<IngestErrorKind, string> = {
  auth_revoked: "bağlantı yetkisi düştü — yeniden bağlanın",
  blocked: "kanal hesabınızın aboneliği etkin değil — kanal hesabınızdan kontrol edin",
  rate_limited: "kanal geçici olarak yavaşlattı — kendiliğinden düzelir",
  outage: "kanal şu an yanıt vermiyor — kendiliğinden düzelir",
  not_found: "kanalda kayıt bulunamadı — bağlantıyı kontrol edin",
  no_credential: "bağlantı bilgisi yok — yeniden bağlanın",
  unsupported: "bu kanal bu işlemi henüz desteklemiyor",
  unknown: "beklenmeyen bir hata oluştu — tekrar denenecek",
};

/** Kendi kendine düzelen (geçici) hata türleri — bayat olmadıkça uyarı satırı açmaz. */
const TRANSIENT: ReadonlySet<IngestErrorKind> = new Set(["rate_limited", "outage", "unknown"]);

/**
 * Bağlantı satırının okuma kaydından sağlık. Son olay hata ise `error` (son başarılı okuma hatadan önceyse ya da hiç yoksa); son olay
 * başarı ise yaşına göre `ok` / `stale`; hiç ölçüm yoksa `unknown`.
 */
export function connectionHealth(
  row: { lastReadOkAt: Date | null; lastReadErrorAt: Date | null; lastReadErrorKind: string | null },
  now: Date,
): ConnectionHealth {
  const minutesSinceOk = row.lastReadOkAt ? Math.max(0, Math.floor((now.getTime() - row.lastReadOkAt.getTime()) / 60_000)) : null;
  const errorIsLatest = row.lastReadErrorAt !== null && (row.lastReadOkAt === null || row.lastReadErrorAt > row.lastReadOkAt);
  if (errorIsLatest) {
    const kind = (row.lastReadErrorKind ?? "unknown") as IngestErrorKind;
    return { state: "error", minutesSinceOk, errorKind: kind in CONNECTION_ERROR_TEXT ? kind : "unknown" };
  }
  if (minutesSinceOk === null) return { state: "unknown", minutesSinceOk: null, errorKind: null };
  return { state: minutesSinceOk > CONNECTION_STALE_MINUTES ? "stale" : "ok", minutesSinceOk, errorKind: null };
}

/**
 * Dikkat Gerektirenler'e girmeli mi: kalıcı hata hemen; geçici hata ya da hiç hata olmadan bayat okuma yalnız son başarılı okuma
 * BAYATSA (geçici hıçkırık satır açmasın).
 */
export function connectionNeedsAttention(h: ConnectionHealth): boolean {
  if (h.state === "error") {
    if (h.errorKind && !TRANSIENT.has(h.errorKind)) return true;
    return h.minutesSinceOk === null || h.minutesSinceOk > CONNECTION_STALE_MINUTES;
  }
  return h.state === "stale";
}

/** "3 dk önce" / "2 sa önce" / "3 gün önce". */
export function agoLabel(minutes: number): string {
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

/** Ayarlar satırı metni (yalnız ölçüm varsa; `unknown` → null, hiçbir şey çizilmez). */
export function connectionHealthText(h: ConnectionHealth): string | null {
  if (h.state === "unknown") return null;
  if (h.state === "error") {
    const last = h.minutesSinceOk !== null ? ` · son başarılı senkron ${agoLabel(h.minutesSinceOk)}` : "";
    return `Son senkron başarısız: ${CONNECTION_ERROR_TEXT[h.errorKind ?? "unknown"]}${last}`;
  }
  const when = agoLabel(h.minutesSinceOk ?? 0);
  return h.state === "stale" ? `Son başarılı senkron ${when} — yeni mesajlar gecikebilir` : `Son başarılı senkron ${when}`;
}
