import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { KB_ITEM_CAP, KB_RETRIEVAL_FETCH_CAP } from "@/lib/ai/limits";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { selectKbForPrompt, type KbSelectSources } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { makeSyntheticKb, updatedItem, type SynQuestion, type SyntheticKb } from "../helpers/kb-retrieval-synthetic";

// ---------------------------------------------------------------------------
// ÖLÇEK HARNESS'I — 30 / 100 / 300 kalem, GERÇEK retrieval yolu (RAG dilim 2+3).
//
// Codex şartları:
//  · küçük-KB passthrough'u değil, seçim yapan yolu ölç; legacy (en yeni 30 + 24k)
//    ile aynı soruları koş;
//  · (dilim 3) CANLI AKIŞI ölç: hibritte `kb-fetch` en yeni 200 kalemi okur —
//    300'lük testte seçiciye 336 kalemin tamamını vermek canlıyı ölçmezdi →
//    "CANLI" yapılandırması tavanı uygular (`KB_RETRIEVAL_FETCH_CAP`);
//  · (dilim 3) "istemde doğru kaynak" kalem KİMLİĞİ ile değil, CEVAP İÇİN GEREKLİ
//    METİN (`needles`) ile ölçülür — kimlik blokta olup cümle olmayabilir;
//  · (dilim 3) n-gram kaynağı yazım hatası / ek varyasyonu / İngilizce sorularda
//    AYRI ölçülür; varsayılan ("auto" = yalnız Türkçe sorguda) buna dayanır.
// Ölçülen: hit@1/hit@3 (kimlik), inPrompt(kimlik), inPrompt(METİN), gürültü,
// karakter (maliyet vekili), gecikme (soğuk/ılık), güncelleme/silme doğruluğu.
// Model YOK: "cevabın kaynakla desteklenmesi" burada ölçülmez (gerçek eval işi;
// eşleştirilmiş harness `tests/eval/kb-retrieval-paired.eval.test.ts`).
// Rapor: KB_RETRIEVAL_REPORT=1 → docs/olcum/kb-retrieval-scale-<tarih>.md
// ---------------------------------------------------------------------------

const SIZES = [30, 100, 300] as const;

interface Config {
  name: string;
  /** null = legacy ayna. */
  sources: KbSelectSources | null;
  /** `kb-fetch` okuma tavanını uygula (canlı hibrit). */
  liveCap?: boolean;
}

const CONFIGS: readonly Config[] = [
  { name: "legacy (en yeni 30 + 24k)", sources: null },
  { name: "hibrit bm25 (n-gram KAPALI)", sources: { ngram: false } },
  { name: "hibrit n-gram AÇIK (her sorguda)", sources: { ngram: true } },
  { name: "hibrit RRF (bm25+ngram)", sources: { ngram: true, fusion: "rrf" } },
  { name: "hibrit VARSAYILAN (n-gram auto=TR, CombSUM)", sources: {} },
  { name: "hibrit CANLI (varsayılan + kb-fetch tavanı 200)", sources: {}, liveCap: true },
];

interface KindStat {
  n: number;
  inPrompt: number;
  hit1: number;
  noise: number;
}

interface ConfigResult {
  name: string;
  /** Seçiciye verilen kalem sayısı (canlı tavan sonrası). */
  pool: number;
  hit1: number;
  hit3: number;
  /** Doğru kalem KİMLİĞİ blokta. */
  inPromptId: number;
  /** Cevap için gerekli METİN blokta (asıl ölçü). */
  inPrompt: number;
  noise: number;
  chars: number;
  coldMs: number;
  warmP50: number;
  warmP95: number;
  fallbacks: number;
  perKind: Record<string, KindStat>;
}

