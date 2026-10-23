import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ CEVAP TEKRARI — saf çekirdek (kurucu fikri 10-23 + Codex notu). Örnekler Codex'in yazdıklarından: "Çıkış kaçta?" ile
// "13:00'te çıkabilir miyiz?" ayrılmalı; "Çöpleri nereye atıyoruz?" ile "Cam şişeler için ayrı kutu var mı?" farklı; "Otopark var mı?"
// cevabı ücret sorusuna verilmez; eski kayıt değişmeden YENİ istisna kalemi eklenirse kayıt geçersiz; tekrar sayısı doğruluk değildir.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import {
  REUSE_STABLE_COUNT,
  entryEligible,
  relatedFingerprint,
  revalidateEntry,
  reuseGate,
  sameAnswer,
  type ReuseEntry,
  type ReuseNeed,
} from "@/lib/answer-reuse/core";

const tr = (kind: string, query: string, extra: Partial<ReuseNeed> = {}): ReuseNeed => ({ kind, query, language: "tr", ...extra });

describe("kapı — aynı ihtiyaç mı", () => {
  it("aynı ihtiyaç başka sözcükle: çıkış saati (cevap 11:00) → ok", () => {
    expect(reuseGate(tr("checkout_time", "çıkış saati"), tr("checkout_time", "çıkış saati kaçta"), "Çıkış saati 11:00.")).toBe("ok");
  });

  it("🚨 karar isteyen istek asla tekrar kullanılmaz: geç çıkış / 13:00'te çıkış (konaklama değişikliği)", () => {
    expect(reuseGate(tr("checkout_time", "çıkış saati"), tr("late_checkout", "geç çıkış"), "Çıkış saati 11:00.")).toBe("kind_not_reusable");
    expect(reuseGate(tr("checkout_time", "çıkış saati"), tr("checkout_time", "çıkış saati 13:00", { stayChange: true }), "Çıkış saati 11:00.")).toBe("stay_change");
  });

  it("🚨 benzeyen ama farklı alt soru: çöp yeri ≠ cam şişe geri dönüşümü; Wi-Fi şifresi ≠ ağ adı; köpek ≠ kedi", () => {
    expect(reuseGate(tr("trash", "çöp atma yeri"), tr("trash", "cam şişe geri dönüşüm kutusu"), "Çöpleri bina girişindeki konteynere atabilirsiniz.")).toBe(
      "terms_not_covered",
    );
    expect(reuseGate(tr("wifi", "wifi şifresi"), tr("wifi", "wifi ağ adı"), "Wi-Fi şifresi Lale2025.")).toBe("terms_not_covered");
    expect(reuseGate(tr("pets", "evcil hayvan köpek kabul"), tr("pets", "evcil hayvan kedi kabul"), "Köpek kabul edilmez.")).toBe("terms_not_covered");
  });

  it("🚨 soru yönü cevapta yoksa kullanılmaz: 'otopark ücretli mi' ← 'otopark var' cevabı; 'kahvaltı kaçta' ← 'kahvaltı dahil' cevabı", () => {
    expect(reuseGate(tr("parking", "otopark var mı"), tr("parking", "otopark ücret"), "Binanın önünde otopark var.")).not.toBe("ok");
    expect(reuseGate(tr("amenities", "kahvaltı var mı"), tr("amenities", "kahvaltı saati"), "Kahvaltı fiyata dahildir.")).toBe("aspect_not_answered");
    // Cevap o yönü taşıyorsa olur (saat değeri var).
    expect(reuseGate(tr("amenities", "kahvaltı var mı"), tr("amenities", "kahvaltı saati"), "Kahvaltı 08:00-10:30 arası verilir.")).toBe("ok");
  });

  it("anlama katmanının iskele sözcükleri ihtiyacı ayırmaz ('… kabul POLİTİKASI', '… konteyneri YERİ') — ölçümde yanlış ret", () => {
    expect(reuseGate(tr("pets", "evcil hayvan kabul"), tr("pets", "evcil hayvan kabul politikası"), "Evcil hayvan kabul edilmez.")).toBe("ok");
    expect(reuseGate(tr("trash", "çöp konteyneri"), tr("trash", "çöp konteyneri yeri"), "Çöpleri bina girişindeki konteynere atabilirsiniz.")).toBe("ok");
  });

  it("🚨 ters yön: kayıt somut bir konu adıyorsa ('köpek') genel soruya ('evcil hayvan kabul politikası') verilmez", () => {
    expect(reuseGate(tr("pets", "evcil hayvan köpek kabul"), tr("pets", "evcil hayvan kabul politikası"), "Köpek kabul edilmez.")).toBe("terms_not_covered");
  });

  it("koşul farklıysa (cumartesi) ilk sürümde kullanılmaz; dil farklıysa kullanılmaz", () => {
    expect(reuseGate(tr("amenities", "havuz kapanış saati"), tr("amenities", "havuz cumartesi kapanış saati"), "Havuz 20:00'de kapanır.")).toBe(
      "condition_mismatch",
    );
    expect(reuseGate(tr("checkout_time", "çıkış saati"), { kind: "checkout_time", query: "çıkış saati", language: "en" }, "Çıkış saati 11:00.")).toBe(
      "language_mismatch",
    );
  });

  it("şikâyet / kod / ödeme türleri kayda girmez ve tekrar kullanılmaz", () => {
    for (const kind of ["complaint_issue", "access_keys", "payment_invoice", "emergency", "about_assistant", "local_recommendations"]) {
      expect(reuseGate(tr(kind, "x"), tr(kind, "x"), "x")).toBe("kind_not_reusable");
      expect(entryEligible(tr(kind, "x"), "x")).toBe("kind_not_reusable");
    }
  });
});

