import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkItem, chunkSpans, tableHeadersAt } from "@/lib/ai/retrieval/chunker";
import { tableHeaderInfo } from "@/lib/ai/retrieval/flag";
import { buildRerankRequest, prepareRerankScores, RERANK_TEXT_CHARS } from "@/lib/ai/semantic/rerank";
import { chunkKey } from "@/lib/ai/retrieval/chunker";
import { __resetKbIndexCache, getOrBuildKbIndex } from "@/lib/ai/retrieval/index-cache";
import { blockContent, draftIsVerbatim, planDocumentImport, splitDocument } from "@/lib/kb-import/document";

// TABLO BAŞLIĞI BAĞLAMI (`KB_TABLE_HEADER`, 10-28; uzun belge ölçümü + Codex C9). Uzun bir Markdown tablosu parçalara bölününce sonraki
// parçalar sütun başlığını kaybediyordu: "| Geç çıkış | Ücretsiz | 500 TL | Yapılmıyor |" satırı hangi sütunun hangi sezon olduğunu
// söylemiyordu (geliştirme setinde 3 soru yalnız bu yüzden eksik bağlamla kaldı). Anahtar açıkken tablonun ORTASINDAN başlayan parçanın
// başına başlık satırı eklenir; kapalıyken parça metni kalem metninin AYNEN dilimidir.

const HEADER = "| Hizmet | Düşük sezon | Orta sezon | Yüksek sezon |";
const SEP = "|---|---|---|---|";

function feeTable(rows: number): string {
  const lines = [HEADER, SEP];
  for (let i = 1; i <= rows; i++) lines.push(`| Hizmet satırı ${i} uzun bir açıklama ile | ${i * 10} TL | ${i * 20} TL | ${i * 30} TL |`);
  return lines.join("\n");
}

const src = (content: string) => ({ id: "kb_t", category: "general", title: "Ücretler", content, updatedAt: new Date("2026-10-01T10:00:00Z") });

afterEach(() => {
  vi.unstubAllEnvs();
  __resetKbIndexCache();
});

describe("tablo başlığı bağlamı — anahtar KAPALI (varsayılan)", () => {
  it("parça metni kalem metninin AYNEN dilimidir (uzun tablo bölünse de başlık eklenmez)", () => {
    const content = feeTable(30);
    const chunks = chunkItem(src(content));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(content.includes(c.text)).toBe(true);
    expect(chunks.slice(1).some((c) => c.text.startsWith(HEADER))).toBe(false);
  });

  it("varsayılan ve tanınmayan değer KAPALI; 1 / on / true açar", () => {
    expect(tableHeaderInfo()).toEqual({ enabled: false, raw: "", recognized: true });
    vi.stubEnv("KB_TABLE_HEADER", "evet");
    expect(tableHeaderInfo()).toMatchObject({ enabled: false, recognized: false });
    for (const v of ["1", "on", "TRUE"]) {
      vi.stubEnv("KB_TABLE_HEADER", v);
      expect(tableHeaderInfo().enabled).toBe(true);
    }
  });
});

