import { describe, it, expect } from "vitest";
import { chunkItem } from "@/lib/ai/retrieval/chunker";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";

// ---------------------------------------------------------------------------
// BAĞLAMSAL PARÇALAMA (kurucu iş emri 09-12, madde 1) — ÖLÇÜLMÜŞ GEREKÇE.
//
// 🚨 SÖZCÜKSEL tarafta sorun YOK: rerank başlık köklerini zaten ödüllendiriyor
// (`rerank.ts` title 0.15 + tam örtüşme 0.15) ve başlık `KbChunk.title` alanında
// duruyor. AMA EMBEDDING tarafı yalnız `text` alanını görür ve `text` =
// `content.slice(...)` — yani ORTA bir parça tek başına kaldığında hangi konuya
// ait olduğu vektörde KAYBOLUR: "…gece 23:00'ten sonra sessizlik…" parçası,
// başlığı ("Bina kuralları") olmadan "sessiz saat" sorgusuna daha zayıf eşleşir.
//
// 🚨 AYRIM KRİTİK: `text` alanı DEĞİŞTİRİLMEZ — reponun "parça = content.slice,
// metin DEĞİŞMEZ" pini İSTEME giden metinle ilgilidir (host'un kendi sözleri
// aynen görünmeli). Bağlam yalnız VEKTÖRE eklenir. İki şey ayrı: ne gösterildiği
// ve ne gömüldüğü.
//
// ⚠️ Bu modülün ÜRETİMDE ÇAĞIRANI YOK — E3'te (yazma yolu) bağlanır, o da E2
// migration onayına bağlı. Bugün davranış DEĞİŞMEZ.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-12T00:00:00Z");
const item = (title: string, content: string) => ({
  id: "k1",
  category: "rules",
  title,
  content,
  updatedAt: NOW,
});

describe("embeddingTextFor — parça bağlamını KAYBETMEZ", () => {
  it("🚨 ORTA parça bile başlığını taşır", () => {
    // Tek parçaya sığmayacak kadar uzun içerik → en az iki parça.
    const long = Array.from({ length: 40 }, (_, i) => `Kural ${i}: bu maddenin metni yeterince uzundur.`).join(" ");
    const chunks = chunkItem(item("Bina kuralları", long));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(embeddingTextFor(c)).toContain("Bina kuralları");
    }
  });

  it("🚨 `text` alanı DEĞİŞMEZ — yalnız gömülen metin zenginleşir", () => {
    const chunks = chunkItem(item("Wi-Fi", "Ağ adı ve şifre resepsiyonda."));
    expect(chunks[0].text).toBe("Ağ adı ve şifre resepsiyonda.");
    // Gömülen metin parçanın KENDİSİNİ de içerir (bilgi kaybı yok).
    expect(embeddingTextFor(chunks[0])).toContain("Ağ adı ve şifre resepsiyonda.");
  });

  it("KATEGORİ de bağlama girer (aynı başlıklı iki kalem ayrışsın)", () => {
    const c = chunkItem(item("Saatler", "09:00 - 22:00"))[0];
    expect(embeddingTextFor(c)).toContain("rules");
  });

  it("🚨 DETERMİNİSTİK — aynı girdi aynı metin (önbellek anahtarı buna bağlı)", () => {
    const c = chunkItem(item("Otopark", "Bina altında."))[0];
    expect(embeddingTextFor(c)).toBe(embeddingTextFor(c));
  });

  it("BOŞ/eksik başlıkta çökmez ve gereksiz ayırıcı bırakmaz", () => {
    const c = chunkItem(item("", "Sadece içerik."))[0];
    const t = embeddingTextFor(c);
    expect(t).toContain("Sadece içerik.");
    expect(t).not.toMatch(/\n\n\n/);
    expect(t.startsWith("\n")).toBe(false);
  });

  it("🚨 BAŞLIK İKİ KEZ YAZILMAZ — parça zaten başlıkla başlıyorsa tekrar eklenmez", () => {
    // İlk parça çoğu zaman başlığı metin içinde tekrarlar; iki kez gömmek o
    // terimi yapay olarak ağırlaştırırdı.
    const c = chunkItem(item("Otopark", "Otopark bina altındadır."))[0];
    const t = embeddingTextFor(c);
    expect(t.match(/Otopark/g)?.length).toBe(1);
  });

  it("tavan var — bağlam eki parçayı şişirip gömme tavanını patlatmaz", () => {
    const hugeTitle = "x".repeat(5_000);
    const c = chunkItem(item(hugeTitle, "kısa içerik"))[0];
    expect(embeddingTextFor(c).length).toBeLessThan(1_500);
    expect(embeddingTextFor(c)).toContain("kısa içerik");
  });
});
