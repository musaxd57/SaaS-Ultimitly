import { describe, it, expect, afterEach, vi } from "vitest";
import { KB_ITEM_CAP, KB_CHAR_BUDGET, packKnowledgeBase } from "@/lib/ai/prompts";
import { dailyAiCallCap } from "@/lib/ai/daily-budget";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// AI MALİYET TAVANLARI.
//
// Denetimde ölçüldü: kod tabanında hiçbir yerde günlük/toplam AI harcama tavanı
// YOKTU. Dakikalık limitler tek isteği yavaşlatır ama toplamı sınırlamaz — bir
// hesap günde on binlerce çağrı yapabiliyordu. Ayrıca istem BOYUTUNUN da tavanı
// yoktu: bilgi tabanı kalemi 20.000 karaktere kadar çıkabiliyor ve `/api/ai/test`
// kalemleri sınırsız çekiyordu. Yani saldırgan hem çağrı sayısını HEM çağrı
// başına maliyeti kontrol edebiliyordu.
//
// Bu dosya iki tavanı da sözleşmeye çevirir.
// ---------------------------------------------------------------------------

describe("bilgi tabanı istem bütçesi", () => {
  const item = (n: number, len: number) => ({
    category: "general",
    title: `k${n}`,
    content: "x".repeat(len),
  });

  it("boş bilgi tabanı açıkça belirtilir (model 'bilgim yok' diye uydurmasın)", () => {
    const { text, omitted } = packKnowledgeBase([]);
    expect(text).toContain("bilgi tabanı boş");
    expect(omitted).toBe(0);
  });

  it("bütçe içindeki kalemlerin HEPSİ geçer, hiçbiri kırpılmaz", () => {
    const items = [item(1, 100), item(2, 100), item(3, 100)];
    const { text, omitted } = packKnowledgeBase(items);
    expect(omitted).toBe(0);
    for (const i of items) expect(text).toContain(i.title);
  });

  it("KARAKTER bütçesi aşılırsa kesilir — adet tavanı tek başına maliyeti sınırlamaz", () => {
    // 30 kalem × 20.000 karakter = 600.000 karakter; adet tavanı bunu durdurmaz.
    const items = Array.from({ length: KB_ITEM_CAP }, (_, i) => item(i, 20_000));
    const { text, omitted } = packKnowledgeBase(items);
    expect(omitted).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(KB_CHAR_BUDGET + 20_000 + 500); // 1 kalem + not payı
  });

  it("KESME MODELE SÖYLENİR: atlanan kalem varsa 'bilgi yok' demesi YASAKLANIR", () => {
    const items = Array.from({ length: 5 }, (_, i) => item(i, 20_000));
    const { text, omitted } = packKnowledgeBase(items);
    expect(omitted).toBeGreaterThan(0);
    expect(text).toContain("insana devret");
    expect(text).toMatch(/\d+ kalemi yer sınırı/);
  });

  it("tek kalem bütçeden büyükse yine de geçer (boş bağlam göndermektense)", () => {
    const { text, omitted } = packKnowledgeBase([item(1, KB_CHAR_BUDGET * 2)]);
    expect(omitted).toBe(0);
    expect(text).toContain("k1");
  });

  it("adet tavanı TEK YOLDAN geçiyor — DÖRT AI yüzeyi de aynı fonksiyonu çağırır", () => {
    // Yüzeyler ayrışırsa test kartı üretimi yanlış temsil eder, QR'da tavan hiç
    // olmayabilir (bir kez oldu), ve düşen kalem sayısı modele söylenemez.
    // Tavan artık rotada DEĞİL `ai/kb-fetch.ts`'te: adedi bilen tek yer orası
    // olduğu için "kaç tanesi düştü"yü de yalnız orası hesaplayabiliyor.
    const roots = [
      "src/app/api/ai/test/route.ts",
      "src/app/api/conversations/[id]/ai-suggest/route.ts",
      "src/lib/automation.ts", // üretim oto-yanıt yolu
      "src/lib/guest-chat.ts", // QR concierge
    ];
    for (const rel of roots) {
      const src = readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
      expect(src, rel).toContain("fetchKnowledgeBaseForPrompt");
      // Kendi tavansız sorgusunu açan biri buradan görünür olur.
      expect(src, rel).not.toMatch(/prisma\.knowledgeBaseItem\.findMany/);
    }
  });

  it("tavanın KENDİSİ tek yerde ve düşen sayısı hesaplanıyor", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/lib/ai/kb-fetch.ts"), "utf8");
    expect(src).toContain("take: KB_ITEM_CAP");
    expect(src).toMatch(/from "@\/lib\/ai\/limits"/);
    // "Kaç tanesi düştü" gerçekten SAYILIYOR — yoksa `omitted` hep 0 kalır ve
    // model, host'un yazdığı bir konuda "bilgim yok" der.
    expect(src).toContain("count(");
    expect(src).toContain("dropped");
  });

  it("düşen kalem sayısı istemi kuran yere GERÇEKTEN ulaşıyor", () => {
    const prompts = readFileSync(
      path.resolve(__dirname, "../../src/lib/ai/prompts.ts"),
      "utf8",
    );
    expect(prompts).toContain("input.knowledgeBaseDropped");
    for (const rel of [
      "src/lib/automation.ts",
      "src/lib/guest-chat.ts",
      "src/app/api/ai/test/route.ts",
      "src/app/api/conversations/[id]/ai-suggest/route.ts",
      "src/app/api/chat/[token]/route.ts",
    ]) {
      const src = readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
      expect(src, rel).toMatch(/knowledgeBaseDropped/);
    }
  });
});

