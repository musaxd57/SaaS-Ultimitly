import { describe, it, expect } from "vitest";
import {
  classifyOutcome,
  diffDraft,
  draftAcceptance,
  editKindsOf,
  isCleanApproval,
  mineRecurringAdditions,
  normalizeForDiff,
  outcomeInputOf,
  platformOutcomeCounts,
  tokenize,
  DIFF_TOKEN_CAP,
  type SpanForMining,
} from "@/lib/reply-draft/core";

// ---------------------------------------------------------------------------
// TASLAK ↔ GÖNDERİLEN METİN BAĞI — saf çekirdek (kurucu 11-13: "embedding yapılarak asıl metin farkı incelenerek dahi tutulsun, buraya ML
// ekle"; tasarım docs/TASARIM-2026-11-13-taslak-gonderim-bagi.md §3–§4). Gerçek metin farkı (en uzun ortak alt dizi), değer değişimi, cümle
// silme, bilgi ekleme; anlam benzerliğiyle birlikte sürümlü sınıf; tekrar eden ekleme madenciliği; konu başına kabul; platform sayımı.
// ---------------------------------------------------------------------------

const classify = (draft: string, sent: string, semantic: number | null = null) => {
  const d = diffDraft(draft, sent);
  const input = outcomeInputOf(d);
  const outcome = classifyOutcome(input, semantic);
  return { d, outcome, kinds: editKindsOf(input, outcome) };
};

describe("normalleştirme ve belirteçler", () => {
  it("görünmez karakter, büyük harf (Türkçe İ / I) ve boşluk farkı metni DEĞİŞTİRMEZ", () => {
    expect(normalizeForDiff("  Wİ-Fİ\u200b şifremiz   LALE2024 ")).toBe(normalizeForDiff("wi-fi şifremiz lale2024"));
    expect(classify("Wi-Fi şifremiz: Lale2024", "wi-fi  şifremiz: LALE2024\u200b").outcome).toBe("unchanged");
  });

  it("değer belirteçleri: saat, sayı, tutar, bağlantı, e-posta, gün / ay adı", () => {
    const vals = tokenize(normalizeForDiff("Giriş 14:00, ücret 1.250,50 TL, https://x.co/a b@c.io cuma ekim kapı"))
      .filter((t) => t.value)
      .map((t) => t.t);
    expect(vals).toEqual(["14:00", "1.250,50", "https://x.co/a", "b@c.io", "cuma", "ekim"]);
  });
});

