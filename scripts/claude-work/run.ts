// ---------------------------------------------------------------------------
// CLAUDE ÇALIŞMA PAKETİ (kurucu 10-21: "100 dolarım var, bomboş duruyor — testler, öneriler, pazar analizi, geliştirmeler; Sonnet 5.5").
//
// GitHub Actions'ta koşar (`.github/workflows/claude-work.yml`; anahtar Actions sırrında, depoya / günlüğe yazılmaz). Ürünün kendisi bu
// dosyayı içe aktarmaz. İşler `evals/claude-work-request.json` içinden seçilir; her işin ve paketin DOLAR TAVANI vardır (kullanım alanından
// hesaplanır, tavana gelen iş yeni çağrı başlatmaz). Çıktılar `claude-work-out/` altına yazılır; iş sonunda arşiv günlüğe base64 basılır
// (oturum yapıt indiremez, günlüğü okur). Sonuçlar KARAR DEĞİLDİR: bulgular kodla doğrulanır, müşteriye dokunan öneriler kurucuya sorulur.
//
// İşler: ping (istek biçimi denemesi — düşerse paket durur) · market (web aramalı pazar / rakip araştırması + strateji sentezi) ·
// code_review (bütün kaynak, üç mercek) · scenarios (anlama ölçümü için yeni senaryolar, şema + doğrulayıcıdan geçer) · ux_copy (müşteriye
// görünen metin denetimi).
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { validateUxDataset, type UxDataset, type UxScenario } from "../../tests/eval/understanding-e2e-scoring";

const ROOT = path.resolve(process.cwd());
const OUT = path.join(ROOT, "claude-work-out");

interface Request {
  model?: string;
  tasks: string[];
  budgetUsd: number;
  taskBudgetUsd?: Record<string, number>;
  concurrency?: number;
  scenarioBatches?: number;
}
const req = JSON.parse(readFileSync(path.join(ROOT, "evals/claude-work-request.json"), "utf8")) as Request;
const MODEL = req.model?.trim() || "claude-sonnet-5-5";
const BUDGET = Math.min(Math.max(req.budgetUsd ?? 0, 0), 95);
const CONCURRENCY = Math.min(Math.max(req.concurrency ?? 3, 1), 6);

