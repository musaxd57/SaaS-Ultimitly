import { describe, it, expect } from "vitest";
import {
  wifiValueCount,
  applyWifiValue,
  AUTO_PROMOTION_MIN_DECISIONS,
  detectHostPromise,
  extractWifiValues,
  kbContainsValue,
  maskSecret,
  parseSuggestionKey,
  promiseDue,
  promotionReadiness,
  suggestionKey,
  type SuggestionDecision,
} from "@/lib/ai-suggestions/core";

// ---------------------------------------------------------------------------
// ⑤ ilk dilim (kurucu 10-12: "A + B + C"): saf çekirdek — söz tespiti, Wi-Fi değer çıkarımı, anahtar biçimi, otomatiğe geçiş ölçütü.
// ---------------------------------------------------------------------------

describe("C · ev sahibinin sözü", () => {
  it.each([
    ["Yarın sabah teknisyen gelecek, kombiye bakacak.", "maintenance", "tomorrow"],
    ["Birazdan temizlikçi gelecek.", "cleaning", "today"],
    ["Havluları 18:00'de getireceğim.", "towels", "today"],
    ["Tuvalet kağıdı göndereceğim.", "supplies", "today"],
    ["I'll bring fresh towels in 30 minutes.", "towels", "today"],
    ["The technician will come tomorrow to fix the AC.", "maintenance", "tomorrow"],
    ["Our cleaner is on the way.", "cleaning", "today"],
  ])("%s → %s / %s", (text, kind, day) => {
    expect(detectHostPromise(text)).toMatchObject({ kind, day });
  });

  it.each([
    ["Havlular dolapta.", "söz fiili yok"],
    ["İsterseniz havlu getirebilirim.", "teklif"],
    ["If you need, I'll bring towels.", "koşul"],
    ["Teknisyen yarın gelecek mi?", "soru"],
    ["Teknisyen gelmeyecek maalesef.", "olumsuz"],
    ["Yarın görüşürüz, iyi akşamlar.", "konu yok"],
    ["", "boş"],
    // Haiku 10-12: sıfat "gelecek" · olumsuzluk · tanınmayan gün · "team" içinde "tea".
    ["Yarın gelecek misafirler için havlu hazırladım.", "sıfat"],
    ["Temizlikçi gelecek değil.", "olumsuz"],
    ["Temizlikçi gelecek hafta izinli.", "olumsuz / gelecek hafta"],
    ["Pazartesi teknisyen gelecek.", "tanınmayan gün"],
    ["I'll let the team know.", "konu yok (team ≠ tea)"],
    ["The technician won't come today.", "olumsuz"],
  ])("%s → söz değil (%s)", (text) => {
    expect(detectHostPromise(text)).toBeNull();
  });

  it("gün YALNIZ sözün cümleciğinden (Haiku 10-12): 'Teknisyen bugün gelecek. Yarın havlu getiririm.' → bakım bugün", () => {
    expect(detectHostPromise("Teknisyen bugün gelecek. Yarın havlu getiririm.")).toMatchObject({ kind: "maintenance", day: "today" });
    expect(detectHostPromise("Teknisyen 30 dakika içinde gelecek. Yarın havlu getiririm.")).toMatchObject({ kind: "maintenance", day: "today", inMinutes: 30 });
  });

  it("son an: açık saat → şimdiden sonraki ilk aday; göreli süre; yarın saatsiz → 12:00; hiçbiri → +2 saat", () => {
    const at10 = 10 * 60;
    expect(promiseDue(detectHostPromise("Havluları 18:00'de getireceğim.")!, at10)).toEqual({ day: "today", time: "18:00" });
    expect(promiseDue(detectHostPromise("Havluları 6'da getireceğim.")!, at10)).toEqual({ day: "today", time: "18:00" });
    expect(promiseDue(detectHostPromise("I'll bring fresh towels in 30 minutes.")!, at10)).toEqual({ day: "today", time: "10:30" });
    expect(promiseDue(detectHostPromise("Yarın teknisyen gelecek.")!, at10)).toEqual({ day: "tomorrow", time: "12:00" });
    expect(promiseDue(detectHostPromise("Temizlikçi gelecek.")!, at10)).toEqual({ day: "today", time: "12:00" });
    expect(promiseDue(detectHostPromise("Birazdan temizlikçi gelecek.")!, 23 * 60 + 30)).toEqual({ day: "tomorrow", time: "00:30" });
  });
});

