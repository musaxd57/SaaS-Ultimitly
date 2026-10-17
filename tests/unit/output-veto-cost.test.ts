import { describe, it, expect } from "vitest";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";

// ---------------------------------------------------------------------------
// ÇIKTI VETOSU MALİYETİ (ReDoS denetimi 09-28, ÖLÇÜLDÜ): 1. tekil geniş zaman alternatifinin "olsam" / alışkanlık geriye
// bakışları fiil gövdesinden önce her konumda koşuyordu → 4.000 karakterlik boşluk dizisi 2,6 sn. Veto model cevabına ve ev
// sahibinin kaydettiği erken giriş notu / geç çıkış teklifine uygulanır. Hüküm değişmedi (98.540 metinlik eski/yeni kıyası).
// ---------------------------------------------------------------------------

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("çıktı vetosu — düşmanca girdide sınırlı süre", () => {
  it.each([
    ["uzun boşluk dizisi", "otopark" + " ".repeat(3990) + "x"],
    ["uzun boşluk dizisi + söz", "Ben olsam" + " ".repeat(3980) + "sorarım"],
  ])("%s (4.000 karakter) → 100 ms altında", (_ad, girdi) => {
    // Isınma: düzenli ifadelerin derlenmesi süreç başına BİR KEZ ödenir (V8 uzun girdide yerel koda derler; K10 09-30 ile
    // kalıplar büyüdü, ilk çağrı derlemeyle ~130 ms) — pin KARESEL İŞİ ölçer (eski 2,6 sn), derlemeyi değil. Isınma metni
    // hiçbir kalıba uymaz → her kalıp tam taranıp derlenir.
    vetoOutgoingReply("Kontrol edip dönerim.");
    for (let i = 0; i < 2; i++) vetoOutgoingReply("otopark " + "a ".repeat(700));
    expect(ms(() => vetoOutgoingReply(girdi))).toBeLessThan(100);
  });

  it("hüküm aynı: gövde uzak bir 'olsam'dan sonra da söz; yakın 'olsam' tavsiyedir", () => {
    expect(vetoOutgoingReply("Ben olsam" + " ".repeat(3980) + "sorarım")).toBe("unverified_commitment");
    expect(vetoOutgoingReply("Ben olsam ev sahibinize sorarım.")).toBeNull();
    expect(vetoOutgoingReply("Bunu ev sahibinize sorarım.")).toBe("unverified_commitment");
  });
});