describe("metin farkı ve sınıf", () => {
  it("birebir aynı → unchanged, temiz onay", () => {
    const r = classify("Merhaba, giriş saatimiz 15:00.", "Merhaba, giriş saatimiz 15:00.");
    expect(r.outcome).toBe("unchanged");
    expect(r.kinds).toEqual([]);
    expect(isCleanApproval(r.outcome, r.kinds)).toBe(true);
  });

  it("küçük üslup düzeltmesi → minor_edit, yalnız 'tone', temiz onay", () => {
    const draft = "Merhaba, Wi-Fi ağımızın adı Lale ve şifresi 12345678. Başka bir şey olursa yazabilirsiniz.";
    const sent = "Merhabalar, Wi-Fi ağımızın adı Lale ve şifresi 12345678. Başka bir şey olursa yazabilirsiniz.";
    const r = classify(draft, sent);
    expect(r.outcome).toBe("minor_edit");
    expect(r.kinds).toEqual(["tone"]);
    expect(isCleanApproval(r.outcome, r.kinds)).toBe(true);
  });

  it("🚨 DEĞER düzeltmesi (15:00 → 14:00) kelime olarak küçük de olsa ASLA küçük düzeltme değildir; temiz onay değildir", () => {
    const draft = "Merhaba, giriş saatimiz 15:00, çıkış saatimiz 11:00. Anahtar kutusu kapının sağında, kodu girişten önce ileteceğiz.";
    const r = classify(draft, draft.replace("15:00", "14:00"));
    expect(r.d.valueChanged).toBe(true);
    expect(r.d.lexicalSim).toBeGreaterThan(0.85);
    expect(r.outcome).toBe("major_edit");
    expect(r.kinds).toContain("corrected_value");
    expect(isCleanApproval(r.outcome, r.kinds)).toBe(false);
  });

  it("🚨 Haiku 11-13: harf + rakam karışık değer (Wi-Fi şifresi / kapı kodu) düzeltmesi de DEĞERDİR — temiz onay değildir", () => {
    const draft = "Merhaba, Wi-Fi ağımızın adı Lale, şifresi Lale2024; giriş saatimiz 15:00, çıkış 11:00. İyi konaklamalar dileriz, yazabilirsiniz.";
    const r = classify(draft, draft.replace("Lale2024", "Lale2025"));
    expect(r.d.lexicalSim).toBeGreaterThan(0.9);
    expect(r.d.valueChanged).toBe(true);
    expect(r.outcome).toBe("major_edit");
    expect(isCleanApproval(r.outcome, r.kinds)).toBe(false);
  });

  it("gün adı değişimi de değerdir (cuma → cumartesi)", () => {
    expect(classify("Temizlik cuma günü yapılacak.", "Temizlik cumartesi günü yapılacak.").d.valueChanged).toBe(true);
  });

  it("cümle silme (ev sahibi bir sözü sildi) → removed_sentence, major_edit", () => {
    const draft = "Havlularınızı yarın sabah değiştireceğiz. Ek ücretsiz kahvaltı paketi de bırakacağız. İyi tatiller.";
    const sent = "Havlularınızı yarın sabah değiştireceğiz. İyi tatiller.";
    const r = classify(draft, sent);
    expect(r.d.removedSentence).toBe(true);
    expect(r.outcome).toBe("major_edit");
    expect(r.kinds).toContain("removed_sentence");
  });

  it("bilgi ekleme → added_info; eklenen parça öğrenme için ayrılır", () => {
    const draft = "Otopark sorusu için teşekkürler, hemen bakıyorum.";
    const sent = "Otopark sorusu için teşekkürler, arkada ücretsiz otoparkımız var, hemen bakıyorum.";
    const r = classify(draft, sent);
    expect(r.kinds).toContain("added_info");
    expect(r.d.addedSpans.map((s) => s.text)).toEqual(["arkada ücretsiz otoparkımız var"]);
  });

  it("baştan yazma → rewritten (anlam ölçülmediyse yalnız metin farkıyla)", () => {
    const r = classify("Wi-Fi şifremiz 12345678.", "Maalesef yarın erken giriş mümkün değil, temizlik sürüyor olacak.");
    expect(r.d.lexicalSim).toBeLessThan(0.35);
    expect(r.outcome).toBe("rewritten");
    expect(r.kinds).toEqual(["rewrite"]);
  });

  it("🚨 anlam benzerliği sınıfı DÜZELTİR: kelimesi çok değişip anlamı aynı → rewritten DEĞİL; kelimesi benzer ama anlamı farklı → minor DEĞİL", () => {
    const lowLexical = { identical: false, truncated: false, lexicalSim: 0.2, valueChanged: false, removedSentence: false, maxAddedRun: 2, addedSpanCount: 0 };
    expect(classifyOutcome(lowLexical, null)).toBe("rewritten");
    expect(classifyOutcome(lowLexical, 0.93)).toBe("major_edit");
    const highLexical = { identical: false, truncated: false, lexicalSim: 0.92, valueChanged: false, removedSentence: false, maxAddedRun: 1, addedSpanCount: 0 };
    expect(classifyOutcome(highLexical, null)).toBe("minor_edit");
    expect(classifyOutcome(highLexical, 0.95)).toBe("minor_edit");
    expect(classifyOutcome(highLexical, 0.7)).toBe("major_edit");
  });

  it("eşik sınırları: lexical 0,85 dahil minor; 0,35 dahil rewritten DEĞİL; uzun ekleme (≥6) minor değil", () => {
    const base = { identical: false, truncated: false, valueChanged: false, removedSentence: false, maxAddedRun: 0, addedSpanCount: 0 };
    expect(classifyOutcome({ ...base, lexicalSim: 0.85 }, null)).toBe("minor_edit");
    expect(classifyOutcome({ ...base, lexicalSim: 0.8499 }, null)).toBe("major_edit");
    expect(classifyOutcome({ ...base, lexicalSim: 0.35 }, null)).toBe("major_edit");
    expect(classifyOutcome({ ...base, lexicalSim: 0.3499 }, 0.8)).toBe("major_edit");
    expect(classifyOutcome({ ...base, lexicalSim: 0.3499 }, 0.7999)).toBe("rewritten");
    expect(classifyOutcome({ ...base, lexicalSim: 0.95, maxAddedRun: 6 }, null)).toBe("major_edit");
    expect(classifyOutcome({ ...base, lexicalSim: 0.95, maxAddedRun: 5 }, null)).toBe("minor_edit");
    // Haiku 11-13: kesilmiş fark "küçük düzeltme" olamaz (kesilen kısımda ne değiştiği bilinmez).
    expect(classifyOutcome({ ...base, lexicalSim: 0.99, truncated: true }, 0.99)).toBe("major_edit");
  });

  it("temiz onay: minor_edit ama bilgi ekleme varsa temiz DEĞİL", () => {
    expect(isCleanApproval("minor_edit", ["tone"])).toBe(true);
    expect(isCleanApproval("minor_edit", ["added_info"])).toBe(false);
    expect(isCleanApproval("major_edit", ["tone"])).toBe(false);
    expect(isCleanApproval("rewritten", ["rewrite"])).toBe(false);
  });

  it("çok uzun girdi: fark ilk DIFF_TOKEN_CAP belirteçle hesaplanır, işaretlenir; değer kıyası metnin TAMAMINDA", () => {
    const long = Array.from({ length: DIFF_TOKEN_CAP + 50 }, (_, i) => `kelime${i}`).join(" ");
    const r = diffDraft(long + " saat 15:00", long + " saat 16:00");
    expect(r.truncated).toBe(true);
    expect(r.valueChanged).toBe(true);
    expect(diffDraft("kısa", "kısa").truncated).toBe(false);
  });
});