// ── Maliyet ($ / 1M token; web araması $0.01) ────────────────────────────────────────────────────────────────────────────────
const PRICES: { prefix: string; in: number; out: number; cacheRead: number; cacheWrite: number }[] = [
  { prefix: "claude-sonnet-5-5", in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { prefix: "claude-opus-5-5", in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  { prefix: "claude-haiku-5-5", in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
];
const ledger = { total: 0, byTask: {} as Record<string, number>, calls: 0, searches: 0, refusals: 0, errors: 0, inTok: 0, outTok: 0, cacheRead: 0 };

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};
function charge(task: string, model: string, u: Usage | undefined): number {
  const p = PRICES.find((x) => model.startsWith(x.prefix)) ?? PRICES[1];
  const searches = u?.server_tool_use?.web_search_requests ?? 0;
  const usd =
    ((u?.input_tokens ?? 0) * p.in +
      (u?.output_tokens ?? 0) * p.out +
      (u?.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u?.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
      1e6 +
    searches * 0.01;
  ledger.total += usd;
  ledger.byTask[task] = (ledger.byTask[task] ?? 0) + usd;
  ledger.calls += 1;
  ledger.searches += searches;
  ledger.inTok += u?.input_tokens ?? 0;
  ledger.outTok += u?.output_tokens ?? 0;
  ledger.cacheRead += u?.cache_read_input_tokens ?? 0;
  return usd;
}
function overBudget(task: string): boolean {
  const cap = req.taskBudgetUsd?.[task] ?? BUDGET;
  return ledger.total >= BUDGET || (ledger.byTask[task] ?? 0) >= cap;
}

// ── Çağrı ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new Anthropic({ timeout: 20 * 60 * 1000, maxRetries: 3 });

interface CallOpts {
  task: string;
  system: string;
  user: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  maxTokens?: number;
  schema?: Record<string, unknown>;
  webSearch?: number;
}

/**
 * Tek iş çağrısı (akışla, `finalMessage`). Sistem istemi önbelleklenir (aynı mercekteki çağrılar ucuz okur). Reddedilme sunucu tarafında
 * yedek modele düşer (`fallbacks: "default"`). Web araması `pause_turn` ile durursa aynı istekle sürdürülür (en çok 6 kez).
 */
async function call(o: CallOpts): Promise<{ text: string; model: string; stop: string } | null> {
  if (overBudget(o.task)) return null;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: o.user }];
  let acc = "";
  let last: { text: string; model: string; stop: string } | null = null;
  for (let turn = 0; turn < 7; turn++) {
    const params = {
      model: MODEL,
      max_tokens: o.maxTokens ?? 32000,
      system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: o.effort ?? "high", ...(o.schema ? { format: { type: "json_schema", schema: o.schema } } : {}) },
      ...(o.webSearch ? { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: o.webSearch }] } : {}),
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = (await client.beta.messages.stream(params as never).finalMessage()) as unknown as Anthropic.Beta.BetaMessage;
    } catch (err) {
      ledger.errors += 1;
      const status = err instanceof Anthropic.APIError ? err.status : "net";
      console.error(`[claude-work] ${o.task}: çağrı hatası ${status} ${err instanceof Error ? err.message.slice(0, 300) : ""}`);
      return null;
    }
    charge(o.task, msg.model, msg.usage as Usage);
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    acc = acc ? `${acc}\n${text}` : text;
    last = { text: acc, model: msg.model, stop: String(msg.stop_reason) };
    if (msg.stop_reason === "refusal") {
      ledger.refusals += 1;
      return null;
    }
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content as never });
  }
  return last;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(text.slice(s, e + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function pool<T>(items: T[], fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function write(rel: string, body: string): void {
  const p = path.join(OUT, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body, "utf8");
}

function repoFiles(patterns: string[]): string[] {
  const out = execFileSync("git", ["-c", `safe.directory=${ROOT}`, "ls-files", "-z", "--", ...patterns], { cwd: ROOT, encoding: "utf8" });
  return out.split("\0").filter(Boolean).sort();
}

/** Dosyaları satır numaralı metin demetlerine böler (demet başına karakter tavanı; tek büyük dosya kendi demetinde). */
function bundles(files: string[], cap: number): { files: string[]; text: string }[] {
  const out: { files: string[]; text: string }[] = [];
  let cur: { files: string[]; text: string } = { files: [], text: "" };
  for (const f of files) {
    const body = readFileSync(path.join(ROOT, f), "utf8");
    const numbered = body
      .split("\n")
      .map((l, i) => `${i + 1}| ${l}`)
      .join("\n");
    const block = `\n===== FILE: ${f} =====\n${numbered}\n`;
    if (cur.text.length > 0 && cur.text.length + block.length > cap) {
      out.push(cur);
      cur = { files: [], text: "" };
    }
    cur.files.push(f);
    cur.text += block;
  }
  if (cur.files.length > 0) out.push(cur);
  return out;
}

/** CLAUDE.md'nin bir bölümü (başlıktan bir sonraki "## " başlığına kadar). */
function claudeSection(title: string): string {
  const md = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
  const i = md.indexOf(`## ${title}`);
  if (i < 0) return "";
  const j = md.indexOf("\n## ", i + 3);
  return md.slice(i, j < 0 ? undefined : j);
}

// ── İş: ping ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function ping(): Promise<boolean> {
  const r = await call({
    task: "ping",
    system: "Reply with the JSON schema only.",
    user: "Return ok=true and the current year you believe it is.",
    effort: "low",
    maxTokens: 2000,
    schema: { type: "object", additionalProperties: false, required: ["ok", "year"], properties: { ok: { type: "boolean" }, year: { type: "integer" } } },
  });
  const s = await call({
    task: "ping",
    system: "Answer in one short sentence.",
    user: "Search the web once: what is the official website domain of Airbnb? Answer with the domain only.",
    effort: "low",
    maxTokens: 4000,
    webSearch: 1,
  });
  const ok = !!r && parseJson<{ ok?: boolean }>(r.text)?.ok === true && !!s;
  write("ping.md", `# ping\n\n- yapılandırılmış çıktı: ${r ? r.text : "DÜŞTÜ"}\n- web araması: ${s ? s.text.slice(0, 200) : "DÜŞTÜ"}\n- model: ${r?.model ?? "?"}\n`);
  console.log(`[claude-work] ping ${ok ? "TAMAM" : "DÜŞTÜ"} model=${r?.model ?? "?"}`);
  return ok;
}

// ── İş: pazar araştırması ────────────────────────────────────────────────────────────────────────────────────────────────────
const MARKET_TOPICS: { id: string; q: string }[] = [
  { id: "01-turkiye-pazari", q: "Türkiye kısa dönem kiralama (Airbnb, Booking) pazarı 2025-2026: aktif ilan sayıları ve şehir dağılımı, 7464 sayılı kanun ve kısa dönem kiralama izin belgesi uygulaması, vergi / belediye yükümlülükleri, kanunun ev sahibi sayısına etkisi, profesyonel işletmeci (5+ daire) oranı. Sayılara kaynak ve tarih ver." },
  { id: "02-ai-mesaj-rakipleri", q: "Kısa dönem kiralama ev sahipleri için yapay zekâ misafir mesajlaşma araçları ve PMS'lerin AI özellikleri (Hospitable, Guesty ReplyAI / Guesty AI, Hostaway, Lodgify, Smoobu, Uplisting, HostBuddy AI, Enso Connect, Boom, Akia, Jurny, Hostfully, OwnerRez): fiyatlandırma (ilan başına aylık), otomatik cevap mı taslak mı, riskli mesajı insana bırakma, çok dilli destek, Türkçe destek, Türkiye'de kullanım. Tablo halinde." },
  { id: "03-kanal-erisimi", q: "2026 itibarıyla Airbnb API erişimi (Software Partner programı şartları, yeni partner kabulü, mesajlaşma API'si), Booking.com Connectivity Partner programı şartları ve mesajlaşma API'si, iCal'in sınırları. Küçük bir girişimin doğrudan entegrasyona ulaşma yolu, süreleri, maliyetleri, alternatif (Channex, Rentals United gibi ara katman) seçenekleri." },
  { id: "04-fiyat-kiyas", q: "Kısa dönem kiralama yazılımlarında ilan başına aylık fiyatlar (USD) ve Türkiye'deki ev sahiplerinin ödeme istekliliği; yerel SaaS fiyat örnekleri (TL). Karşılaştırma için: Lixus AI fiyatları Başlangıç ₺449/ay (1-2 daire), Pro ₺899/ay (3-7 daire), İşletme ₺1.699/ay (8-25 daire), USD/TRY ≈ 46. Bu fiyatların konumu ve önerilen fiyat deneyleri." },
  { id: "05-yerel-rakipler", q: "Türkiye'de yerli otel / pansiyon / kısa dönem kiralama yazılımları ve kanal yöneticileri (HotelRunner, Elektraweb, Sirius, Odamax, Reseliva, diğerleri) — kısa dönem kiralama ev sahiplerine sundukları, AI mesajlaşma özellikleri, fiyatları, pazar payı tahminleri." },
  { id: "06-pazara-giris", q: "Türkiye'de Airbnb ev sahiplerine ulaşma kanalları: Facebook / Telegram / WhatsApp ev sahibi toplulukları, Superhost toplulukları, temizlik ve anahtar teslim şirketleriyle ortaklık, emlakçılar, içerik pazarlaması, etkinlikler; benzer B2B SaaS'ların Türkiye'de kullanıcı edinme deneyimleri ve maliyetleri." },
  { id: "07-platform-tehdidi", q: "Airbnb ve Booking.com'un kendi yapay zekâ özellikleri (2025-2026): ev sahibine AI cevap önerisi, otomatik mesajlaşma, misafir destek botları; bunların bağımsız AI mesajlaşma araçlarına etkisi ve bağımsız araçların farklılaşma yolları." },
];

async function market(): Promise<void> {
  const system = [
    "Sen titiz bir pazar araştırmacısısın. Web aramasıyla güncel kaynak bul, Türkçe yaz.",
    "Kurallar: her sayısal iddiaya kaynak (URL) ve tarih ver; bulamadığını açıkça 'kaynak bulunamadı' diye yaz, tahmin üretme; tahmin gerekiyorsa 'TAHMİN' diye işaretle ve dayanağını yaz.",
    "Biçim: Markdown. Önce 5-8 maddelik özet, sonra ayrıntı, en sonda 'Kaynaklar' listesi.",
  ].join("\n");
  const reports: string[] = [];
  await pool(MARKET_TOPICS, async (t) => {
    const r = await call({ task: "market", system, user: t.q, effort: "high", maxTokens: 32000, webSearch: 12 });
    if (!r) return;
    write(`market/${t.id}.md`, `# ${t.id}\n\n> Soru: ${t.q}\n\n${r.text}\n`);
    reports.push(`## ${t.id}\n${r.text}`);
  });
  if (reports.length === 0) return;
  const product = [claudeSection("Ürün"), claudeSection("Fiyat (kullanıcı onaylı, FLAT)"), claudeSection("Hospitable ortaklığı"), claudeSection("Mevcut özellikler (tekrar ekleme)")].join("\n\n");
  const s = await call({
    task: "market",
    system: "Sen deneyimli bir B2B SaaS strateji danışmanısın. Türkçe, somut ve dürüst yaz; abartı ve klişe yok.",
    user: [
      "Aşağıda bir ürünün tanımı ve 7 araştırma raporu var. Kurucuya şu başlıklarla bir strateji notu yaz:",
      "1) Pazarın gerçek boyutu ve hedef müşteri (sayılarla, kaynaklı) 2) Rakip konumu: kim ne veriyor, Lixus nerede farklı / geride",
      "3) Fiyat önerileri ve denenecek fiyat deneyleri 4) İlk 100 müşteriye ulaşma planı (kanal, maliyet, ölçü) 5) Ürün yol planına en çok değer katacak 10 geliştirme (gerekçe + kaba emek)",
      "6) En büyük 5 risk ve önlemi 7) Kurucunun karar vermesi gereken sorular. Her öneride 'neden' ve 'nasıl ölçülür' olsun. Raporlarda kaynağı olmayan sayıyı kullanma.",
      "",
      "=== ÜRÜN ===",
      product,
      "",
      "=== RAPORLAR ===",
      reports.join("\n\n"),
    ].join("\n"),
    effort: "high",
    maxTokens: 48000,
  });
  if (s) write("market/00-strateji-notu.md", s.text);
}

// ── İş: kod incelemesi ───────────────────────────────────────────────────────────────────────────────────────────────────────
const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line", "severity", "category", "title", "scenario", "evidence", "fix_hint", "confidence"],
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          severity: { type: "string", enum: ["P0", "P1", "P2"] },
          category: { type: "string" },
          title: { type: "string" },
          scenario: { type: "string" },
          evidence: { type: "string" },
          fix_hint: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
};

const LENSES: { id: string; scope: (f: string) => boolean; text: string }[] = [
  {
    id: "dogruluk",
    scope: () => true,
    text: "Lens: CORRECTNESS. Logic errors, wrong conditions, off-by-one, null/undefined paths, timezone / date bugs, race conditions and missing transactions or locks, non-idempotent retries, swallowed errors that hide failures, Prisma misuse (array $transaction results read by position, missing organizationId in where, update without the guard that the comment claims), promises not awaited, wrong fallbacks.",
  },
  {
    id: "guvenlik",
    scope: () => true,
    text: "Lens: SECURITY AND PRIVACY. Tenant isolation (every query scoped to the caller's organization), authn/authz and role checks, session / CSRF, input validation and size limits, SSRF / injection / XSS, secrets or personal data (guest names, phones, messages) written to logs or error reports, KVKK retention / erasure gaps (a column holding guest text not covered by scrubbing), rate-limit bypass, webhook signature checks.",
  },
  {
    id: "misafir",
    scope: (f) => /src\/lib\/(ai|conversation-items|guest-chat|automation|decisions|early-checkin|channels|outbox|ai-suggestions|house-rules)|src\/app\/api\/chat/.test(f),
    text: "Lens: GUEST-FACING AI SAFETY. Any path where text can reach a guest without passing the safety gates; prompt injection from guest text or knowledge-base text; violations of the product rules in the context (risky messages must stay with the host, 'I don't know' never goes to the guest, payment / refund / stay-change decisions are the host's); regexes on guest text with quadratic backtracking (unanchored prefix + unbounded repetition); places where a code rule contradicts the documented founder decision.",
  },
];

async function codeReview(): Promise<void> {
  const files = repoFiles(["src/lib/**/*.ts", "src/app/api/**/*.ts", "src/middleware.ts", "src/instrumentation.ts"]).filter(
    (f) => !/\.test\.|\.d\.ts$/.test(f),
  );
  const context = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
  const jobs: { lens: (typeof LENSES)[number]; bundle: { files: string[]; text: string }; idx: number }[] = [];
  for (const lens of LENSES) {
    const bs = bundles(files.filter(lens.scope), 300_000);
    bs.forEach((b, idx) => jobs.push({ lens, bundle: b, idx }));
  }
  console.log(`[claude-work] code_review: ${jobs.length} çağrı`);
  const all: unknown[] = [];
  await pool(jobs, async (j) => {
    const system = [
      "You are a senior TypeScript / Next.js / Prisma reviewer auditing a production multi-tenant SaaS (short-term-rental guest messaging with AI). Report only REAL defects you can point to in the given code — no style, naming, or refactoring advice, no speculation about code you cannot see. Each finding must name the exact file and line, a concrete failing scenario (input / state → wrong result), and the evidence (quote the line). If unsure, lower the confidence; if nothing real, return an empty list. At most 15 findings per bundle, most severe first. Write title / scenario / fix_hint in Turkish.",
      j.lens.text,
      "",
      "PROJECT RULES AND DECISIONS (CLAUDE.md, for context — documented decisions are intentional, do not report them as bugs unless the code contradicts them):",
      context,
    ].join("\n");
    const r = await call({
      task: "code_review",
      system,
      user: `Files (${j.bundle.files.length}): ${j.bundle.files.join(", ")}\n${j.bundle.text}`,
      effort: "high",
      maxTokens: 32000,
      schema: FINDINGS_SCHEMA,
    });
    if (!r) return;
    const parsed = parseJson<{ findings: Record<string, unknown>[] }>(r.text);
    const findings = (parsed?.findings ?? []).map((f) => ({ ...f, lens: j.lens.id }));
    all.push(...findings);
    write(`code-review/${j.lens.id}-${String(j.idx + 1).padStart(2, "0")}.json`, JSON.stringify({ files: j.bundle.files, findings }, null, 2));
  });
  write("code-review/all.json", JSON.stringify(all, null, 2));
}

// ── İş: senaryo üretimi (anlama ölçümü) ──────────────────────────────────────────────────────────────────────────────────────
const SCENARIO_THEMES = [
  "komşu tesis tuzakları: aynı özellik (saat / ücret / konum) farklı tesislerde farklı değer",
  "ilişki türü tuzakları: önceden haber süresi ↔ kullanım süresi, ücretli ↔ ücretsiz, izin ↔ yasak, zorunluluk ↔ seçenek",
  "koşullu kurallar: gece sayısı, kişi sayısı, kilo, yaş, hafta sonu / hafta içi şartı",
  "şikâyet + bağımsız soru (iki ayrı konu)",
  "şikâyet + bağlı soru (şikâyet edilen şeyin kendisi / tekrar olursa / biri gelebilir mi)",
  "şikâyet + ilişkisi belirsiz soru",
  "arıza + çözüm sorusu: bilgi tabanında tarifi olan tehlikesiz cihaz",
  "arıza + çözüm sorusu: tehlikeli cihaz (elektrik, gaz, kombi, sıcak su) ya da tarifsiz cihaz",
  "aynı sözcük farklı anlam çiftleri: bilgi sorusu ↔ acil durum",
  "aynı sözcük farklı anlam çiftleri: standart saat sorusu ↔ konaklama değişikliği isteği",
  "çok turlu: önceki mesaj konuyu belirliyor ('peki ya ...?', 'o ne kadar?')",
  "çok turlu: misafir isteğinden vazgeçiyor, yerine başka soru soruyor",
  "çok turlu: önceki şikâyetten sonra gelen 'bu normal mi' / 'ne zaman düzelir'",
  "bilgi tabanında olmayan bilgi (tek soru ve başka bir sorunun yanında)",
  "iade / iptal / ödeme isteğinin yanında bağımsız ve bağlı sorular",
  "ev sahibiyle görüşme isteği + bağımsız soru",
  "iki cevapsız mesaja dağılmış istekler",
  "çok uzun, dağınık, yazım hatalı misafir mesajı (üç-dört istek)",
];
const SCENARIO_LANGS = ["tr", "tr", "tr", "en", "de", "fr", "es", "ru", "ar"];

const SCENARIO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kbItems", "scenarios"],
  properties: {
    kbItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "title", "content"],
        properties: { id: { type: "string" }, category: { type: "string" }, title: { type: "string" }, content: { type: "string" } },
      },
    },
    scenarios: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "lang", "tags", "pair", "history", "message", "requests"],
        properties: {
          id: { type: "string" },
          lang: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          pair: { type: "string" },
          history: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["direction", "body"],
              properties: { direction: { type: "string", enum: ["inbound", "outbound"] }, body: { type: "string" } },
            },
          },
          message: { type: "string" },
          requests: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "span", "intents", "relation", "expect", "facts", "wrong", "why"],
              properties: {
                id: { type: "string" },
                span: { type: "string" },
                intents: { type: "array", items: { type: "string" } },
                relation: { type: "string", enum: ["none", "independent", "dependent", "ambiguous"] },
                expect: { type: "string", enum: ["answer", "hold", "emergency", "none"] },
                facts: {
                  type: "array",
                  items: { type: "object", additionalProperties: false, required: ["about", "value"], properties: { about: { type: "array", items: { type: "string" } }, value: { type: "string" } } },
                },
                wrong: {
                  type: "array",
                  items: { type: "object", additionalProperties: false, required: ["about", "value"], properties: { about: { type: "array", items: { type: "string" } }, value: { type: "string" } } },
                },
                why: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

async function scenarios(): Promise<void> {
  const design = readFileSync(path.join(ROOT, "docs/TASARIM-2026-10-21-anlama-olcumu.md"), "utf8");
  const spec = design.slice(design.indexOf("## 4. Senaryo biçimi"), design.indexOf("## 6."));
  const n = Math.min(Math.max(req.scenarioBatches ?? 24, 1), 40);
  const batches = Array.from({ length: n }, (_, i) => ({
    i,
    theme: SCENARIO_THEMES[i % SCENARIO_THEMES.length],
    langs: [SCENARIO_LANGS[i % SCENARIO_LANGS.length], SCENARIO_LANGS[(i + 4) % SCENARIO_LANGS.length]],
  }));
  const property = { name: "Lale Konak", checkInTime: "15:00", checkOutTime: "11:00", city: "İzmir" };
  const kbSets: Record<string, UxDataset["kbSets"][string]> = {};
  const kept: UxScenario[] = [];
  let rejected = 0;
  await pool(batches, async (b) => {
    const system = [
      "You write evaluation scenarios for a short-term-rental guest-messaging AI. Follow the format and the expected-behaviour rules below EXACTLY. Use fictional names only. Return the JSON schema only.",
      "Every 'span' must be a VERBATIM substring of 'message' (or of an inbound history message that comes after the last outbound one). Every facts/wrong 'value' must appear LITERALLY in one of your kbItems. 'pair' is '' unless two scenarios in THIS batch form a same-words / different-meaning pair (then both carry the same pair id). Use 24h times (e.g. 20:00) in the KB.",
      "Requests with expect 'answer' must have at least one fact whose 'about' words would appear in a correct reply sentence next to the value.",
      spec,
    ].join("\n");
    const r = await call({
      task: "scenarios",
      system,
      user: `Batch ${b.i + 1}. Theme: ${b.theme}. Write ONE knowledge base of 12-18 items (property "${property.name}", check-in 15:00, check-out 11:00; several facilities / services with the SAME attribute but different values, some items with conditions) and 12 scenarios using it. Languages: mostly ${b.langs[0]}, some ${b.langs[1]}. Scenario ids must start with "g${b.i + 1}-".`,
      effort: "medium",
      maxTokens: 48000,
      schema: SCENARIO_SCHEMA,
    });
    if (!r) return;
    const parsed = parseJson<{ kbItems: UxDataset["kbSets"][string]; scenarios: (UxScenario & { pair: string })[] }>(r.text);
    if (!parsed) return;
    const kbName = `g${b.i + 1}`;
    for (const s0 of parsed.scenarios ?? []) {
      const s: UxScenario = { ...s0, kb: kbName, ...(s0.pair ? { pair: `${kbName}-${s0.pair}` } : { pair: undefined }) };
      if (!s.pair) delete s.pair;
      const solo: UxDataset = { version: 1, property, kbSets: { [kbName]: parsed.kbItems }, scenarios: [{ ...s, pair: undefined }] };
      if (validateUxDataset(solo).length === 0) kept.push(s);
      else rejected += 1;
    }
    kbSets[kbName] = parsed.kbItems;
  });
  // Çiftin bir eşi düştüyse diğerinin çift işareti de kalkar (doğrulayıcı çiftleri ikili ister).
  const pairCount = new Map<string, number>();
  for (const s of kept) if (s.pair) pairCount.set(s.pair, (pairCount.get(s.pair) ?? 0) + 1);
  for (const s of kept) if (s.pair && pairCount.get(s.pair) !== 2) delete s.pair;
  const ds: UxDataset = {
    version: 1,
    note: `Claude (${MODEL}) üretimi geliştirme seti — claude-work scenarios işi; doğrulayıcıdan geçen ${kept.length}, düşen ${rejected}. Beklentiler kurucu kurallarından üretildi; ölçümden önce örneklem insan gözüyle denetlenir.`,
    property,
    kbSets,
    scenarios: kept.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })),
  };
  write("scenarios/understanding-e2e-gen.json", `${JSON.stringify(ds, null, 2)}\n`);
  write("scenarios/report.md", `# senaryo üretimi\n\n- toplu: ${batches.length}\n- geçen senaryo: ${kept.length}\n- düşen: ${rejected}\n- doğrulayıcı: ${JSON.stringify(validateUxDataset(ds).slice(0, 20))}\n`);
}

