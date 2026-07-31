import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { KB_ITEM_CAP } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// BİLGİ TABANINI İSTEM İÇİN ÇEK — TEK YOL (denetim, 07-31).
//
// Neden ayrı bir modül: adet tavanı (`KB_ITEM_CAP`) SQL'de uygulanıyor, yani
// `packKnowledgeBase` düşen kalemleri GÖREMİYOR. Sonuç sessiz ve pahalıydı:
// İşletme planı daire başına 60 kayıt satıyor ama AI bir yanıtta 30 okuyor →
// diğer 30 iz bırakmadan düşüyor ve model, host'un GERÇEKTEN yazdığı bir konuda
// kendinden emin "bilgim yok" diyebiliyordu. Oysa ürünün kuralı: bilmiyorsan
// insana devret.
//
// Dört çağıran (oto-yanıt · inbox öneri · test kartı · QR concierge) bu
// fonksiyondan geçer; hem tavan hem "kaç tanesi düştü" tek yerde kalır. Beşinci
// bir yer tavansız sorgu yazarsa aradaki fark burada görünür olur.
//
// Ekstra `count()` bilinçli: küçük ve indeksli bir tablo üzerinde tek round-trip,
// ve hemen ardından saniyeler süren bir model çağrısı geliyor. "En az 1 düştü"
// demek için `take: CAP + 1` numarası daha ucuz olurdu ama modele YANLIŞ sayı
// söylerdi — dürüstlük burada hıza tercih edildi.
// ---------------------------------------------------------------------------

export interface KbForPrompt {
  items: { category: string; title: string; content: string }[];
  /** Adet tavanı yüzünden istemin DIŞINDA kalan kalem sayısı (0 = kesme yok). */
  dropped: number;
}

export async function fetchKnowledgeBaseForPrompt(
  where: Prisma.KnowledgeBaseItemWhereInput,
): Promise<KbForPrompt> {
  const [items, total] = await Promise.all([
    prisma.knowledgeBaseItem.findMany({
      where,
      select: { category: true, title: true, content: true },
      // "En son güncellenen kazanır": host bir bilgiyi düzelttiyse istemde
      // kalan o olsun. Düşenler en eski dokunulmuş kayıtlardır.
      orderBy: { updatedAt: "desc" },
      take: KB_ITEM_CAP,
    }),
    prisma.knowledgeBaseItem.count({ where }),
  ]);
  return { items, dropped: Math.max(0, total - items.length) };
}