describe("öğrenme — konu başına kabul", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const at = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const rows = (n: number, cleanN: number, intent = "wifi", days = 1) =>
    Array.from({ length: n }, (_, i) => ({
      intent,
      outcome: (i < cleanN ? "unchanged" : "major_edit") as "unchanged" | "major_edit",
      kinds: [],
      at: at(days),
    }));

  it("14 gün · ≥10 karar · ≥%90 temiz onay → hazır; 9 karar ya da %89 → hazır değil", () => {
    expect(draftAcceptance(rows(10, 9), now).get("wifi")).toMatchObject({ decided: 10, clean: 9, ready: true });
    expect(draftAcceptance(rows(9, 9), now).get("wifi")?.ready).toBe(false);
    expect(draftAcceptance(rows(100, 89), now).get("wifi")?.ready).toBe(false);
  });

  it("pencere dışı (15 gün önce) ve gelecekteki satır sayılmaz; niyetsiz satır 'general'", () => {
    const m = draftAcceptance([...rows(10, 10, "wifi", 15), ...rows(2, 2, "", 1)], now);
    expect(m.get("wifi")).toBeUndefined();
    expect(m.get("general")?.decided).toBe(2);
    expect(draftAcceptance([{ intent: "x", outcome: "unchanged", kinds: [], at: new Date(now.getTime() + 60_000) }], now).size).toBe(0);
  });
});

