import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

import { warmPropertyKbVectors, __resetBootWarm } from "@/lib/ai/embeddings/kb-warm";
import {
  __awaitSemanticWarm,
  __exhaustWarmBudgetForTests,
  __resetSemanticRetrieval,
  __semanticStoreSize,
  __setChunkVectorCacheMaxForTests,
  prepareSemanticScores,
} from "@/lib/ai/embeddings/semantic-retrieval";
import { clearEmbeddingCache, EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings/provider";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { chunkItems } from "@/lib/ai/retrieval/chunker";
import { embeddingTextFor } from "@/lib/ai/embeddings/context-text";
import { fetchKnowledgeBaseForPrompt } from "@/lib/ai/kb-fetch";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { inputHashOf } from "@/lib/ai/embeddings/vector-store";
import { afterKbItemsChanged } from "@/lib/kb/after-change";

// ---------------------------------------------------------------------------
// EMB DOĞRULAMA (kurucu 11-19 akşam, madde 2) — ÜRÜN KODU DEĞİŞMEZ; bugünkü davranışı çalıştırarak gösterir.
//
// Soru 1 (kurucu: "Güncel bilgi henüz vektörleşmediyse eski şifreyi getirmeyelim"): bilgi tabanı kalemi değişti (Wi-Fi şifresi), yeni
// içeriğin vektörü henüz yok (saatlik ısıtma bütçesi dolu / kanca koşmadı / başka kopya). Eski içeriğin VEKTÖRÜ ya da METNİ seçime / isteme
// girebiliyor mu? Bilinen yapı: vektör depoları İÇERİK anahtarlıdır (bellek: model + gömme metni özeti; kalıcı depo: kalem + girdi özeti),
// dizin önbelleği içerik parmak izlidir, bilgi tabanı her istekte veritabanından okunur, eksik parça varsa karar tamamen sözcükseldir
// (YARIM HARİTA YOK). Testler bunu uçtan uca (veritabanı → `retrieveKbForPrompt` → istem bloğu) sınar.
//
// Soru 2 (kurucu gözlemi: "sınır dolunca hazır ve güncel vektörler kullanılamaz hâle gelmiyor"): A işletmesi GERÇEK düzenlemelerle süreç
// genelindeki ısıtma bütçesini tüketir; B'nin önceden ısınmış bilgi tabanı anlamsal aramayı sürdürür mü? Koşul kolları: B'nin vektörleri
// bellekten tahliye edildiyse (kalıcı depo kapalı / açık) ve B o sırada kendi kalemini düzenlerse.
//
// Gömme sağlayıcısı taklit (ağ yok): kavram boyutu + metne özgü gürültü — parafraz aynı kavrama düşer, iki farklı metin aynı vektörü almaz.
// ---------------------------------------------------------------------------

const OLD = "ESKI-4821";
const NEW = "YENI-7305";
const DIRECT = "Wi-Fi şifresi ne?";
const PARAPHRASE = "İnternete bağlanmak için ne yazmam gerekiyor?";

const CONCEPTS: [RegExp, number][] = [[/wi-?fi|nternet|şifre|sifre|parola|kablosuz|modem/i, 0]];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function fakeVec(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [re, dim] of CONCEPTS) if (re.test(text)) v[dim] = 1;
  v[100 + (hash(text) % 1400)] += 0.3;
  return v;
}

/** Her gömme isteği: gönderilen metinler. Parça metinleri `kategori · başlık` önekiyle başlar (`embeddingTextFor`); sorgular başlamaz. */
const calls: string[][] = [];
const isChunkText = (t: string) => /^(general|wifi)\b/.test(t);
const chunkTextsEmbedded = () => calls.flat().filter(isChunkText);

function wifiText(pass: string): string {
  return `Ağ adı: LaleNet. Şifre: ${pass}. Modem salondaki dolabın üstündedir.`;
}