describe("günlük org AI bütçesi", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("varsayılan tavan makul: normal kullanımın üstünde, suistimalin altında", () => {
    expect(dailyAiCallCap()).toBeGreaterThanOrEqual(300);
    expect(dailyAiCallCap()).toBeLessThanOrEqual(5000);
  });

  it("env ile ayarlanabilir", () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "1200");
    expect(dailyAiCallCap()).toBe(1200);
  });

  it("bozuk env değeri güvenli varsayılana düşer (sessizce sınırsız OLMAZ)", () => {
    for (const bad of ["", "0", "-5", "abc", "1e6", "0x10", "9999999"]) {
      vi.stubEnv("AI_DAILY_CALL_CAP", bad);
      expect(dailyAiCallCap(), bad).toBeGreaterThanOrEqual(300);
      expect(dailyAiCallCap(), bad).toBeLessThanOrEqual(5000);
    }
  });

  it("AI harcayan HER rota günlük bütçeden geçiyor — AĞACI TARAR, elle liste DEĞİL", () => {
    // ⚠️ Bu test bir süre ELLE YAZILMIŞ 5 dosyalık listeye bakıyordu ve yorumu
    // "yeni bir AI rotası bütçesiz eklenirse burası kırmızı olur" diyordu —
    // TAM TERSİ: liste sabit olduğu için yalnız mevcut bir rotadan bütçenin
    // ÇIKARILMASINI yakalıyordu, YENİ bir rotanın eklenmesini asla. Nitekim
    // `/api/hospitable/auto-reply-test` (istek başına 12 model çağrısı) tam bu
    // kör noktada, kotasız duruyordu. Artık ağaç taranıyor.
    const apiRoot = path.resolve(__dirname, "../../src/app/api");
    const spenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(full);
        else if (e.name === "route.ts") {
          const src = readFileSync(full, "utf8");
          // Modeli GERÇEKTEN çağıran (ya da çağıran bir yardımcıyı çağıran) rotalar.
          if (/\b(suggestReply|previewChannelAutoReplies|translateMessageBody|summarizeSupplyPlan)\b/.test(src)) {
            spenders.push(full.slice(apiRoot.length + 1));
          }
        }
      }
    };
    walk(apiRoot);
    // Demo rotası bilinçli istisna: kayıtsız ziyaretçiye açık, kendi IP+günlük
    // tavanları var ve bir org'a ait olmadığı için org kotası uygulanamaz.
    const exempt = new Set(["demo/ai/route.ts", "chat/[token]/route.ts"]);
    const missing = spenders.filter((rel) => {
      if (exempt.has(rel)) return false;
      // ÇAĞRIYI ara, import satırını DEĞİL: ilk sürüm yalnız `includes(
      // "consumeDailyAiBudget")` bakıyordu ve çağrıyı silip import'u bırakan
      // bir mutasyon testten geçiyordu (mutasyonla ölçüldü).
      return !/consumeDailyAiBudget\s*\(/.test(readFileSync(`${apiRoot}/${rel}`, "utf8"));
    });
    expect(missing, `bütçesiz AI rotası: ${missing.join(", ")}`).toEqual([]);
    expect(spenders.length, "tarayıcı hiçbir AI rotası bulamadı — regex bozulmuş olabilir").toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// TAKVİM BESLEMESİ ETKİNLİK TAVANI.
//
// Ağ katmanı 10 MB'da kesiyor ama bu içerik tavanı DEĞİL: ölçüldü, 10 MB'lık bir
// feed ~119.000 rezervasyon satırı üretiyordu ve içe aktarma her satır için ayrı
// transaction koştuğu için tek istek yüz binlerce DB gidiş-dönüşüne dönüşüyordu.
// Besleme URL'ini müşteri girdiği için tetiklemesi bedava.
// ---------------------------------------------------------------------------
describe("iCal etkinlik tavanı", () => {
  function feed(events: number): string {
    const body = Array.from(
      { length: events },
      (_, i) =>
        `BEGIN:VEVENT\nUID:e${i}@x\nDTSTART;VALUE=DATE:20260801\nDTEND;VALUE=DATE:20260803\nSUMMARY:Rez ${i}\nEND:VEVENT`,
    ).join("\n");
    return `BEGIN:VCALENDAR\n${body}\nEND:VCALENDAR`;
  }

  it("normal boyutlu besleme tam olarak ayrıştırılır", async () => {
    const { parseIcs } = await import("@/lib/import/ics");
    expect(parseIcs(feed(50))).toHaveLength(50);
  });

  it("devasa besleme TAVANDA kesilir (kardeş CSV ayrıştırıcısıyla parite)", async () => {
    const { parseIcs } = await import("@/lib/import/ics");
    const parsed = parseIcs(feed(12_000));
    expect(parsed.length).toBe(10_000);
  });

  it("kesme SESSİZ olur — meşru bir feed'in şişmesi tüm senkronu durdurmaz", async () => {
    const { parseIcs } = await import("@/lib/import/ics");
    expect(() => parseIcs(feed(11_000))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SİSTEM PROMPTU TARAYICIYA SIZAMAZ (denetim, 07-31).
//
// `prompts.ts` 75 KB: sistem promptu + 24 eğitim örneği + tüm güvenlik/kaçınma
// talimatları. Depo tam da bu dosya yüzünden PRIVATE yapıldı ("yayınlanmış kara
// liste = kaçınma haritası"). Bugün, SADECE bir tamsayıyı okumak için, bir
// `"use client"` bileşeni onu import etti — yani dosya tarayıcıya giden paketin
// bağımlılık grafiğine bağlandı. Paketleyicinin saf `const`'ları gerçekten
// eleyip elemediği ancak üretim çıktısına bakılarak doğrulanabilir; o varsayıma
// güvenmek yerine zincir koparıldı ve modül mühürlendi.
// ---------------------------------------------------------------------------
describe("prompts.ts istemci paketine bağlanamaz", () => {
  const readFile = (rel: string) => readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

  it("prompts.ts `server-only` ile mühürlü — biri client'tan import ederse BUILD kırılır", () => {
    expect(readFile("src/lib/ai/prompts.ts")).toContain('import "server-only"');
  });

  it("hiçbir istemci bileşeni / sayfa prompts.ts import etmiyor", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.resolve(__dirname, "../../", dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(tsx|ts)$/.test(e.name)) {
          const src = readFile(rel);
          if (src.includes('from "@/lib/ai/prompts"')) hits.push(rel);
        }
      }
    };
    walk("src/components");
    walk("src/app");
    expect(hits, `prompts.ts şu dosyalardan import ediliyor: ${hits.join(", ")}`).toEqual([]);
  });

  it("tavanlar bağımlılıksız YAPRAK modülde (client güvenle import edebilsin)", () => {
    const leaf = readFile("src/lib/ai/limits.ts");
    expect(leaf).toContain("export const KB_ITEM_CAP");
    // Yaprak = başka hiçbir şey import etmez; aksi hâlde zincir yine uzar.
    expect(leaf).not.toMatch(/^import /m);
  });
});