// ── İş: müşteriye görünen metin ──────────────────────────────────────────────────────────────────────────────────────────────
const COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line", "current", "suggested", "reason", "severity"],
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          current: { type: "string" },
          suggested: { type: "string" },
          reason: { type: "string" },
          severity: { type: "string", enum: ["hata", "kafa_karistirici", "ton", "yazim"] },
        },
      },
    },
  },
};

async function uxCopy(): Promise<void> {
  const files = repoFiles(["src/app/**/*.tsx", "src/components/**/*.tsx", "src/lib/email-templates.ts"]).filter((f) => !f.startsWith("src/app/api/"));
  const rules = [claudeSection("Çalışma tarzı"), claudeSection("Kalıcı kararlar (yeniden tartışma yok — gerekçe: arşiv + git log)")].join("\n");
  const bs = bundles(files, 300_000);
  const all: unknown[] = [];
  await pool(bs, async (b, idx) => {
    const r = await call({
      task: "ux_copy",
      system: [
        "Türkçe ürün metni editörüsün. Yalnız MÜŞTERİNİN (ev sahibinin ya da misafirin) EKRANDA / E-POSTADA GÖRDÜĞÜ metinleri incele (kod, değişken adı, yorum değil).",
        "Kurallar: sade dil, teknik açıklama yok (bayt, kova, TOTP, token gibi), gereksiz uzatma yok; hitap 'siz' ve emir kipinde '-in' ('oluşturun', '-iniz' değil); şifre 'seçilmez', OLUŞTURULUR; 'AI yanıtı' değil 'AI işlemi'; mutlak / abartılı iddia yok; büyük platformların deyimi.",
        "Yalnız gerçekten düzeltilmesi gerekenleri yaz: anlamı belirsiz, yanlış, tutarsız, yazım hatalı ya da kurala aykırı. En çok 40 bulgu. Önerilen metni yaz.",
        "Ürün kuralları:",
        rules,
      ].join("\n"),
      user: b.text,
      effort: "medium",
      maxTokens: 32000,
      schema: COPY_SCHEMA,
    });
    if (!r) return;
    const findings = parseJson<{ findings: unknown[] }>(r.text)?.findings ?? [];
    all.push(...findings);
    write(`ux-copy/${String(idx + 1).padStart(2, "0")}.json`, JSON.stringify({ files: b.files, findings }, null, 2));
  });
  write("ux-copy/all.json", JSON.stringify(all, null, 2));
}