/** Uzun ev rehberi: şifre cümlesi ORTADA; parçalayıcı birkaç parçaya böler. */
function wifiGuide(pass: string, lead = ""): string {
  const s = (k: number) => `Rehber satırı ${k} dairenin kullanımına dair ayrıntılı bir açıklama içeriyor ve misafire yol gösteriyor.`;
  const before = Array.from({ length: 12 }, (_, k) => s(k)).join(" ");
  const after = Array.from({ length: 12 }, (_, k) => s(k + 20)).join(" ");
  return `${lead}${before} Kablosuz ağ adı LaleNet, şifre ${pass} olarak ayarlıdır. ${after}`;
}

async function seedNeutral(propertyId: string, n: number, tag = "Bilgi") {
  for (let i = 0; i < n; i++) {
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "general", title: `${tag} ${i}`, content: `Dairedeki ${i}. ${tag.toLowerCase()} notu.`, isActive: true, source: "host_manual", reviewState: "approved" },
    });
  }
}

async function createItem(propertyId: string, category: string, title: string, content: string) {
  return prisma.knowledgeBaseItem.create({
    data: { propertyId, category, title, content, isActive: true, source: "host_manual", reviewState: "approved" },
    select: { id: true },
  });
}

const kbOf = async (propertyId: string) => (await fetchKnowledgeBaseForPrompt({ propertyId, isActive: true })).items;

/** Dört yüzeyin TEK girişi + istem bloğu (`packKnowledgeBase`, modele giden metin). Her çağrı bilgi tabanını veritabanından yeniden okur. */
async function retrieve(propertyId: string, guestMessage: string) {
  const r = await retrieveKbForPrompt({ items: await kbOf(propertyId), guestMessage });
  const block = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
  return { r, block, sem: r.evidence?.sem, fb: r.evidence?.fb };
}

async function warmAndWait(propertyId: string): Promise<number> {
  const queued = await warmPropertyKbVectors(propertyId);
  await __awaitSemanticWarm();
  return queued;
}

/** "Yeniden başlatma / başka kopya": süreç belleği (vektör deposu + gömme önbelleği + dizin) sıfır; veritabanı yerinde. */
function restart() {
  __resetSemanticRetrieval();
  __resetKbIndexCache();
  __resetBootWarm();
  clearEmbeddingCache();
  calls.length = 0;
}

