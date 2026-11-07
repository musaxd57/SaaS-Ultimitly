import { describe, it, expect, beforeEach } from "vitest";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// #186 ÖLÇÜM KANCASI (`onCandidates`): yeniden sıralayıcı tavan teşhisi aday listesini görmek için. Sözleşme:
// seçimi DEĞİŞTİRMEZ (kanca verilse de verilmese de sonuç birebir), alt sorgu başına sıralı KALEM kimlikleri verir,
// seçim yapılmayan yolda (küçük KB) hiç çağrılmaz.
// ---------------------------------------------------------------------------

const t0 = Date.UTC(2026, 5, 1);
const items = [
  { id: "wifi", category: "wifi", title: "Wi-Fi", content: "Wi-Fi ağı Lale-5G, şifre modemin altında.", updatedAt: new Date(t0) },
  { id: "park", category: "parking", title: "Otopark", content: "Binanın önünde ücretsiz açık otopark var.", updatedAt: new Date(t0 - 1000) },
  { id: "pet", category: "rules", title: "Evcil hayvan", content: "Evcil hayvan kabul edilmiyor.", updatedAt: new Date(t0 - 2000) },
  ...neutralPadding(40),
];
const NOW = Date.UTC(2026, 8, 26, 12);

describe("seçici ölçüm kancası — onCandidates", () => {
  beforeEach(() => __resetKbIndexCache());

  it("seçimi değiştirmez: kancalı ve kancasız sonuç birebir aynı", () => {
    const base = selectKbForPrompt({ items, guestMessage: "Wi-Fi şifresi ne? Otopark var mı?", mode: "hybrid", now: NOW });
    __resetKbIndexCache();
    const hooked = selectKbForPrompt({
      items,
      guestMessage: "Wi-Fi şifresi ne? Otopark var mı?",
      mode: "hybrid",
      now: NOW,
      onCandidates: () => undefined,
    });
    expect(hooked.items.map((i) => i.id)).toEqual(base.items.map((i) => i.id));
    expect({ ...hooked.evidence, ms: 0 }).toEqual({ ...base.evidence, ms: 0 });
  });

  it("alt sorgu başına sıralı kalem kimlikleri: her soru kendi cevabını başta görür", () => {
    let lists: readonly (readonly { id: string; key: string }[])[] = [];
    selectKbForPrompt({
      items,
      guestMessage: "Wi-Fi şifresi ne? Otopark var mı?",
      mode: "hybrid",
      now: NOW,
      onCandidates: (l) => {
        lists = l;
      },
    });
    expect(lists.length).toBe(2);
    expect(lists[0][0]).toEqual({ id: "wifi", key: "wifi#0" });
    expect(lists[1][0]).toEqual({ id: "park", key: "park#0" });
  });

  it("seçim yapılmayan küçük KB'de kanca çağrılmaz", () => {
    let called = false;
    selectKbForPrompt({
      items: items.slice(0, 3),
      guestMessage: "Wi-Fi şifresi ne?",
      mode: "hybrid",
      now: NOW,
      onCandidates: () => {
        called = true;
      },
    });
    expect(called).toBe(false);
  });
});