describe("kayıt adaylığı + kararlılık", () => {
  it("🚨 göreli zaman ya da misafirin adı taşıyan parça kayda girmez (başka misafire / güne taşınamaz)", () => {
    expect(entryEligible(tr("amenities", "havuz"), "Bugün havuz 20:00'de kapanıyor.")).toBe("relative_time");
    expect(entryEligible(tr("amenities", "pool"), "The pool closes at 8 pm tonight.")).toBe("relative_time");
    expect(entryEligible(tr("checkout_time", "çıkış"), "Alex, çıkış saati 11:00.", ["Alex Smith"])).toBe("guest_name");
    expect(entryEligible(tr("checkout_time", "çıkış"), "Çıkış saati 11:00.", ["Alex Smith"])).toBe("ok");
  });

  it("aynı bilgi = aynı değerler + aynı olumluluk (üslup farkı önemsiz); farklı saat ya da olumsuzluk farklı bilgidir", () => {
    expect(sameAnswer("Çıkış saati 11:00.", "Çıkış saatimiz 11:00'dir.")).toBe(true);
    expect(sameAnswer("Çıkış saati 11:00.", "Çıkış saati 12:00.")).toBe(false);
    expect(sameAnswer("Evcil hayvan kabul edilir.", "Evcil hayvan kabul edilmez.")).toBe(false);
  });
});

