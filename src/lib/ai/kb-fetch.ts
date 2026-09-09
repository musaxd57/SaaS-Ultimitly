import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { KB_ITEM_CAP, KB_RETRIEVAL_FETCH_CAP } from "@/lib/ai/limits";
import { kbRetrievalMode } from "@/lib/ai/retrieval/flag";
import { KB_APPROVAL_GATE_WHERE, isAiReadableReviewState } from "@/lib/kb-review";

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
  /**
   * İsteme giden kalemler. `id`/`updatedAt` YETKİLİ İÇ DENETİM içindir
   * (`RiskEvent.kbEvidenceJson`); istem metnine GİRMEZ — `packKnowledgeBase`
   * yalnız `category/title/content` okur, `withoutSecretKbItems` nesneyi
   * olduğu gibi taşır (bu yüzden süzgeçlerden sonra hizalama kendiliğinden
   * doğru kalır). Misafire dönen yanıt gövdesine ASLA konmaz (pin: testler).
   */
  items: {
    id: string;
    category: string;
    title: string;
    content: string;
    updatedAt: Date;
    /** A5 sürüm zinciri (bugün yazan yok); hibrit seçici halefi kümede olan kalemi düşürür. */
    supersededById: string | null;
  }[];
  /** Adet tavanı yüzünden istemin DIŞINDA kalan kalem sayısı (0 = kesme yok). */
  dropped: number;
  /**
   * A2 — AKTİF ama ONAY KAPISINDAN geçmeyen kalem sayısı (A1 `draft`).
   *
   * Neden ayrı sayılıyor: "bu mülkte hiç bilgi yok" ile "bilgi var ama henüz
   * onaylanmadı" bambaşka iki durumdur. İkincisinde host'a "şu bilgiyi ekle"
   * demek, zaten yazdığı şeyi yeniden yazdırmak olurdu. `dropped` ile de
   * karıştırılamaz: o kapasite (tavan), bu yetki (onay).
   */
  pendingApproval: number;
  /**
   * A2 — isteme giren kalemlerin EN YENİ `updatedAt`'i.
   *
   * 🚨 BU BİR SÜRÜM KİMLİĞİ DEĞİLDİR (kurucu düzeltmesi 09-08). Yalnız bir
   * TAZELİK İŞARETİDİR: iki bambaşka kalem kümesi aynı max'ı verebilir, kümeden
   * bir kalem çıkması bu değeri değiştirmeyebilir ve tek başına "hangi bilgiyle
   * cevap verildi" sorusunu YANITLAMAZ. O soruyu yanıtlayan şey `items`ten
   * üretilen kalem-kimliği + kalem-sürümü kanıtıdır (`buildKbEvidence`).
   * Kalem yoksa null — 0/şimdi gibi sahte bir değer üretilmez.
   */
  newestUpdatedAt: Date | null;
}

export async function fetchKnowledgeBaseForPrompt(
  where: Prisma.KnowledgeBaseItemWhereInput,
): Promise<KbForPrompt> {
  // ONAY KAPISI BURADA, ÇAĞIRANDA DEĞİL (A1, 09-08). Çağıranın filtresi ile
  // allowlist `AND`'lenir — yani bir yüzey `reviewState: "draft"` istese bile
  // taslak GELMEZ. Kapıyı buraya koymanın sebebi bu modülün var oluş sebebiyle
  // aynı: dört AI yüzeyi de buradan geçiyor (yapısal pin `ai-cost-guards`), o
  // yüzden "onaylanmamış metin modele gitmez" sözü tek bir yerde tutulabiliyor.
  //
  // `count` de AYNI birleşik filtreyi kullanır. Ayrı kalsaydı `dropped` taslak
  // sayısıyla şişerdi ve modele "N kalem yer sınırı nedeniyle alınamadı, emin
  // dille 'bilgim yok' deme, insana devret" notu gönderilirdi — HİÇ VAR OLMAYAN
  // bir bilgi için konuşma insana devredilirdi. Taslak eksik bilgi değildir,
  // henüz bilgi DEĞİLDİR.
  const gated: Prisma.KnowledgeBaseItemWhereInput = { AND: [where, KB_APPROVAL_GATE_WHERE] };
  // RAG dilim 1 (09-09): hibrit bayrak AÇIKKEN seçici bütün onaylı kümeyi
  // görmeli (uzun rehber en eski kalemse adet tavanı onu retrieval'dan ÖNCE
  // düşürürdü — ölçüldü). Modele giden miktarı artık `select.ts` bütçesi
  // sınırlar (6k karakter / 12 parça), bu okuma tavanı değil. Bayrak kapalıyken
  // `KB_ITEM_CAP` birebir eski davranış. Onay kapısı her iki dalda AYNI.
  const take = kbRetrievalMode() === "hybrid" ? KB_RETRIEVAL_FETCH_CAP : KB_ITEM_CAP;
  // A2: tek `count` yerine `groupBy` — SORGU SAYISI ARTMADAN hem onay kapısını
  // geçen toplam hem de kapıda kalan (`draft`) sayısı aynı taramadan çıkıyor.
  // Çağıranın filtresi burada KAPISIZ kullanılır; kapı zaten `gated`ta.
  const [rows, byState] = await Promise.all([
    prisma.knowledgeBaseItem.findMany({
      where: gated,
      // `id`/`updatedAt` YETKİLİ İÇ DENETİM içindir. İstem metnine girmezler:
      // `packKnowledgeBase` yalnız `category/title/content` okur (yapısal pin).
      select: { id: true, category: true, title: true, content: true, updatedAt: true, supersededById: true },
      // "En son güncellenen kazanır": host bir bilgiyi düzelttiyse istemde
      // kalan o olsun. Düşenler en eski dokunulmuş kayıtlardır.
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.knowledgeBaseItem.groupBy({
      by: ["reviewState"],
      where,
      _count: { _all: true },
    }),
  ]);

  let total = 0;
  let pendingApproval = 0;
  for (const g of byState) {
    if (isAiReadableReviewState(g.reviewState)) total += g._count._all;
    else pendingApproval += g._count._all;
  }
  // Sıralama `updatedAt desc` olduğu için ilk satır en yenisi; yine de boş
  // listede `undefined` yerine açıkça null döndürülüyor.
  const newestUpdatedAt = rows[0]?.updatedAt ?? null;
  return { items: rows, dropped: Math.max(0, total - rows.length), pendingApproval, newestUpdatedAt };
}