beforeEach(async () => {
  await resetDb();
  restart();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("KB_RETRIEVAL_MODE", "");
  vi.stubEnv("KB_SEMANTIC_RETRIEVAL", "1");
  vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      if (!String(url).includes("/embeddings")) throw new Error(`beklenmeyen ağ çağrısı ${String(url)}`);
      const { input } = JSON.parse(init.body) as { input: string[] };
      calls.push(input);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: input.map((t, index) => ({ index, embedding: fakeVec(t) })) }) };
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("EMB-1 bayat vektör — güncel içerik vektörleşmeden misafir sorusu", () => {
  it("bellek deposu: şifre değişti, ısıtma bütçesi dolu → karar 'cold', istemde YENİ şifre var, ESKİ yok; eski vektör bellekte durduğu hâlde kullanılmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 35);
    const wifi = await createItem(propertyId, "wifi", "Wi-Fi", wifiText(OLD));
    await warmAndWait(propertyId);

    // KONTROL (test vakum değil): vektörler hazırken anlamsal kaynak koşar ve eski şifre istemdedir.
    const ready = await retrieve(propertyId, DIRECT);
    expect(ready.sem).toBe("ok");
    expect(ready.block).toContain(OLD);
    const storeBefore = __semanticStoreSize();

    // Host şifreyi değiştirir; ısıtma bütçesi başkaları tarafından tüketilmiş (G2: 300/dk düzenlemeyle birkaç dakikada ulaşılır).
    __exhaustWarmBudgetForTests();
    await prisma.knowledgeBaseItem.update({ where: { id: wifi.id }, data: { content: wifiText(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    expect(await warmAndWait(propertyId)).toBe(0); // bütçe reddetti: yeni metin kuyruğa girmedi
    // Eski parçanın vektörü bellekte DURUYOR (silinmedi, yenisi eklenmedi) — yani "kullanılabilecek" bir bayat vektör var.
    expect(__semanticStoreSize()).toBe(storeBefore);

    for (const msg of [DIRECT, PARAPHRASE]) {
      const cold = await retrieve(propertyId, msg);
      console.log(`EMB1 bellek msg="${msg}" sem=${cold.sem} fb=${cold.fb} sel=${cold.r.evidence?.sel}`);
      expect(cold.sem).toBe("cold");
      expect(cold.block).not.toContain(OLD);
      expect(cold.block).toContain(NEW);
      for (const it of cold.r.items) expect(it.content).not.toContain(OLD);
    }
    expect(chunkTextsEmbedded().filter((t) => t.includes(NEW))).toEqual([]); // yeni metin hiç gömülmedi (karar gerçekten vektörsüz)
  });

  it("kalıcı depo AÇIK, yazma kancası HİÇ koşmadı (eski satır veritabanında) + başka kopya / yeniden başlatma → eski satır okunmaz, karar 'cold', istemde YENİ şifre", async () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
    const { propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 35);
    const wifi = await createItem(propertyId, "wifi", "Wi-Fi", wifiText(OLD));
    await warmAndWait(propertyId);
    const oldRows = await prisma.kbChunkVector.findMany({ where: { kbItemId: wifi.id }, select: { inputHash: true } });
    expect(oldRows.length).toBe(1);

    // Kanca koşmadan düzenleme (süreç arada öldü / kanca hata verdi): eski metnin satırı tabloda KALIR.
    await prisma.knowledgeBaseItem.update({ where: { id: wifi.id }, data: { content: wifiText(NEW) } });
    restart();
    __exhaustWarmBudgetForTests();
    const stale = await prisma.kbChunkVector.findMany({ where: { kbItemId: wifi.id }, select: { inputHash: true } });
    expect(stale.map((r) => r.inputHash)).toEqual(oldRows.map((r) => r.inputHash));

    for (const msg of [DIRECT, PARAPHRASE]) {
      const cold = await retrieve(propertyId, msg);
      console.log(`EMB1 depo msg="${msg}" sem=${cold.sem} fb=${cold.fb}`);
      expect(cold.sem).toBe("cold");
      expect(cold.block).not.toContain(OLD);
      expect(cold.block).toContain(NEW);
    }
    // Isıtma da eski satırı yeni metnin vektörü sanmaz: depo okuması yeni metnin özetini bulamaz, bütçe dolu → hiçbir parça gömülmez,
    // karar cold kalır. (Depo açıkken `warmPropertyKbVectors` dönüşü depodan OKUNMAK üzere kuyruğa alınan metin sayısıdır — bütçe kararı
    // okumadan sonra verilir; bu yüzden burada dönüş değil gömülen parça sayılır.)
    await warmAndWait(propertyId);
    expect(chunkTextsEmbedded()).toEqual([]);
    expect((await retrieve(propertyId, DIRECT)).sem).toBe("cold");
    // Bellekte artık yeni metnin anahtarı yok; eski satırın girdi özeti yeni metnin özeti değil (içerik adresli).
    const kb = await kbOf(propertyId);
    const newText = chunkItems(kb.filter((i) => i.id === wifi.id)).map((c) => embeddingTextFor(c));
    expect(newText.map(inputHashOf)).not.toContain(oldRows[0].inputHash);
  });

  it("uzun rehber: yalnız şifre cümlesi değişti, öteki parçaların vektörü güncel → yine 'cold' (yarım harita yok), istemde YENİ şifre", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 35);
    const guide = await createItem(propertyId, "general", "Ev rehberi", wifiGuide(OLD));
    await warmAndWait(propertyId);
    const before = chunkItems((await kbOf(propertyId)).filter((i) => i.id === guide.id)).map((c) => embeddingTextFor(c));
    expect(before.length).toBeGreaterThanOrEqual(3);
    expect((await retrieve(propertyId, DIRECT)).sem).toBe("ok");

    __exhaustWarmBudgetForTests();
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { content: wifiGuide(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    expect(await warmAndWait(propertyId)).toBe(0);
    const after = chunkItems((await kbOf(propertyId)).filter((i) => i.id === guide.id)).map((c) => embeddingTextFor(c));
    const changed = after.filter((t) => !before.includes(t));
    expect(changed.length).toBe(1); // aynı uzunlukta şifre → tek parça değişti

    const cold = await retrieve(propertyId, DIRECT);
    expect(cold.sem).toBe("cold");
    expect(cold.block).not.toContain(OLD);
    expect(cold.block).toContain(NEW);
  });

  it("ÖLÇÜM (tasarım belgesinin 'bugün' sütunu): soğuk pencerede örnek mesajların getirme sonucu — hiçbirinde eski şifre yok", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 45);
    const wifi = await createItem(propertyId, "wifi", "Wi-Fi", wifiText(OLD));
    await warmAndWait(propertyId);
    __exhaustWarmBudgetForTests();
    await prisma.knowledgeBaseItem.update({ where: { id: wifi.id }, data: { content: wifiText(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    await warmAndWait(propertyId);
    const samples = [DIRECT, PARAPHRASE, "Merhaba, nasılsınız?", "Teşekkürler, her şey çok güzel!", "Какой пароль от вайфая?", "ما هي كلمة مرور الواي فاي؟"];
    for (const msg of samples) {
      const r = await retrieve(propertyId, msg);
      console.log(
        `EMB-ORNEK msg="${msg}" sem=${r.sem} fb=${r.fb} seçim=${r.r.selection} kalem=${r.r.items.length} düşen=${r.r.droppedItems} yeniŞifre=${r.block.includes(NEW)}`,
      );
      // Selamlaşma / teşekkürde arama sorgusu yok → gömme gerekmez (`not_needed`); geri kalan hepsi soğuk.
      expect(["cold", "not_needed"]).toContain(r.sem);
      expect(r.block).not.toContain(OLD);
    }
  });

  it("KONTROL: bütçe açıldığında yeni metin ısıtılır → 'ok', anlamsal kaynak YENİ şifreyi getirir (parafrazda da)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 35);
    const wifi = await createItem(propertyId, "wifi", "Wi-Fi", wifiText(OLD));
    await warmAndWait(propertyId);
    await prisma.knowledgeBaseItem.update({ where: { id: wifi.id }, data: { content: wifiText(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    await warmAndWait(propertyId); // kancanın ısıtmasıyla yarışır; aynı metin ikinci kez kuyruğa alınmaz
    for (const msg of [DIRECT, PARAPHRASE]) {
      const ok = await retrieve(propertyId, msg);
      expect(ok.sem).toBe("ok");
      expect(ok.block).toContain(NEW);
      expect(ok.block).not.toContain(OLD);
    }
  });
});

describe("EMB-1 maliyet ölçümü — değişmeyen parça, ara sürümler (doğruluk değil, bedel)", () => {
  it("aynı süreçte: değişen parça kadar gömülür (parça içerik özeti); parça payını aşan ekleme sınırları kaydırır; başlık değişimi bütün parçaları", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 35);
    const guide = await createItem(propertyId, "general", "Ev rehberi", wifiGuide(OLD));
    await warmAndWait(propertyId);
    const partsOf = async () => chunkItems((await kbOf(propertyId)).filter((i) => i.id === guide.id)).length;
    const total = await partsOf();
    const edit = async (data: { content?: string; title?: string }) => {
      // Sağlayıcının süreç önbelleği (LRU 256) bu küçük kümede yeniden gömmeyi MASKELER — büyük bilgi tabanında ya da çok kiracıda
      // tutmaz. Ölçülen şey ısıtmanın kendi "zaten var" süzgeci olsun diye her düzenlemeden önce boşaltılır (mutasyon 11-19: süzgeci
      // kaldıran mutant önbellek yüzünden yaşıyordu).
      clearEmbeddingCache();
      calls.length = 0;
      await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data });
      await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
      await warmAndWait(propertyId);
      return chunkTextsEmbedded().length;
    };

    const sameLen = await edit({ content: wifiGuide(NEW) });
    // Kısa ekleme ilk parçanın boş payına sığar (hedef 600, parça ~535) → yalnız ilk parça değişir.
    const leadSmall = await edit({ content: wifiGuide(NEW, "Önemli: giriş kapısı ağır kapanır. ") });
    // Payı aşan ekleme: ilk parça dolar, sonraki parçaların başlangıcı kayar.
    const leadLarge = await edit({
      content: wifiGuide(NEW, "Önemli: giriş kapısı ağır kapanır, lütfen yavaşça kapatın ve kilidi iki tur çevirin. Bina girişindeki zil paneli gece yarısından sonra sessize alınır, kapı kodunu kullanın. "),
    });
    const titleOnly = await edit({ title: "Ev rehberi (güncel)" });
    const finalParts = await partsOf();

    console.log(`EMB-COST kalemParça=${total} aynıUzunlukŞifre=${sameLen} kısaEk=${leadSmall} uzunEk=${leadLarge} sonParça=${finalParts} yalnızBaşlık=${titleOnly}`);
    expect(sameLen).toBe(1);
    expect(leadSmall).toBe(1);
    expect(leadLarge).toBeGreaterThan(1);
    expect(titleOnly).toBe(finalParts); // başlık gömme metninin önekinde → kalemin bütün parçaları
  });

  it("ısınmış dairede yeniden ısıtma (kanca / açılış yolu, bütün parçaları verir) hiçbir parçayı yeniden gömmez — sağlayıcı önbelleği boşken de", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 35);
    await createItem(propertyId, "general", "Ev rehberi", wifiGuide(OLD));
    await warmAndWait(propertyId);
    clearEmbeddingCache();
    calls.length = 0;
    expect(await warmAndWait(propertyId)).toBe(0);
    expect(calls.length).toBe(0);
  });

  it("kalıcı depo AÇIK + düzenleyen süreçte vektörler bellekte YOK (tahliye / soğuk kopya): kanca kalemin BÜTÜN satırlarını siler → değişmeyen parçalar da yeniden gömülür", async () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 35);
    const guide = await createItem(propertyId, "general", "Ev rehberi", wifiGuide(OLD));
    await warmAndWait(propertyId);
    const total = await prisma.kbChunkVector.count({ where: { kbItemId: guide.id } });
    expect(total).toBeGreaterThanOrEqual(3);

    restart(); // bu süreçte rehberin vektörleri bellekte yok
    await prisma.knowledgeBaseItem.update({ where: { id: guide.id }, data: { content: wifiGuide(NEW) } });
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] }); // önce temizlik: kalemin bütün satırları gider
    await warmAndWait(propertyId);
    const reembedded = chunkTextsEmbedded().filter((t) => t.startsWith("general · Ev rehberi")).length;
    console.log(`EMB-COST depo kalemParça=${total} değişenParça=1 yenidenGömülen=${reembedded}`);
    expect(reembedded).toBe(total); // ideal 1; bugün kalem düzeyinde silme yüzünden hepsi
  });

  it("ara sürümler: host aynı kaydı birkaç saniye arayla 5 kez kaydederse her sürüm ayrı ödenir (kuyrukta birleştirme yok)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await seedNeutral(propertyId, 35);
    const wifi = await createItem(propertyId, "wifi", "Wi-Fi", wifiText(OLD));
    await warmAndWait(propertyId);
    calls.length = 0;
    for (let v = 0; v < 5; v++) {
      clearEmbeddingCache(); // ↑ aynı gerekçe: önbellek ısıtmanın süzgecini maskelemesin
      await prisma.knowledgeBaseItem.update({ where: { id: wifi.id }, data: { content: wifiText(`YENI-73${v}0`) } });
      await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
      await warmAndWait(propertyId);
    }
    const wifiEmbeds = chunkTextsEmbedded().filter((t) => t.startsWith("wifi"));
    console.log(`EMB-COST araSürüm kayıt=5 gömülenWifiParçası=${wifiEmbeds.length}`);
    expect(wifiEmbeds.length).toBe(5);
  });
});