describe("tablo başlığı bağlamı — anahtar AÇIK", () => {
  it("tablonun ortasından başlayan her parça başlık satırıyla başlar; dilimin kendisi değişmez", () => {
    vi.stubEnv("KB_TABLE_HEADER", "1");
    const content = feeTable(30);
    const spans = chunkSpans(content);
    const chunks = chunkItem(src(content));
    expect(chunks).toHaveLength(spans.length);
    // İlk parça başlığı zaten içeriyor: tekrar yok.
    expect(chunks[0].text).toBe(content.slice(spans[0].start, spans[0].end));
    for (let i = 1; i < chunks.length; i++) {
      const slice = content.slice(spans[i].start, spans[i].end);
      expect(chunks[i].text).toBe(`${HEADER}\n${slice}`);
    }
  });

  it("tablo dışı metin ve başlığı kendi içinde olan parça değişmez", () => {
    vi.stubEnv("KB_TABLE_HEADER", "1");
    const prose = Array.from({ length: 40 }, (_, i) => `Bu ${i}. bilgi cümlesidir ve tabloda değildir.`).join(" ");
    const chunks = chunkItem(src(prose));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(prose.includes(c.text)).toBe(true);
  });

  it("ayıracı olmayan boru satırları tablo sayılmaz (başlık uydurulmaz)", () => {
    const content = Array.from({ length: 40 }, (_, i) => `| not ${i} | uzun bir açıklama metni burada yer alır |`).join("\n");
    const starts = chunkSpans(content).map((s) => s.start);
    expect(tableHeadersAt(content, starts).every((h) => h === null)).toBe(true);
  });

  it("iki tablo: ikinci tablonun satırlarından başlayan parça İKİNCİ tablonun başlığını alır; tablodan sonraki paragraf hiçbirini almaz", () => {
    const h2 = "| Tesis | Yaz | Kış |";
    const second = [h2, "|---|---|---|", ...Array.from({ length: 25 }, (_, i) => `| Tesis ${i} uzun bir ad ile | 09:00–20:00 | Kapalı |`)].join("\n");
    const content = `${feeTable(3)}\n\nAra paragraf.\n\n${second}\n\nSon paragraf burada; tabloyla ilgisi yoktur.`;
    const starts = [content.indexOf("| Tesis 20"), content.indexOf("Ara paragraf"), content.indexOf("Son paragraf"), content.indexOf("| Hizmet satırı 2")];
    expect(tableHeadersAt(content, [...starts].sort((a, b) => a - b))).toEqual(
      [...starts].sort((a, b) => a - b).map((s) => (s === starts[0] ? h2 : s === starts[3] ? HEADER : null)),
    );
  });

  it("parça tam başlık satırında başlarsa başlık zaten içindedir; ayıraç satırında başlarsa başlık eklenir", () => {
    const content = feeTable(3);
    expect(tableHeadersAt(content, [0])).toEqual([null]);
    expect(tableHeadersAt(content, [content.indexOf(SEP)])).toEqual([HEADER]);
  });

  it("dizin önbelleği anahtarın durumunu ayırır: anahtar açılınca eski (başlıksız) dizin kullanılmaz", () => {
    const items = [src(feeTable(30))];
    const off = getOrBuildKbIndex(items);
    expect(off.chunks.slice(1).some((c) => c.text.startsWith(HEADER))).toBe(false);
    vi.stubEnv("KB_TABLE_HEADER", "1");
    const on = getOrBuildKbIndex(items);
    expect(on.chunks.slice(1).every((c) => c.text.startsWith(HEADER))).toBe(true);
  });

  it("yeniden sıralayıcı kırpması başlık kadar uzar: başlık, tablo satırlarını kırpmanın dışına itmez; başlıksız parça bayt bayt aynı", () => {
    vi.stubEnv("KB_TABLE_HEADER", "1");
    const chunks = chunkItem(src(feeTable(30)));
    const c = chunks.find((x) => x.prefixChars !== undefined)!;
    expect(c.prefixChars).toBe(HEADER.length + 1);
    const plain = { key: "k#0", title: c.title, text: c.text };
    const withPrefix = { ...plain, prefixChars: c.prefixChars };
    const cut = `${c.title} — ${c.text}`;
    expect(buildRerankRequest("q", [withPrefix, plain]).user).toContain(cut.slice(0, RERANK_TEXT_CHARS + c.prefixChars!));
    // Önek bilgisi olmayan aday eskisi gibi kırpılır.
    const user = buildRerankRequest("q", [plain, plain]).user;
    expect(user).toContain(`<<<${cut.slice(0, RERANK_TEXT_CHARS)}>>>`);
    // Anahtar kapalıyken parçada önek alanı hiç yoktur (nesne eskisiyle aynı biçim).
    vi.stubEnv("KB_TABLE_HEADER", "");
    expect(chunkItem(src(feeTable(30))).every((x) => !("prefixChars" in x))).toBe(true);
  });
});

describe("tablo başlığı — belge içe aktarma (uzun tablo paragrafı bölünürken)", () => {
  const doc = () => [{ page: 1, text: `## Ücretler\n\n${feeTable(30)}\n\nSon not: ücretler gecelik değildir.` }];

  it("anahtar KAPALI: bölünen tablo parçaları belgenin aynen dilimidir (başlık yalnız ilk parçada)", () => {
    const d = splitDocument(doc());
    const table = d.blocks.filter((b) => b.kind === "body" && b.text.includes("Hizmet satırı"));
    expect(table.length).toBeGreaterThan(2);
    expect(table.filter((b) => b.text.startsWith(HEADER))).toHaveLength(1);
    const norm = doc()[0].text;
    for (const b of table) expect(norm.includes(b.text)).toBe(true);
    // Bağlam alanı yok; taslak içeriğinde başlık bir kez geçer (belgedeki gibi).
    for (const b of table) expect(b.context).toBeUndefined();
    const all = planDocumentImport(doc()).drafts.map((x) => x.content).join("\n");
    expect(all.split(HEADER).length - 1).toBe(1);
  });

  it("anahtar AÇIK: her devam parçası başlık + ayıraç satırıyla başlar; taslaklar aynen-birleşim kuralını geçer", () => {
    vi.stubEnv("KB_TABLE_HEADER", "1");
    const d = splitDocument(doc());
    const table = d.blocks.filter((b) => b.kind === "body" && b.text.includes("Hizmet satırı"));
    expect(table.length).toBeGreaterThan(2);
    // Dilim değişmez (kararlar ona bakar); başlık yalnız devam parçasının bağlamında.
    const norm = doc()[0].text;
    for (const b of table) expect(norm.includes(b.text)).toBe(true);
    expect(table[0].context).toBeUndefined();
    for (const b of table.slice(1)) {
      expect(b.context).toBe(`${HEADER}\n${SEP}`);
      expect(blockContent(b).startsWith(`${HEADER}\n${SEP}\n`)).toBe(true);
    }
    // Hiçbir satır kaybolmaz ya da iki kez yazılmaz (başlık dışında).
    const rows = table.flatMap((b) => b.text.split("\n").filter((l) => l.includes("Hizmet satırı")));
    expect(rows).toHaveLength(30);
    const plan = planDocumentImport(doc());
    for (const draft of plan.drafts) expect(draftIsVerbatim(d, draft)).toBe(true);
    const withRows = plan.drafts.filter((x) => x.content.includes("Hizmet satırı 30"));
    expect(withRows.length).toBe(1);
    expect(withRows[0].content).toContain(HEADER);
  });

  it("GİZLİLİK (Haiku 10-28): başlıktaki kategori sözcükleri devam parçasının kategorisini DEĞİŞTİRMEZ — Wi-Fi satırı Wi-Fi'de kalır", () => {
    const h = "| Otopark | Garaj | Park yeri |";
    const lines = [h, "|---|---|---|", ...Array.from({ length: 30 }, (_, i) => `| Sıra ${i} için uzun bir açıklama satırı | A | B |`), "| Wi-Fi | 4590 | — |"];
    const pages = [{ page: 1, text: lines.join("\n") }];
    const categoryOf4590 = () => planDocumentImport(pages).drafts.find((x) => x.content.includes("4590"))?.category;
    const off = categoryOf4590();
    vi.stubEnv("KB_TABLE_HEADER", "1");
    expect(categoryOf4590()).toBe(off);
    expect(off).toBe("wifi");
  });
});