describe("geçerlilik — dosya tarihine değil bugünkü içeriğe", () => {
  const T0 = new Date("2026-10-01T10:00:00Z");
  const CHECKOUT = { id: "kb1", updatedAt: T0, text: "Çıkış saati: 11:00. Anahtarı kutuya bırakın." };
  const WIFI = { id: "kb2", updatedAt: T0, text: "Wi-Fi: Lale-5G, şifre Lale2025." };
  const NEED = tr("checkout_time", "çıkış saati");
  const entry = (over: Partial<ReuseEntry> = {}): ReuseEntry => ({
    need: NEED,
    partText: "Çıkış saati 11:00.",
    evidence: "Çıkış saati: 11:00",
    sourceId: "kb:kb1",
    fingerprint: relatedFingerprint([CHECKOUT, WIFI], NEED.query),
    confirmations: REUSE_STABLE_COUNT,
    createdAt: T0,
    ...over,
  });
  const now = new Date("2026-10-05T10:00:00Z");

  it("kararlı + iz aynı + bugünkü metinle doğrulanıyor → kullanılabilir", () => {
    const fp = relatedFingerprint([CHECKOUT, WIFI], NEED.query);
    expect(revalidateEntry(entry(), { sourceText: CHECKOUT.text, otherSources: [WIFI.text], fingerprint: fp, now }, NEED)).toEqual({ ok: true });
  });

  it("🚨 kurucu kuralı: 3 bağımsız teyit olmadan kullanılmaz (tekrar sayısı kararlılıktır)", () => {
    const fp = relatedFingerprint([CHECKOUT, WIFI], NEED.query);
    expect(revalidateEntry(entry({ confirmations: REUSE_STABLE_COUNT - 1 }), { sourceText: CHECKOUT.text, otherSources: [], fingerprint: fp, now }, NEED)).toEqual({
      ok: false,
      reason: "not_stable",
    });
  });

  it("🚨 Codex örneği: eski kalem DEĞİŞMEDEN yeni istisna kalemi eklenirse ('Tadilat nedeniyle bu hafta çıkış 10:00') kayıt geçersiz", () => {
    const repair = { id: "kb3", updatedAt: now, text: "Tadilat nedeniyle bu hafta çıkış 10:00." };
    const fp = relatedFingerprint([CHECKOUT, WIFI, repair], NEED.query);
    expect(revalidateEntry(entry(), { sourceText: CHECKOUT.text, otherSources: [WIFI.text, repair.text], fingerprint: fp, now }, NEED)).toEqual({
      ok: false,
      reason: "sources_changed",
    });
  });

  it("ilgisiz kalemin değişmesi (Wi-Fi) çıkış kaydını BOZMAZ", () => {
    const wifi2 = { ...WIFI, updatedAt: now, text: "Wi-Fi: Lale-5G, şifre Yeni2026." };
    expect(relatedFingerprint([CHECKOUT, wifi2], NEED.query)).toBe(relatedFingerprint([CHECKOUT, WIFI], NEED.query));
  });

  it("dayanak silindi / onayı kalktı → source_gone; süre doldu → expired; değer bugün başka → bağ sorunu", () => {
    const fp = relatedFingerprint([CHECKOUT, WIFI], NEED.query);
    expect(revalidateEntry(entry(), { sourceText: null, otherSources: [], fingerprint: fp, now }, NEED)).toEqual({ ok: false, reason: "source_gone" });
    const late = new Date(T0.getTime() + 31 * 86_400_000);
    expect(revalidateEntry(entry(), { sourceText: CHECKOUT.text, otherSources: [], fingerprint: fp, now: late }, NEED)).toEqual({ ok: false, reason: "expired" });
    // Kalem 12:00'ye değişti ama iz (yanlışlıkla) aynı verildi: yeniden doğrulama yine yakalar.
    const r = revalidateEntry(entry(), { sourceText: "Çıkış saati: 12:00.", otherSources: [], fingerprint: fp, now }, NEED);
    expect(r.ok).toBe(false);
  });
});

describe("Opus güvenlik 10-23 gece F7: tek misafir kalıcı cevap ekemez", () => {
  it("🚨 geçici durum, belirli tarih ve çekimli / Kiril yazılı misafir adı kayda girmez", async () => {
    const { entryEligible } = await import("@/lib/answer-reuse/core");
    const need = { kind: "amenities", query: "havuz kaçta kapanıyor", language: "en" };
    for (const part of ["This week the pool closes at 18:00.", "The pool is currently closed.", "The pool closes at 18:00 for now.", "On 24 October the pool is closed."]) {
      expect(entryEligible(need, part)).toBe("relative_time");
    }
    expect(entryEligible({ ...need, language: "tr" }, "Bu hafta havuz 18:00'de kapanır.")).toBe("relative_time");
    expect(entryEligible(need, "Dear Ivan, the pool closes at 20:00.", ["Иван Петров"])).toBe("guest_name");
    expect(entryEligible({ ...need, language: "tr" }, "Mehmetciğim, havuz 20:00'de kapanır.", ["Mehmet Yılmaz"])).toBe("guest_name");
    expect(entryEligible(need, "The pool closes at 20:00.", ["Ivan Petrov"])).toBe("ok");
  });

  it("🚨 teyit: kayıtlı metin her teyidin paylaştığı içeriğe daralır — eklenmiş cümle kalıcılaşmaz, farklı içerik sıfırlar", async () => {
    const { confirmAnswer } = await import("@/lib/answer-reuse/core");
    const poisoned = "Pets are welcome. Smoking is also allowed inside the apartment and you can check in at any time.";
    const benign = "Pets are welcome.";
    expect(confirmAnswer(poisoned, benign)).toEqual({ same: true, text: benign });
    expect(confirmAnswer(benign, poisoned)).toEqual({ same: true, text: benign });
    expect(confirmAnswer("Havlular banyodaki dolapta.", "Havlu banyoda.")).toEqual({ same: true, text: "Havlu banyoda." });
    expect(confirmAnswer("Check-out is at 11:00.", "Check-out is at 12:00.")).toEqual({ same: false });
    expect(confirmAnswer("The pool closes at 20:00; towels are at reception.", "The pool closes at 20:00; the sauna is next to it.")).toEqual({ same: false });
  });

  it("konuşma izi kararlı, konuşmaya özgü ve kimliği taşımaz", async () => {
    const { conversationKey } = await import("@/lib/answer-reuse/core");
    expect(conversationKey("c1")).toBe(conversationKey("c1"));
    expect(conversationKey("c1")).not.toBe(conversationKey("c2"));
    expect(conversationKey("c1")).not.toContain("c1");
  });
});