// ─── EMB-2: gürültülü komşu ──────────────────────────────────────────────────

/** A'nın bir tur toplu düzenlemesi: her cümle tur numarasını taşır → her parça yeni metin (G2'nin döngüsünden hızlı, aynı kanca). */
function attackerContent(round: number, i: number): string {
  return Array.from({ length: 50 }, (_, k) => `Tur ${round} kalem ${i} satır ${k} kullanım bilgisi burada yer alıyor.`).join(" ");
}

async function seedAttacker(propertyId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 30; i++) ids.push((await createItem(propertyId, "general", `Saldirgan ${i}`, attackerContent(0, i))).id);
  return ids;
}

/**
 * A, bütçe reddedene kadar düzenler. Dönüş: tur sayısı ve bu sürede gömülen parça metni. İlerleme ölçüsü "bu turda gömülen parça arttı mı":
 * kancanın beklenmeyen ısıtması ile testin beklenen ısıtması aynı metinleri yarışarak kuyruğa alır (ikincisi 0 döner), dönüş değeri ölçü
 * olamaz. Bir tur ya tamamen gömülür ya tamamen reddedilir (`takeWarmBudget` hepsi-ya-hiç).
 */
async function attackerSpree(orgId: string, propertyId: string, ids: readonly string[]): Promise<{ rounds: number; embedded: number }> {
  const start = chunkTextsEmbedded().length;
  let round = 1;
  for (; round <= 60; round++) {
    const before = chunkTextsEmbedded().length;
    for (let i = 0; i < ids.length; i++) {
      await prisma.knowledgeBaseItem.update({ where: { id: ids[i] }, data: { content: attackerContent(round, i) } });
    }
    await afterKbItemsChanged({ organizationId: orgId, propertyIds: [propertyId] });
    await warmAndWait(propertyId);
    if (chunkTextsEmbedded().length === before) break; // bütçe doldu: bu turun metinleri kuyruğa girmedi
  }
  return { rounds: round, embedded: chunkTextsEmbedded().length - start };
}