describe("tablo başlığı — tablo tespiti uç durumları (Haiku 10-28)", () => {
  it("tablonun içindeki '| - | - |' satırı yeni başlık açmaz", () => {
    const content = "| Sezon | Fiyat |\n|---|---|\n| Yaz | 500 TL |\n| - | - |\n| Kış | 300 TL |";
    expect(tableHeadersAt(content, [content.indexOf("| Kış")])).toEqual(["| Sezon | Fiyat |"]);
  });

  it("başlık satırının içinden başlayan parça başlığı ikinci kez almaz", () => {
    const content = "| Sezon. Yaz | Fiyat |\n|---|---|\n| 1 | 2 |";
    expect(tableHeadersAt(content, [content.indexOf("Yaz")])).toEqual([null]);
  });

  it("bilinen sınır: boş satır tabloyu kapatır (Markdown'da da öyle); dış borusuz tablo tanınmaz", () => {
    const blank = "| A | B |\n|---|---|\n| 1 | 2 |\n\n| 3 | 4 |";
    expect(tableHeadersAt(blank, [blank.indexOf("| 3")])).toEqual([null]);
    const bare = "A | B\n--- | ---\n1 | 2\n3 | 4";
    expect(tableHeadersAt(bare, [bare.indexOf("3 |")])).toEqual([null]);
  });

  it("Windows satır sonu (\\r\\n): başlık satır sonu karakteri taşımadan bulunur", () => {
    const content = "| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\n| 3 | 4 |";
    expect(tableHeadersAt(content, [content.indexOf("| 3")])).toEqual(["| A | B |"]);
  });

  it("üretim yeniden sıralayıcı yolu (prepareRerankScores) başlık uzunluğunu adaya taşır: istekte başlık + 600 karakter gövde", async () => {
    vi.stubEnv("KB_TABLE_HEADER", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    // Satır ~800 karakter: parça (başlık + tek satır) 600 + başlık uzunluğunu aşar — kırpma farkı istekte görünür.
    const longRow = (i: number) => `| Satır ${i} ${"uzun açıklama ".repeat(55)}| ${i} TL | ${i * 2} TL | ${i * 3} TL |`;
    const item = src([HEADER, SEP, ...Array.from({ length: 4 }, (_, i) => longRow(i))].join("\n"));
    const chunks = chunkItem(item);
    const c = chunks.find((x) => x.prefixChars !== undefined)!;
    const other = chunks.find((x) => x !== c)!;
    const bodies: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const payload = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
      bodies.push(payload.messages.find((m) => m.role === "user")?.content ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers: [], related: [] }) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await prepareRerankScores({ items: [item], guestMessage: "ücret ne kadar?", candidates: [[{ key: chunkKey(c) }, { key: chunkKey(other) }]], fetchImpl });
    expect(bodies).toHaveLength(1);
    const full = `${c.title} — ${c.text}`;
    expect(full.length).toBeGreaterThan(RERANK_TEXT_CHARS + c.prefixChars!);
    expect(bodies[0]).toContain(`<<<${full.slice(0, RERANK_TEXT_CHARS + c.prefixChars!)}>>>`);
  });
});
