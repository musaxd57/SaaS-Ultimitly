// ---------------------------------------------------------------------------
// ÜRETİM ŞEKLİNDE FİKSTÜR (09-23). Üretimde tamamı 24k'ya sığan ≤30 kalemlik KB'de seçim YAPILMAZ
// (`select.ts` küçük-KB eşiği = legacy tavanı). Seçim mekaniğini sınayan testler bu yüzden 30 kalemi
// aşan bir KB kurar: kendi anlamlı kalemleri + hiçbir test sorgusuyla kelime paylaşmayan NÖTR dolgu.
// Dolgu seçiciyi parametreyle eğmez; yalnız KB'yi üretimde seçimin devreye girdiği boyuta taşır.
// ---------------------------------------------------------------------------
export interface PadItem {
  id: string;
  category: string;
  title: string;
  content: string;
  updatedAt: Date;
}

/** `n` nötr kalem; tarihleri `t0`dan ÖNCE (en yeni-30 sırasında gerçek kalemlerin arkasında). */
export function neutralPadding(n: number, t0 = Date.UTC(2026, 0, 1)): PadItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `pad_${i}`,
    category: "general",
    title: `Qzx ${i}`,
    content: `Qzxw vbnm plkj ${i}.`,
    updatedAt: new Date(t0 - (i + 1) * 60_000),
  }));
}