const B_QUESTION = "Dairedeki 3. bilgi notu nedir?";

describe("EMB-2 bütçe doluyken B'nin güncel ve hazır vektörleri", () => {
  it("A gerçek düzenlemelerle bütçeyi tüketir; B'nin önceden ısınmış bilgi tabanı 'ok' kalır (yalnız sorgu gömülür, tek istek); A'nın kendi son sürümü 'cold'", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await seedNeutral(b.propertyId, 35);
    await warmAndWait(b.propertyId);
    expect((await retrieve(b.propertyId, B_QUESTION)).sem).toBe("ok");

    const ids = await seedAttacker(a.propertyId);
    const spree = await attackerSpree(a.orgId, a.propertyId, ids);
    console.log(`EMB2 A tur=${spree.rounds} gömülen=${spree.embedded}`);
    expect(spree.rounds).toBeLessThan(60); // bütçe gerçekten doldu
    __exhaustWarmBudgetForTests(); // turdan küçük kalan pay da dolu: B'nin sorusu TAMAMEN dolu bütçeyle sınanır

    calls.length = 0;
    const bNow = await retrieve(b.propertyId, B_QUESTION);
    expect(bNow.sem).toBe("ok");
    expect(calls.length).toBe(1); // misafir mesajı başına tek gömme isteği (yalnız sorgu metinleri)
    expect(chunkTextsEmbedded()).toEqual([]);
    calls.length = 0;
    expect((await retrieve(b.propertyId, B_QUESTION)).sem).toBe("ok");
    expect(calls.length).toBe(0); // aynı soru: sorgu vektörü süreç önbelleğinden (sağlayıcıya istek yok)

    expect((await retrieve(a.propertyId, "Tur kalem satır bilgisi nedir?")).sem).toBe("cold");
  }, 300_000);

  it("BUGÜNKÜ AÇIK (G2): bütçe doluyken B kendi kalemini düzenlerse B 'cold' kalır ve ısıtma reddedilir (pencere açılana kadar sözcüksel)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await seedNeutral(b.propertyId, 35);
    const bWifi = await createItem(b.propertyId, "wifi", "Wi-Fi", wifiText(OLD));
    await warmAndWait(b.propertyId);
    const ids = await seedAttacker(a.propertyId);
    await attackerSpree(a.orgId, a.propertyId, ids);
    // Toplu tur reddedildiğinde pencerede küçük bir pay kalabilir (< tur boyu); A tek kalemlik düzenlemelerle onu da tüketir.
    __exhaustWarmBudgetForTests();

    await prisma.knowledgeBaseItem.update({ where: { id: bWifi.id }, data: { content: wifiText(NEW) } });
    await afterKbItemsChanged({ organizationId: b.orgId, propertyIds: [b.propertyId] });
    expect(await warmAndWait(b.propertyId)).toBe(0);
    const bNow = await retrieve(b.propertyId, DIRECT);
    expect(bNow.sem).toBe("cold");
    expect(bNow.block).toContain(NEW); // içerik yine güncel — kayıp yalnız anlamsal arama
    expect(bNow.block).not.toContain(OLD);
  }, 300_000);

  it("KOŞUL: B'nin vektörleri bellekten tahliye edildiyse — kalıcı depo KAPALIYKEN B 'cold' kalır ve yeniden ısıtma bütçeye takılır; AÇIKKEN depodan okunur, 'ok'", async () => {
    // Üretimde bellek tavanı 4.096 parça, bütçe 2.000 / saat / süreç → B'nin iki sorusu arasında ≥ 4.096 yeni parça (≈ 2+ saat doymuş
    // bütçe) gerekir. Test bu koşula erişmek için bellek tavanını küçültür; mekanizma aynıdır.
    for (const storeOn of [false, true]) {
      await resetDb();
      restart();
      vi.stubEnv("KB_VECTOR_STORE_ENABLED", storeOn ? "1" : "");
      const a = await makeOrgWithProperty();
      const b = await makeOrgWithProperty();
      await seedNeutral(b.propertyId, 35);
      await warmAndWait(b.propertyId);
      __setChunkVectorCacheMaxForTests(80);
      expect((await retrieve(b.propertyId, B_QUESTION)).sem).toBe("ok");

      const ids = await seedAttacker(a.propertyId);
      await attackerSpree(a.orgId, a.propertyId, ids);
      __exhaustWarmBudgetForTests(); // kalan küçük pay da dolu (↑ aynı gerekçe)
      calls.length = 0;
      const bNow = await retrieve(b.propertyId, B_QUESTION);
      const rewarm = await warmAndWait(b.propertyId);
      const bAfter = await retrieve(b.propertyId, B_QUESTION);
      console.log(`EMB2 tahliye depo=${storeOn ? "açık" : "kapalı"} B=${bNow.sem} yenidenIsıtma=${rewarm} sonra=${bAfter.sem} gömülenParça=${chunkTextsEmbedded().length}`);
      if (storeOn) {
        expect(bNow.sem).toBe("ok");
        expect(chunkTextsEmbedded()).toEqual([]);
      } else {
        expect(bNow.sem).toBe("cold");
        expect(rewarm).toBe(0);
        expect(bAfter.sem).toBe("cold");
      }
    }
  }, 600_000);
});