describe("öğrenme — tekrar eden ekleme madenciliği", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const span = (over: Partial<SpanForMining> & { id: string; conversationId: string }): SpanForMining => ({
    propertyId: "p1",
    text: "arkada ücretsiz otoparkımız var",
    vector: null,
    hasSecret: false,
    at: new Date(now.getTime() - 86_400_000),
    ...over,
  });

  it("aynı dairede 3 FARKLI konuşmada aynı ekleme → aday; aynı konuşmada 3 kez → aday DEĞİL", () => {
    const c = mineRecurringAdditions(
      [span({ id: "a", conversationId: "c1" }), span({ id: "b", conversationId: "c2", text: "arkada ücretsiz otoparkımız mevcut" }), span({ id: "c", conversationId: "c3" })],
      now,
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ propertyId: "p1", conversations: 3, text: "arkada ücretsiz otoparkımız var" });
    expect(mineRecurringAdditions([span({ id: "a", conversationId: "c1" }), span({ id: "b", conversationId: "c1" }), span({ id: "c", conversationId: "c1" })], now)).toEqual([]);
  });

  it("🚨 sır taşıyan parça kümeye hiç girmez; başka daire ayrı kümedir; 30 günden eski sayılmaz", () => {
    const old = new Date(now.getTime() - 31 * 86_400_000);
    expect(
      mineRecurringAdditions(
        [span({ id: "a", conversationId: "c1" }), span({ id: "b", conversationId: "c2" }), span({ id: "c", conversationId: "c3", hasSecret: true })],
        now,
      ),
    ).toEqual([]);
    expect(
      mineRecurringAdditions(
        [span({ id: "a", conversationId: "c1" }), span({ id: "b", conversationId: "c2" }), span({ id: "c", conversationId: "c3", propertyId: "p2" })],
        now,
      ),
    ).toEqual([]);
    expect(
      mineRecurringAdditions(
        [span({ id: "a", conversationId: "c1", at: old }), span({ id: "b", conversationId: "c2" }), span({ id: "c", conversationId: "c3" })],
        now,
      ),
    ).toEqual([]);
  });

  it("vektör varsa ANLAMLA kümeler (kelimeler farklı olsa da), eşik altı ayrı tutulur", () => {
    const v = (x: number, y: number) => {
      const n = Math.hypot(x, y);
      return [x / n, y / n];
    };
    const same = mineRecurringAdditions(
      [
        span({ id: "a", conversationId: "c1", text: "otopark arkada ücretsiz", vector: v(1, 0) }),
        span({ id: "b", conversationId: "c2", text: "binanın arkasına bedava park edebilirsiniz", vector: v(0.95, 0.31) }),
        span({ id: "c", conversationId: "c3", text: "araç için arka bahçe uygun", vector: v(0.97, 0.24) }),
      ],
      now,
    );
    expect(same).toHaveLength(1);
    const apart = mineRecurringAdditions(
      [
        span({ id: "a", conversationId: "c1", vector: v(1, 0) }),
        span({ id: "b", conversationId: "c2", vector: v(0, 1) }),
        span({ id: "c", conversationId: "c3", vector: v(0.5, 0.5) }),
      ],
      now,
    );
    expect(apart).toEqual([]);
  });
});

describe("öğrenme — platform sayımı", () => {
  it("en az N işletme yoksa HİÇBİR ŞEY dönmez; varsa yalnız niyet × sonuç sayısı", () => {
    const rows = ["o1", "o2", "o3", "o4"].map((o) => ({ organizationId: o, intent: "wifi", outcome: "unchanged" as const }));
    expect(platformOutcomeCounts(rows, 5)).toBeNull();
    const five = [...rows, { organizationId: "o5", intent: "wifi", outcome: "rewritten" as const }];
    expect(platformOutcomeCounts(five, 5)?.get("wifi")).toEqual({ unchanged: 4, minor_edit: 0, major_edit: 0, rewritten: 1 });
  });
});