interface SizeResult {
  n: number;
  items: number;
  questions: number;
  configs: ConfigResult[];
  updateOk: number;
  updateTotal: number;
  deleteOk: number;
  deleteTotal: number;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

function legacyPrompt(kb: SyntheticKb): { ids: string[]; text: string } {
  const sorted = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const sel = sorted.slice(0, KB_ITEM_CAP);
  // packKnowledgeBase karakter bütçesi de uygulanır: bloğa GİREN kalemler ölçülür.
  const text = packKnowledgeBase(sel, kb.items.length - sel.length).text;
  const ids = sel.filter((i) => text.includes(`] ${i.title}:`)).map((i) => i.id);
  return { ids, text };
}

function runConfig(kb: SyntheticKb, cfg: Config): ConfigResult {
  const sorted = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  // CANLI: `kb-fetch` hibritte `updatedAt desc` + take KB_RETRIEVAL_FETCH_CAP.
  const pool = cfg.liveCap ? sorted.slice(0, KB_RETRIEVAL_FETCH_CAP) : sorted;
  const fetchDropped = sorted.length - pool.length;
  let hit1 = 0;
  let hit3 = 0;
  let inPromptId = 0;
  let inPrompt = 0;
  let noise = 0;
  let chars = 0;
  let fallbacks = 0;
  const warm: number[] = [];
  const perKind: Record<string, KindStat> = {};
  let coldMs = 0;
  const legacy = cfg.sources === null ? legacyPrompt(kb) : null;
  kb.questions.forEach((q, qi) => {
    const gold = new Set(q.goldIds);
    let orderedIds: string[] = [];
    let text = "";
    if (legacy) {
      orderedIds = legacy.ids;
      text = legacy.text;
    } else {
      if (qi === 0) __resetKbIndexCache();
      const t0 = performance.now();
      const r = selectKbForPrompt({ items: pool, guestMessage: q.text, mode: "hybrid", sources: cfg.sources ?? undefined });
      const ms = performance.now() - t0;
      if (qi === 0) coldMs = ms;
      else warm.push(ms);
      if (r.evidence?.fb && r.evidence.fb !== "none") fallbacks += 1;
      orderedIds = [];
      for (const it of r.items) if (!orderedIds.includes(it.id)) orderedIds.push(it.id);
      text = packKnowledgeBase(r.items, fetchDropped + r.droppedItems, r.selection, r.notes).text;
    }
    const idPresent = orderedIds.some((id) => gold.has(id));
    const needlePresent = q.needles.some((n) => text.includes(n));
    const h1 = !legacy && !!orderedIds[0] && gold.has(orderedIds[0]);
    if (!legacy) {
      if (h1) hit1 += 1;
      if (orderedIds.slice(0, 3).some((id) => gold.has(id))) hit3 += 1;
    }
    if (idPresent) inPromptId += 1;
    if (needlePresent) inPrompt += 1;
    const qNoise = orderedIds.filter((id) => !gold.has(id)).length;
    noise += qNoise;
    chars += text.length;
    const pk = (perKind[q.kind] ??= { n: 0, inPrompt: 0, hit1: 0, noise: 0 });
    pk.n += 1;
    if (needlePresent) pk.inPrompt += 1;
    if (h1) pk.hit1 += 1;
    pk.noise += qNoise;
  });
  const Q = kb.questions.length;
  return {
    name: cfg.name,
    pool: pool.length,
    hit1: hit1 / Q,
    hit3: hit3 / Q,
    inPromptId: inPromptId / Q,
    inPrompt: inPrompt / Q,
    noise: noise / Q,
    chars: Math.round(chars / Q),
    coldMs: Math.round(coldMs * 10) / 10,
    warmP50: Math.round(percentile(warm, 0.5) * 10) / 10,
    warmP95: Math.round(percentile(warm, 0.95) * 10) / 10,
    fallbacks,
    perKind,
  };
}

/** Güncelleme/silme sonrası doğruluk — hibrit varsayılan yapılandırma. */
function updateDelete(kb: SyntheticKb): { updateOk: number; updateTotal: number; deleteOk: number; deleteTotal: number } {
  const topics = [...kb.goldByTopic.keys()].slice(0, 10);
  let updateOk = 0;
  let deleteOk = 0;
  for (const topic of topics) {
    const q = kb.questions.find((x) => x.topic === topic && x.kind === "tr") as SynQuestion;
    const goldId = kb.goldByTopic.get(topic)![0];
    // Güncelleme: içerik + updatedAt değişir → seçilen metin YENİ işareti taşımalı.
    const marker = `GNCL-${goldId}`;
    const updated = kb.items.map((i) => (i.id === goldId ? updatedItem(i, marker, Date.UTC(2026, 8, 9)) : i));
    const r1 = selectKbForPrompt({ items: updated, guestMessage: q.text, mode: "hybrid" });
    const sel1 = r1.items.find((i) => i.id === goldId);
    if (sel1 && sel1.content.includes(marker)) updateOk += 1;
    // Silme: konunun TÜM kalemleri gider → hiçbiri seçilemez; önbellek eski parçayı döndüremez.
    const goldSet = new Set(kb.goldByTopic.get(topic));
    const deleted = kb.items.filter((i) => !goldSet.has(i.id));
    const r2 = selectKbForPrompt({ items: deleted, guestMessage: q.text, mode: "hybrid" });
    if (!r2.items.some((i) => goldSet.has(i.id))) deleteOk += 1;
  }
  return { updateOk, updateTotal: topics.length, deleteOk, deleteTotal: topics.length };
}

const results: SizeResult[] = SIZES.map((n) => {
  const kb = makeSyntheticKb(n);
  const configs = CONFIGS.map((c) => runConfig(kb, c));
  return { n, items: kb.items.length, questions: kb.questions.length, configs, ...updateDelete(kb) };
});

const cfg = (n: number, name: string) => results.find((r) => r.n === n)!.configs.find((c) => c.name.startsWith(name))!;
const kindRate = (c: ConfigResult, kind: string) => (c.perKind[kind] ? c.perKind[kind].inPrompt / c.perKind[kind].n : 0);
const kindNoise = (c: ConfigResult, kind: string) => (c.perKind[kind] ? c.perKind[kind].noise / c.perKind[kind].n : 0);

describe("ölçek harness'ı — 30/100/300 kalem, gerçek retrieval yolu", () => {
  it("küçük-KB passthrough DEĞİL: her boyutta seçim yapılıyor (geri çekilme azınlıkta)", () => {
    for (const n of SIZES) {
      const c = cfg(n, "hibrit VARSAYILAN");
      expect(c.fallbacks / results.find((r) => r.n === n)!.questions, `n=${n}`).toBeLessThan(0.15);
    }
  });

  it("🚨 LEGACY'nin ölçülen açığı: 100 ve 300 kalemde cevap metni çoğu soruda BLOĞA GİRMİYOR; hibrit giriyor", () => {
    for (const n of [100, 300] as const) {
      expect(cfg(n, "legacy").inPrompt, `legacy n=${n}`).toBeLessThan(0.6);
      expect(cfg(n, "hibrit VARSAYILAN").inPrompt, `hibrit n=${n}`).toBeGreaterThan(0.85);
    }
  });

  it("CEVAP METNİ ölçüsü kimlik ölçüsünden GEVŞEK DEĞİL: metin blokta ise kimlik de blokta (metin ≤ kimlik), rapor ikisini de verir", () => {
    for (const r of results) {
      for (const c of r.configs) {
        expect(c.inPrompt, `${c.name} n=${r.n}`).toBeLessThanOrEqual(c.inPromptId + 1e-9);
      }
    }
  });

  it("KİMLİK ≠ METİN (Codex 09-09): uzun kalemin başka parçası seçilince kalem kimliği blokta ama cevap cümlesi YOK — kimlik ölçüsü bunu 'isabet' sayardı", () => {
    const kb = makeSyntheticKb(30);
    const guide = kb.items.find((i) => i.id === "syn_guide_0")!;
    // Rehberin OTOPARK paragrafı seçilir ("Otopark var mı?"), ama sorunun cevabı DEĞİL olan
    // başka bir gömülü gerçek (unutulan eşya cümlesi) o parçada yoktur.
    const r = selectKbForPrompt({ items: kb.items, guestMessage: "Otopark var mı?", mode: "hybrid" });
    const text = packKnowledgeBase(r.items, r.droppedItems, r.selection, r.notes).text;
    const lostNeedle = kb.questions.find((q) => q.id === "q_guide_lost")!.needles[0];
    expect(guide.content).toContain(lostNeedle);
    const guideChunks = r.items.filter((i) => i.id === "syn_guide_0");
    expect(guideChunks.length).toBeGreaterThanOrEqual(0);
    // Kimlik ölçüsü: rehber kimliği blokta olabilir; METİN ölçüsü: bu cümle blokta DEĞİL.
    expect(text).not.toContain(lostNeedle);
  });

  it("hibrit varsayılan bm25-yalnızdan en fazla BİR soru geride (n-gram'ın işi isabet değil, ek varyasyonunda gürültü; ölçüldü)", () => {
    for (const r of results) {
      const oneQuestion = 1 / r.questions;
      expect(cfg(r.n, "hibrit VARSAYILAN").inPrompt, `n=${r.n}`).toBeGreaterThanOrEqual(cfg(r.n, "hibrit bm25").inPrompt - oneQuestion - 1e-9);
    }
  });

  /** 09-10 ölçümü + bir/iki soruluk pay (`docs/olcum/kb-retrieval-scale-2026-09-10.md`). */
  const ALLOWED_MISSES: Record<number, { hit1: number; hit3: number; inPrompt: number }> = {
    30: { hit1: 7, hit3: 2, inPrompt: 2 },
    100: { hit1: 9, hit3: 7, inPrompt: 3 },
    300: { hit1: 9, hit3: 8, inPrompt: 2 },
  };

  it("doğru kaynak sıralamada önde — eşikler SORU SAYISI cinsinden, paylı (varsayılan, her boyut)", () => {
    for (const n of SIZES) {
      const c = cfg(n, "hibrit VARSAYILAN");
      // 🚨 ÖLÇÜ SORU SAYISI, YÜZDE DEĞİL (inceleme 09-10): `inPrompt ≥ .99` n=100'de 192/193 ile
      // geçiyordu, yani TEK bir sorunun gerilemesi suit'i kırmızıya çeviriyordu (pay 0 soru); ayrıca
      // yüzde eşiği Q değişince sessizce kayar. Kaçırılan soru sayısı ölçülen değerin bir-iki soru
      // üstüne pinli: gerçek gerileme yakalanır, gürültü yakalanmaz.
      const q = results.find((r) => r.n === n)!.questions;
      const missed = (rate: number) => q - Math.round(rate * q);
      const allowed = ALLOWED_MISSES[n];
      expect(missed(c.hit1), `hit@1 kaçırılan n=${n} (soru ${q})`).toBeLessThanOrEqual(allowed.hit1);
      expect(missed(c.hit3), `hit@3 kaçırılan n=${n}`).toBeLessThanOrEqual(allowed.hit3);
      expect(missed(c.inPrompt), `inPrompt kaçırılan n=${n}`).toBeLessThanOrEqual(allowed.inPrompt);
      // Sentetik sette "bilgi yok" sorusu YOK → hiçbir soru geri çekilmemeli (09-09'da 3/1/1 çekiliyordu:
      // hepsi kök sökücü asimetrisiydi — "Çıkışımızı kaça kadar…" no_lexical_hits).
      expect(c.fallbacks, `geri çekilme n=${n}`).toBe(0);
    }
  });

  it("birleşim seçimi ÖLÇÜMLE: CombSUM (n-gram açık) hiçbir boyutta RRF'den az isabet etmez ve daha az gürültü taşır", () => {
    for (const n of SIZES) {
      expect(cfg(n, "hibrit n-gram AÇIK").hit1, `n=${n}`).toBeGreaterThanOrEqual(cfg(n, "hibrit RRF").hit1 - 1e-9);
      expect(cfg(n, "hibrit n-gram AÇIK").noise, `n=${n}`).toBeLessThanOrEqual(cfg(n, "hibrit RRF").noise);
    }
  });

  it("N-GRAM AYRI ÖLÇÜM (Codex 09-09, yeniden ölçüm 09-10): yazım hatasında katkı yok; ek varyasyonunda ESKİ fayda (gürültü %23–44↓) kök sökücü kaçağının TELAFİSİYDİ — kök düzelince auto ≈ kapalı (isabet eşit, gürültü eşit ya da az); İngilizcede AÇIK olmak gürültüyü artırır, isabeti artırmaz → varsayılan 'auto' KORUNDU (katkı ≈0; 'kapalı'ya çekme kararı kurucunun)", () => {
    for (const r of results) {
      const n = r.n;
      const off = cfg(n, "hibrit bm25");
      const auto = cfg(n, "hibrit VARSAYILAN");
      const on = cfg(n, "hibrit n-gram AÇIK");
      const oneQuestion = 1 / r.questions;
      // typo: fuzzy eşleşme zaten var — n-gram isabeti değiştirmez (±1 soru payı).
      expect(Math.abs(kindRate(auto, "typo") - kindRate(off, "typo")) * (auto.perKind.typo?.n ?? 1), `typo n=${n}`).toBeLessThanOrEqual(1);
      // morph: 09-09'da "gürültü ≥%20 azalır" pinliydi (5.0→3.9, 8.1→5.1, 20.0→11.2). 09-10 kök sökücü
      // düzeltmesinden (sabit nokta + ünlü-sonu iyelik + kaynaştırma y) sonra kapalı da 38/38 ve gürültü
      // 0.87/2.55/2.45 vs auto 0.87/2.66/2.34 → n-gram'ın morph katkısı KALMADI. Dürüst pin: isabet düşmez,
      // gürültü soru başına ±0.2 içinde EŞİT sayılır (bir yönde ≥0.2 açılırsa yeniden ölç).
      expect(kindRate(auto, "morph"), `morph n=${n}`).toBeGreaterThanOrEqual(kindRate(off, "morph") - 1e-9);
      // 🚨 TEK VE YÖNLÜ İFADE (inceleme 09-10): eskiden burada İKİ pin vardı — `|auto−off| ≤ 0.2`
      // ve "auto > off×0.8". İkincisi n=100/300'de ÖLÜ ASSERT'ti: `off` 2.4–2.6 iken `off×0.2`
      // zaten 0.2'yi aştığı için ilk pin her zaman ÖNCE düşüyordu, yani ikinci satırı silmek
      // EŞDEĞER MUTANT olurdu. Aynı iki niyet (eşitlik + "eski %20 iddiası artık geçersiz") tek
      // çift yönlü farkla ifade ediliyor; hangi yönde açılırsa açılsın belge cümlesi de değişmeli.
      const morphGap = kindNoise(auto, "morph") - kindNoise(off, "morph");
      expect(morphGap, `morph gürültü farkı n=${n} (auto − kapalı)`).toBeLessThanOrEqual(0.2);
      expect(morphGap, `morph gürültü farkı n=${n} — 'n-gram gürültüyü düşürür' iddiası artık ÖLÇÜMLE DESTEKLENMİYOR`).toBeGreaterThanOrEqual(-0.2);
      // en: 'auto' İngilizce sorguya dokunmaz (= kapalı, birebir); 'AÇIK' İngilizcede isabet KAZANDIRMAZ, gürültü EKLER.
      expect(kindRate(auto, "en"), `en auto n=${n}`).toBeCloseTo(kindRate(off, "en"), 9);
      expect(kindNoise(auto, "en"), `en auto gürültü n=${n}`).toBeCloseTo(kindNoise(off, "en"), 9);
      expect(kindRate(on, "en"), `en açık isabet n=${n}`).toBeLessThanOrEqual(kindRate(auto, "en") + 1e-9);
      expect(kindNoise(on, "en"), `en açık gürültü n=${n}`).toBeGreaterThan(kindNoise(auto, "en"));
      // Genel: auto, açığın en fazla bir soru gerisinde ve daha küçük blok (İngilizce şişmesi yok).
      expect(auto.inPrompt, `auto vs açık n=${n}`).toBeGreaterThanOrEqual(on.inPrompt - oneQuestion - 1e-9);
      expect(auto.chars, `karakter auto vs açık n=${n}`).toBeLessThanOrEqual(on.chars);
    }
  });

  it("CANLI AKIŞ (Codex 09-09): kb-fetch tavanı 200 — 30/100'de varsayılanla BİREBİR; 300'de (336 kalem) tavan gerçekten uygulanır; sentetik sette kayıp YOK çünkü her konunun 8 varyantı var (dürüst okuma)", () => {
    for (const n of [30, 100] as const) {
      const live = cfg(n, "hibrit CANLI");
      const def = cfg(n, "hibrit VARSAYILAN");
      expect(live.pool, `pool n=${n}`).toBe(def.pool);
      expect(live.inPrompt, `n=${n}`).toBe(def.inPrompt);
      expect(live.hit1, `n=${n}`).toBe(def.hit1);
    }
    const live = cfg(300, "hibrit CANLI");
    expect(live.pool).toBe(KB_RETRIEVAL_FETCH_CAP);
    expect(cfg(300, "hibrit VARSAYILAN").pool).toBeGreaterThan(KB_RETRIEVAL_FETCH_CAP);
    // Konu başına ~8 kalem (3 farklı cümle) olduğu için en yeni 200'de her konudan en az biri kalır:
    // canlı isabet tavansızdan DÜŞMEZ. Bu, tavanın zararsız olduğunun kanıtı DEĞİLDİR — tek kalemli
    // konu için kayıp aşağıdaki hedefli testte ölçülür.
    expect(live.inPrompt).toBeGreaterThanOrEqual(cfg(300, "hibrit VARSAYILAN").inPrompt - 0.02);
    expect(live.inPrompt).toBeGreaterThan(cfg(300, "legacy").inPrompt + 0.2);
    expect(live.chars).toBeLessThanOrEqual(cfg(300, "hibrit VARSAYILAN").chars);
  });

  it("CANLI TAVAN KAYBI (hedefli): TEK kalemi en yeni 200'ün dışında kalan konu canlı akışta ULAŞILAMAZ (geri çekilme + 'alınmadı' notu); tavansız havuzda bulunur", () => {
    const kb = makeSyntheticKb(300);
    const oldest = Math.min(...kb.items.map((i) => i.updatedAt.getTime()));
    const jacuzzi = {
      id: "syn_jacuzzi",
      category: "faq",
      title: "Jakuzi",
      content: "Terastaki jakuzi akşamları kullanılabilir; kapağını kullanım sonrası kapatın.",
      updatedAt: new Date(oldest - 86_400_000),
      supersededById: null,
    };
    const all = [...kb.items, jacuzzi].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const needle = "Terastaki jakuzi";
    const full = selectKbForPrompt({ items: all, guestMessage: "Jakuzi var mı?", mode: "hybrid" });
    expect(packKnowledgeBase(full.items, full.droppedItems, full.selection, full.notes).text).toContain(needle);
    const livePool = all.slice(0, KB_RETRIEVAL_FETCH_CAP);
    const r = selectKbForPrompt({ items: livePool, guestMessage: "Jakuzi var mı?", mode: "hybrid" });
    const text = packKnowledgeBase(r.items, all.length - livePool.length + r.droppedItems, r.selection, r.notes).text;
    expect(text).not.toContain(needle);
    // Dürüst davranış: isabet yok → tam küme + "alınmadı" notu → model 'bilgi yok' DEMEZ, insana devreder.
    expect(r.evidence?.fb).toBe("no_lexical_hits");
    expect(text).toMatch(/kalem/);
    expect(text).toMatch(/insana devret/);
  });

  it("rehberde GÖMÜLÜ gerçekler bulunur (uzun metin ortası, her boyut) — METİN ölçüsüyle", () => {
    for (const n of SIZES) {
      const c = cfg(n, "hibrit VARSAYILAN");
      expect(kindRate(c, "guide"), `n=${n}`).toBeGreaterThanOrEqual(0.66);
    }
  });

  it("maliyet: hibrit blok legacy'nin yarısından küçük; gürültü daha az", () => {
    for (const n of SIZES) {
      expect(cfg(n, "hibrit VARSAYILAN").chars, `n=${n}`).toBeLessThan(cfg(n, "legacy").chars / 2);
      expect(cfg(n, "hibrit VARSAYILAN").noise, `n=${n}`).toBeLessThan(cfg(n, "legacy").noise);
    }
  });

  it("gecikme: 300 kalemde soğuk indeks < 400 ms, ılık p95 < 60 ms (bu makine; CI'da gevşek)", () => {
    const c = cfg(300, "hibrit VARSAYILAN");
    expect(c.coldMs).toBeLessThan(400);
    expect(c.warmP95).toBeLessThan(60);
  });

  it("GÜNCELLEME ve SİLME sonrası doğruluk: yeni metin gider, silinen kalem geri gelmez (10/10)", () => {
    for (const r of results) {
      expect(r.updateOk, `update n=${r.n}`).toBe(r.updateTotal);
      expect(r.deleteOk, `delete n=${r.n}`).toBe(r.deleteTotal);
    }
  });
});

function report(): string {
  let commit = "?";
  try {
    const head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    commit = dirty ? `${head} + çalışma ağacı (rapor kodla aynı commit'e girer; hash ebeveyndir)` : head;
  } catch {
    /* rapor yine yazılır */
  }
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const KINDS = ["tr", "syn", "typo", "morph", "en", "guide"];
  const L: string[] = [];
  L.push(`# Retrieval ölçek ölçümü — 30 / 100 / 300 kalem (${new Date().toISOString().slice(0, 10)}, commit ${commit})`);
  L.push("");
  L.push("> Sentetik mülk KB'leri (`tests/helpers/kb-retrieval-synthetic.ts`, tohum 42): 38 konu × 3 TR paraphrase + EN varyant,");
  L.push("> konu başına TR / eşanlam / yazım-hatası / EK VARYASYONU (morph) / EN soruları, n/10 çeldirici, her 50 kaleme 7k rehber (3 gömülü gerçek).");
  L.push("> `updatedAt` 400 güne tohumlu yayılır. Model YOK: 'cevabın kaynakla desteklenmesi' burada ÖLÇÜLMEZ (gerçek eval: eşleştirilmiş harness).");
  L.push("> hit@k = doğru kalem kimliği seçim sıralamasının ilk k'sında; **inPrompt(metin) = CEVAP İÇİN GEREKLİ CÜMLE istem bloğunda** (asıl ölçü);");
  L.push("> inPrompt(kimlik) = doğru kalem kimliği blokta (eski ölçü, kıyas için); noise = seçilen ilgisiz kalem; chars = blok karakteri (maliyet vekili);");
  L.push("> ms = seçici süresi (soğuk: indeks kurulumu dahil; ılık: önbellek). **CANLI** = `kb-fetch` okuma tavanı (en yeni 200) uygulanmış hibrit.");
  L.push("> Üretici: `tests/unit/kb-retrieval-scale.test.ts`. ANLAMSAL (embedding) kaynak ÜRETİMDE YOK — burada hiçbir satır anlamsal retrieval ölçmez.");
  L.push("");
  for (const r of results) {
    L.push(`## n=${r.n} konu kalemi (toplam ${r.items} kalem, ${r.questions} soru)`);
    L.push("");
    L.push("| Yapılandırma | havuz | hit@1 | hit@3 | inPrompt (METİN) | inPrompt (kimlik) | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |");
    L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const c of r.configs) {
      const legacy = c.name.startsWith("legacy");
      L.push(
        `| ${c.name} | ${legacy ? KB_ITEM_CAP : c.pool} | ${legacy ? "—" : pct(c.hit1)} | ${legacy ? "—" : pct(c.hit3)} | **${pct(c.inPrompt)}** | ${pct(c.inPromptId)} | ${c.noise.toFixed(1)} | ${c.chars} | ${legacy ? "—" : c.coldMs} | ${legacy ? "—" : c.warmP50} | ${legacy ? "—" : c.warmP95} | ${legacy ? "—" : c.fallbacks} |`,
      );
    }
    L.push("");
    L.push("N-gram AYRI ÖLÇÜM — soru türüne göre inPrompt(metin) / ortalama gürültü:");
    L.push("");
    L.push(`| Soru türü | n | n-gram KAPALI | n-gram auto (VARSAYILAN) | n-gram AÇIK |`);
    L.push("|---|---|---|---|---|");
    const off = r.configs.find((c) => c.name.startsWith("hibrit bm25"))!;
    const auto = r.configs.find((c) => c.name.startsWith("hibrit VARSAYILAN"))!;
    const on = r.configs.find((c) => c.name.startsWith("hibrit n-gram AÇIK"))!;
    for (const k of KINDS) {
      if (!auto.perKind[k]) continue;
      const cell = (c: ConfigResult) => `${c.perKind[k].inPrompt}/${c.perKind[k].n} · gürültü ${kindNoise(c, k).toFixed(2)}`;
      L.push(`| ${k} | ${auto.perKind[k].n} | ${cell(off)} | ${cell(auto)} | ${cell(on)} |`);
    }
    L.push("");
    L.push(`Güncelleme sonrası yeni metin: ${r.updateOk}/${r.updateTotal} · Silme sonrası geri gelmeme: ${r.deleteOk}/${r.deleteTotal}`);
    L.push("");
  }
  L.push("## Okuma kılavuzu");
  L.push("- Legacy sıralama soruya bakmaz; hit@k anlamsızdır ('—'). inPrompt = en yeni 30 kalem + 24k bütçe içinde doğru kaynak var mı.");
  L.push("- **CANLI satırı gerçek akıştır:** 300 konu kalemi (336 kalem) canlı tavanın (200) üstündedir; tavan dışındaki kalemin cevabı bloğa GİREMEZ ve bu kayıp burada dürüstçe görünür.");
  L.push("  300 kalem ürün plan tavanının (60/mülk) çok üstündedir; canlıda hiçbir mülk tavana çarpmaz — ama ölçüm canlı yolu ölçer, idealize etmez.");
  L.push("- n-gram kaynağı ANLAMSAL DEĞİLDİR (karakter 3-gram yazım benzerliği). Ayrı ölçüm (09-10): yazım hatasında katkı yok (OSA fuzzy zaten var); ek varyasyonunda 09-09'daki gürültü düşüşü");
  L.push("  kök sökücü kaçağının telafisiydi, kök düzelince auto ≈ kapalı (isabet eşit; gürültü eşit ya da az); İngilizce sorguda AÇIK olmak Türkçe metne düşen gramlarla bloğu büyütür →");
  L.push("  varsayılan **auto** (yalnız Türkçe algılanan sorguda) KORUNDU, ölçülen katkı ≈0 — 'kapalı'ya çekme kararı kurucunun. Gömme tabanlı kaynak: sözleşme hazır, ücretli servis onayı bekler; ÜRETİMDE YOK.");
  return L.join("\n");
}

afterAll(() => {
  if (process.env.KB_RETRIEVAL_REPORT !== "1") return;
  const dir = path.resolve(__dirname, "../../docs/olcum");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `kb-retrieval-scale-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, `${report()}\n`, "utf8");
  console.log(`[kb-retrieval-scale] rapor yazıldı: ${file}`);
});
