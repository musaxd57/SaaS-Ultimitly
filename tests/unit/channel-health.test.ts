import { describe, it, expect } from "vitest";
import {
  CONNECTION_ERROR_TEXT,
  CONNECTION_STALE_MINUTES,
  agoLabel,
  connectionHealth,
  connectionHealthText,
  connectionNeedsAttention,
} from "@/lib/channels/health";

// ---------------------------------------------------------------------------
// Kanal bağlantısı sağlığı — sağlayıcıdan BAĞIMSIZ (V0 §2f, değişmez 9). Girdi yalnız bağlantı satırının okuma kaydı; ölçüm yoksa
// "bilinmiyor" ve HİÇBİR ŞEY çizilmez (sahte "sağlıklı" yok). Geçici hıçkırık uyarı satırı açmaz; kalıcı hata hemen açar.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-10T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const row = (ok: number | null, err: number | null, kind: string | null = null, ageMin: number | null = null) => ({
  lastReadOkAt: ok === null ? null : ago(ok),
  lastReadErrorAt: err === null ? null : ago(err),
  lastReadErrorKind: kind,
  createdAt: ageMin === null ? null : ago(ageMin),
});

describe("connectionHealth", () => {
  it("KONTROL: ölçüm yok → bilinmiyor; metin YOK; uyarı yok", () => {
    const h = connectionHealth(row(null, null), NOW);
    expect(h).toEqual({ state: "unknown", minutesSinceOk: null, errorKind: null, ageMinutes: null });
    expect(connectionHealthText(h)).toBeNull();
    expect(connectionNeedsAttention(h)).toBe(false);
  });

  it("taze başarılı okuma → sağlıklı; eskisi bayat (sınırda değil, sınırdan SONRA)", () => {
    expect(connectionHealth(row(3, null), NOW).state).toBe("ok");
    expect(connectionHealth(row(CONNECTION_STALE_MINUTES, null), NOW).state).toBe("ok");
    expect(connectionHealth(row(CONNECTION_STALE_MINUTES + 1, null), NOW).state).toBe("stale");
    expect(connectionNeedsAttention(connectionHealth(row(CONNECTION_STALE_MINUTES + 1, null), NOW))).toBe(true);
  });

  it("son olay hata → hata (tür korunur); son olay başarı → hata geçmişte kaldı", () => {
    expect(connectionHealth(row(10, 2, "auth_revoked"), NOW)).toMatchObject({ state: "error", minutesSinceOk: 10, errorKind: "auth_revoked" });
    expect(connectionHealth(row(2, 10, "auth_revoked"), NOW).state).toBe("ok");
    expect(connectionHealth(row(null, 5, "blocked"), NOW)).toMatchObject({ state: "error", minutesSinceOk: null, errorKind: "blocked" });
    // Bilinmeyen tür metni "unknown"a düşer (kapalı küme).
    expect(connectionHealth(row(null, 5, "garip"), NOW).errorKind).toBe("unknown");
  });

  it("🚨 uyarı satırı: kalıcı hata HEMEN; geçici hata (yavaşlatma / kesinti) son başarılı okuma tazeyken AÇMAZ, bayatsa açar", () => {
    expect(connectionNeedsAttention(connectionHealth(row(3, 1, "auth_revoked"), NOW))).toBe(true);
    expect(connectionNeedsAttention(connectionHealth(row(3, 1, "blocked"), NOW))).toBe(true);
    expect(connectionNeedsAttention(connectionHealth(row(3, 1, "outage"), NOW))).toBe(false);
    expect(connectionNeedsAttention(connectionHealth(row(3, 1, "rate_limited"), NOW))).toBe(false);
    expect(connectionNeedsAttention(connectionHealth(row(90, 1, "outage"), NOW))).toBe(true);
    // Hiç başarılı okuması yok: taban bağlantının yaşı — YENİ bağlantının ilk geçişindeki geçici hata satır AÇMAZ, eski bağlantıda açar.
    expect(connectionNeedsAttention(connectionHealth(row(null, 1, "outage", 5), NOW))).toBe(false);
    expect(connectionNeedsAttention(connectionHealth(row(null, 1, "outage", 90), NOW))).toBe(true);
    expect(connectionNeedsAttention(connectionHealth(row(null, 1, "outage"), NOW))).toBe(false); // yaş bilinmiyor → açmaz
  });
});

describe("metin (sade; ne oldu + ne yapmalı)", () => {
  it("sağlıklı / bayat / hata metinleri", () => {
    expect(connectionHealthText(connectionHealth(row(3, null), NOW))).toBe("Kanaldan son başarılı okuma 3 dk önce");
    expect(connectionHealthText(connectionHealth(row(150, null), NOW))).toBe("Kanaldan son başarılı okuma 2 sa önce — yeni mesajlar gecikebilir");
    expect(connectionHealthText(connectionHealth(row(10, 2, "auth_revoked"), NOW))).toBe(
      "Kanaldan okuma başarısız: bağlantı yetkisi düştü — yeniden bağlanın · kanaldan son başarılı okuma 10 dk önce",
    );
    expect(connectionHealthText(connectionHealth(row(null, 2, "blocked"), NOW))).toBe(
      "Kanaldan okuma başarısız: kanal hesabınızın aboneliği etkin değil — kanal hesabınızdan kontrol edin",
    );
  });

  it("🚨 bağlantıyı ONARAMAYAN kullanıcıya (yönetici olmayan) 'yeniden bağlanın' değil nötr çağrı", () => {
    expect(connectionHealthText(connectionHealth(row(10, 2, "auth_revoked"), NOW), { canFix: false })).toBe(
      "Kanaldan okuma başarısız: kanal bağlantısında sorun var — işletme sahibinize bildirin · kanaldan son başarılı okuma 10 dk önce",
    );
    // Bayat okuma metni herkese aynı (eylem çağrısı yok).
    expect(connectionHealthText(connectionHealth(row(150, null), NOW), { canFix: false })).toBe(
      "Kanaldan son başarılı okuma 2 sa önce — yeni mesajlar gecikebilir",
    );
  });

  it("her hata türünün metni var ve teknik sözcük / sağlayıcı adı taşımıyor", () => {
    for (const [kind, text] of Object.entries(CONNECTION_ERROR_TEXT)) {
      expect(text.length, kind).toBeGreaterThan(10);
      expect(text, kind).not.toMatch(/hospitable|http|\b40[0-9]\b|token|api/i);
    }
  });

  it("süre etiketi", () => {
    expect(agoLabel(0)).toBe("az önce");
    expect(agoLabel(59)).toBe("59 dk önce");
    expect(agoLabel(60)).toBe("1 sa önce");
    expect(agoLabel(47 * 60)).toBe("47 sa önce");
    expect(agoLabel(72 * 60)).toBe("3 gün önce");
  });

  it("🚨 metin sağlayıcı ADI taşımaz (Hospitable'a özgü yüzey yok — kurucu kuralı)", () => {
    for (const r of [row(3, null), row(150, null), row(10, 2, "auth_revoked"), row(null, 2, "blocked"), row(null, 2, "outage")]) {
      expect(connectionHealthText(connectionHealth(r, NOW)) ?? "").not.toMatch(/hospitable/i);
    }
  });
});