// ── Ana akış ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TASKS: Record<string, () => Promise<void>> = { market, code_review: codeReview, scenarios, ux_copy: uxCopy };

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[claude-work] ANTHROPIC_API_KEY yok — koşu yapılmadı.");
    return;
  }
  const ok = await ping();
  if (!ok) {
    write("usage.json", JSON.stringify(ledger, null, 2));
    process.exitCode = 1;
    return;
  }
  // Pazar araştırması web araması bekler; öteki işler paralel koşar (tavanlar ayrı).
  const selected = req.tasks.filter((t) => t !== "ping" && TASKS[t]);
  await Promise.all(
    selected.map(async (t) => {
      const t0 = Date.now();
      try {
        await TASKS[t]();
      } catch (err) {
        ledger.errors += 1;
        console.error(`[claude-work] ${t} düştü: ${err instanceof Error ? err.message.slice(0, 300) : err}`);
      }
      console.log(`[claude-work] ${t} bitti ${Math.round((Date.now() - t0) / 1000)} sn, $${(ledger.byTask[t] ?? 0).toFixed(2)}`);
    }),
  );
  write("usage.json", JSON.stringify({ model: MODEL, budget: BUDGET, ...ledger }, null, 2));
  console.log(`[claude-work] TOPLAM $${ledger.total.toFixed(2)} · çağrı ${ledger.calls} · arama ${ledger.searches} · ret ${ledger.refusals} · hata ${ledger.errors}`);
  if (!existsSync(OUT)) mkdirSync(OUT);
}

void main();
