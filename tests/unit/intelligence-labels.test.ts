import { describe, it, expect } from "vitest";
import { sentimentTone, signalCategoryLabel, signalKindLabel } from "@/modules/intelligence/labels";
import { SIGNAL_KINDS } from "@/modules/intelligence/signals/derive";

// V1 okuma yüzeyi (mülk sayfası) etiketleri: kapalı kümeler görünür Türkçe ad taşır, bilinmeyen
// değer ham geçer (sessiz boşluk yok), sağlayıcı adı hiçbir etikette yok (kanal bağımsız).
describe("intelligence labels", () => {
  it("her sinyal türünün görünür adı var ve sağlayıcı adı içermez", () => {
    for (const k of SIGNAL_KINDS) {
      const l = signalKindLabel(k);
      expect(l).not.toBe(k);
      expect(l.toLowerCase()).not.toMatch(/hospitable|airbnb|booking/);
    }
    expect(signalKindLabel("bilinmeyen.kind")).toBe("bilinmeyen.kind");
  });

  it("kategori etiketleri: türetim kümesi + iptal/tarih; bilinmeyen ham geçer", () => {
    expect(signalCategoryLabel("complaint")).toBe("Şikayet");
    expect(signalCategoryLabel("cancellation")).toBe("İptal");
    expect(signalCategoryLabel("date_change")).toBe("Tarih değişikliği");
    expect(signalCategoryLabel("xyz")).toBe("xyz");
  });

  it("duygu → rozet tonu: negatif destructive, pozitif success, nötr/boş muted", () => {
    expect(sentimentTone("negative")).toBe("destructive");
    expect(sentimentTone("positive")).toBe("success");
    expect(sentimentTone("neutral")).toBe("muted");
    expect(sentimentTone(null)).toBe("muted");
  });
});