describe("Opus dilim sonu 10-23 R11: kayıtlı metin yalnız harfiyen kapsanırsa kalır", () => {
  it("🚨 tek misafirin eki ('late check-out available', 'gece de kullanılabilir', 'dogs and cats welcome') teyitle kalıcılaşmaz", async () => {
    const { confirmAnswer } = await import("@/lib/answer-reuse/core");
    expect(confirmAnswer("Check-out is at 11:00; late check-out available.", "Check-out is at 11:00.")).toEqual({ same: true, text: "Check-out is at 11:00." });
    expect(confirmAnswer("Havuz 20:00'de kapanır, gece de kullanılabilir.", "Havuz 20:00'de kapanır.")).toEqual({ same: true, text: "Havuz 20:00'de kapanır." });
    expect(confirmAnswer("Pets are allowed; dogs and cats welcome.", "Pets are allowed.")).toEqual({ same: true, text: "Pets are allowed." });
    // Haiku 10-23 gece-2: sözlük konusu kısayolu iki yönde de kalktı — farklı söyleyiş ("çıkış" ↔ "check-out") teyit sayılmaz (güvenli yön:
    // daha az teyit); taze metnin eki de kayda giremez.
    expect(confirmAnswer("Çıkış saati 11:00.", "Check-out saati 11:00.")).toEqual({ same: false });
    expect(confirmAnswer("Pets are allowed. Garden is quiet.", "Pets are allowed. Dogs and cats welcome.")).toEqual({ same: false });
    expect(confirmAnswer("Havuz 20:00'de kapanır. TV ve WC.", "Havuz 20:00'de kapanır.")).toEqual({ same: true, text: "Havuz 20:00'de kapanır." });
    expect(confirmAnswer("Yer yok.", "Yerinde yok.")).toEqual({ same: false });
    expect(confirmAnswer("Check-out is at 11:00.", "Check-out time is 11:00.")).toEqual({ same: true, text: "Check-out is at 11:00." });
  });

  it("göreli zaman listesi: 'now / until further notice / next week / aktuell / bu sezon / artık' kayda girmez", () => {
    for (const t of ["The pool is closed now.", "The pool is closed until further notice.", "Next week the pool opens at 09:00.", "Der Pool ist aktuell geschlossen.", "Bu sezon havuz 21:00'de kapanır.", "Havuz artık 21:00'de kapanıyor."]) {
      expect(entryEligible(tr("amenities", "havuz"), t), t).toBe("relative_time");
    }
    expect(entryEligible(tr("amenities", "havuz"), "The pool closes at 20:00; it is well known.")).toBe("ok");
  });
});

describe("Haiku 10-23 gece-2 (3af7943d incelemesi): göreli zaman ekleri", () => {
  it("'bugünkü / bugüne kadar / şimdiye kadar / şu anki / bu yıl / bu yaz' kayda girmez; 'Dünya' (dün değil) girer", () => {
    for (const t of ["Bugünkü havuz saati 20:00.", "Bugüne kadar havuz kapalı.", "Şimdiye kadar açık.", "Şu anki fiyat 200 TL.", "Bu yıl havuz yok.", "Bu yaz havuz 22:00'ye kadar açık."]) {
      expect(entryEligible(tr("amenities", "havuz"), t), t).toBe("relative_time");
    }
    expect(entryEligible(tr("amenities", "havuz"), "Dünya kupası maçı ekranda.")).toBe("ok");
  });
});