describe("B · Wi-Fi değeri", () => {
  it.each([
    ["Yeni Wi-Fi şifresi: Lale2025!", "Lale2025!", null],
    ["Şifre artık DenizKenari99 oldu.", "DenizKenari99", null],
    ["The wifi password is now Sunny#2025", "Sunny#2025", null],
    ["Ağ adı: LaleNet-5G, şifre: abc12345", "abc12345", "LaleNet-5G"],
    ["Network name is LaleNet", null, "LaleNet"],
  ])("%s → şifre %s · ağ %s", (text, password, network) => {
    expect(extractWifiValues(text)).toEqual({ password, network });
  });

  it.each([
    "Şifre yanlış mı?",
    "Şifre kartta yazıyor.",
    "Wi-Fi şifresi aşağıda",
    "The password is wrong",
    "şifre: 1234",
    // Haiku 10-12: rakamsız sözcük şifre değildir.
    "Wi-Fi şifresi değişmedi",
    "Şifre çalışmazsa resepsiyonu arayın",
    "Şifre sıfırlama bağlantısı gönderdim",
    "password is incorrect",
  ])("%s → şifre değeri yok", (text) => {
    expect(extractWifiValues(text).password).toBeNull();
  });

  it("ağ adı: 'Wi-Fi adı yok' değer değil; biçimlendirme işaretleri atılır; kalemdeki değer sayısı (ana + misafir ağı = belirsiz)", () => {
    expect(extractWifiValues("Wi-Fi adı yok").network).toBeNull();
    expect(extractWifiValues("**Şifre:** abc12345").password).toBe("abc12345");
    expect(wifiValueCount("Ana ağ şifresi: Abc12345 / Misafir şifresi: Gst98765", "password")).toBe(2);
    expect(wifiValueCount("Ağ LaleNet, şifre: eskiSifre1", "password")).toBe(1);
  });

  it("bilgi tabanı metnine uygulama: eski değer yerine yazılır; yoksa satır eklenir; aynıysa değişmez; maske son iki karakter", () => {
    expect(applyWifiValue("Ağ LaleNet, şifre: eskiSifre1", "password", "YeniSifre2")).toBe("Ağ LaleNet, şifre: YeniSifre2");
    // Yalnız ilk geçiş değişir (Haiku 10-12).
    expect(applyWifiValue("şifre: abc12345 (yedek kart: abc12345)", "password", "Yeni99999")).toBe("şifre: Yeni99999 (yedek kart: abc12345)");
    expect(applyWifiValue("Modem salonda.", "password", "YeniSifre2")).toBe("Modem salonda.\nŞifre: YeniSifre2");
    expect(applyWifiValue("şifre: YeniSifre2", "password", "YeniSifre2")).toBe("şifre: YeniSifre2");
    expect(applyWifiValue("Ağ adı: EskiAg, şifre: x1234567", "network", "YeniAg")).toBe("Ağ adı: YeniAg, şifre: x1234567");
    expect(kbContainsValue("şifre: Abc12345", "abc12345", true)).toBe(false);
    expect(kbContainsValue("Ağ: LALENET", "lalenet", false)).toBe(true);
    expect(maskSecret("Lale2025!")).toBe("••••5!");
  });
});

describe("anahtar ve ölçüt", () => {
  it("anahtar tür + kimlik; bozuk / bilinmeyen tür / tehlikeli karakter reddedilir", () => {
    expect(parseSuggestionKey(suggestionKey("task", "cm123"))).toEqual({ kind: "task", source: "cm123" });
    expect(parseSuggestionKey("kb_wifi:kb1:msg2")).toEqual({ kind: "kb_wifi", source: "kb1:msg2" });
    for (const bad of ["", "task", "nope:x", "task:", "task:a b", "task:<script>", 42, null]) expect(parseSuggestionKey(bad)).toBeNull();
  });

  it(`otomatiğe hazır: 14 gün içinde ≥ ${AUTO_PROMOTION_MIN_DECISIONS} karar ve ≥ %90 DÜZENLEMESİZ onay; düzenlenen onay sayılmaz; pencere dışı sayılmaz`, () => {
    const now = new Date("2026-10-12T12:00:00Z");
    const d = (decision: "approved" | "dismissed", edited = false, daysAgo = 1): SuggestionDecision => ({
      kind: "task",
      decision,
      edited,
      at: new Date(now.getTime() - daysAgo * 86_400_000),
    });
    const ok = [...Array(9).fill(0).map(() => d("approved")), d("dismissed")];
    expect(promotionReadiness(ok, now).task).toMatchObject({ decided: 10, cleanApproved: 9, ready: true });
    expect(promotionReadiness([...Array(9).fill(0).map(() => d("approved"))], now).task.ready).toBe(false); // < 10 karar
    expect(promotionReadiness([...Array(9).fill(0).map(() => d("approved")), d("approved", true)], now).task).toMatchObject({ cleanApproved: 9, ready: true });
    expect(promotionReadiness([...Array(8).fill(0).map(() => d("approved")), d("approved", true), d("dismissed")], now).task.ready).toBe(false);
    expect(promotionReadiness([...Array(10).fill(0).map(() => d("approved", false, 15))], now).task.decided).toBe(0);
    expect(promotionReadiness([], now).commitment).toEqual({ decided: 0, cleanApproved: 0, rate: null, ready: false });
  });
});

describe("süre (karesel iş yok)", () => {
  it("uzun tek sözcük / boşluk dizisi / tekrarlanan söz fiili ve şifre sözcüğü doğrusal", () => {
    const runs = ["a".repeat(4_000), `a${" ".repeat(3_990)}b`, "getirecegim ".repeat(330), "sifre ".repeat(660), "password is ".repeat(330), "havlu gelecek ".repeat(280)];
    for (const r of runs) {
      const t = performance.now();
      detectHostPromise(r);
      extractWifiValues(r);
      expect(performance.now() - t).toBeLessThan(1_000);
    }
  });
});
