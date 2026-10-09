import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CUS_CLASSES, CUS_LANGS, cusDatasetName, type CusDataset } from "../eval/conversation-state-harness";
import { HISTORY_MESSAGE_CAP } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// Kurucu talimatı 09-07 "Initial required evaluation scenarios" (8) — veri seti `evals/founder-initial-8.json`. Ücretli koşu
// (`RUN_REAL_EVAL=1 EVAL_CUS_DATASET=founder-initial-8.json npm run eval -- conversation-state`) kurucu onayıyla; bu dosya
// MODELSİZ olarak setin talimata sadık olduğunu ve seçicinin yasak dosyaları reddettiğini sınar.
// ---------------------------------------------------------------------------

const data = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/founder-initial-8.json"), "utf8")) as CusDataset & {
  scenarios: (CusDataset["scenarios"][number] & { note?: string })[];
};
const byNo = (n: number) => {
  const s = data.scenarios.find((x) => x.id.startsWith(`f8-${n}-`));
  if (!s) throw new Error(`senaryo ${n} yok`);
  return s;
};

describe("founder-initial-8 veri seti", () => {
  it("tam 8 senaryo, benzersiz kimlik, geçerli sınıf / dil", () => {
    expect(data.scenarios).toHaveLength(8);
    expect(new Set(data.scenarios.map((s) => s.id)).size).toBe(8);
    for (const s of data.scenarios) {
      expect(CUS_CLASSES).toContain(s.class);
      expect(CUS_LANGS).toContain(s.lang);
    }
  });

  it("talimatın mesajları aynen", () => {
    expect(byNo(1).message).toBe("Merhaba, otopark var mı?");
    expect(byNo(2).message).toBe("Peki havlu nerede?");
    expect(byNo(4).message).toBe("Tamamdır teşekkürler 👍");
    expect(byNo(8).message).toBe("Ayın 3'ü ile 4'ü müsait mi?");
    expect([...(byNo(3).history ?? []).map((m) => m.body), byNo(3).message]).toEqual(["Klima çalışmıyor.", "Çocuklar var.", "Bir de çok sıcak."]);
  });

  it("1 ilk temas (geçmiş yok) · 2 onuncu mesaj (dokuz geçmiş satırı, en az bir cevap)", () => {
    expect(byNo(1).history ?? []).toHaveLength(0);
    const h = byNo(2).history ?? [];
    expect(h).toHaveLength(9);
    expect(h.some((m) => m.direction === "outbound")).toBe(true);
  });

  it("🚨 6 kaydırma: önce iade, ardından üretim penceresinden FAZLA zararsız mesaj, araya giden mesaj yok; otomatik gitmez", () => {
    const h = byNo(6).history ?? [];
    expect(h[0].body).toBe("İade istiyorum.");
    expect(h.length - 1).toBeGreaterThan(HISTORY_MESSAGE_CAP);
    expect(h.every((m) => m.direction === "inbound")).toBe(true);
    expect(byNo(6).expect.autoSend).toBe("no");
  });

  it("5 çözülmüş şikâyet: şikâyetten SONRA teslim edilmiş ev sahibi cevabı var", () => {
    const h = byNo(5).history ?? [];
    const complaint = h.findIndex((m) => m.direction === "inbound");
    const reply = h.findIndex((m) => m.direction === "outbound" && m.author === "host");
    expect(complaint).toBeGreaterThanOrEqual(0);
    expect(reply).toBeGreaterThan(complaint);
  });

  it("beklentiler: 3 / 6 / 7 / 8 otomatik gitmez · 4 sessiz · 8 tek netleştirme sorusu", () => {
    for (const n of [3, 6, 7, 8]) expect(byNo(n).expect.autoSend, `senaryo ${n}`).toBe("no");
    expect(byNo(4).expect.silent).toBe(true);
    expect(byNo(8).expect.clarify).toBe("one");
    expect(byNo(8).reservation).toBeNull();
  });

  it("kişisel veri / sır yok (telefon, e-posta, kod biçimi)", () => {
    const text = JSON.stringify(data.scenarios);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
  });
});

describe("cusDatasetName — veri seti seçici", () => {
  it("varsayılan ve izinli adlar", () => {
    expect(cusDatasetName(undefined)).toBe("conversation-state.json");
    expect(cusDatasetName(" founder-initial-8.json ")).toBe("founder-initial-8.json");
  });
  it.each(["../x.json", "evals/x.json", "rag-scale/holdout.json", "x-holdout.json", "sealed-a.json", "private.json", "X.json", "x.txt"])(
    "🚨 reddedilir: %s",
    (name) => {
      expect(() => cusDatasetName(name)).toThrow();
    },
  );
});
