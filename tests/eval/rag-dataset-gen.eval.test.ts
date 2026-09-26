import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callStructuredJson } from "@/lib/ai/semantic/structured-call";

// ---------------------------------------------------------------------------
// RAG ÖLÇEK SETİ ÜRETİCİSİ (#189, 09-26) — gerçekçi, AYRI olgulu 300 kalemlik bilgi tabanı + misafir soruları.
// Neden: E4 kümesi konu başına tekrarlanan varyantlardan kurulu (300'de her konu ~8 yakın kopya) — gerçek bir 300 kalemlik
// KB'yi temsil etmez (Codex 09-26). Bu üretici İKİ bağımsız mülk üretir: `dev` (ayar yapılır, görülebilir) ve `holdout`
// (yalnız son doğrulama; içeriği yazdırılmaz, ona göre ayar YAPILMAZ). Model yalnız METİN yazar; iğne (cevabı taşıyan
// cümle) içeriğin BİREBİR alt dizisi olmak zorunda — kod doğrular, uymayan olgu düşer. Adlar kurgusal, gerçek marka yok.
// İKİ KAPI: RUN_REAL_EVAL=1 + anahtar + RAG_GEN=1 (normal eval koşusu seti YENİDEN ÜRETMEZ). Çıktı `evals/rag-scale/`.
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && process.env.RAG_GEN === "1" && key.length > 20 && !key.startsWith("test-");
const GEN_MODEL = process.env.RAG_GEN_MODEL?.trim() || "gpt-5.1";
const OUT = path.resolve(__dirname, "../../evals/rag-scale");

export const FORBIDDEN_TOPICS = [
  "sauna", "jacuzzi", "hot tub", "piano", "boat trip", "yoga", "tennis", "rooftop terrace", "babysitter", "game console",
  "fireplace", "barbecue", "EV charger", "printer", "sewing kit", "bicycle rental", "gym", "spa", "golf", "cinema room",
];

const CATEGORIES: { key: string; kbCategory: string; desc: string }[] = [
  { key: "checkin", kbCategory: "checkin", desc: "arrival and self check-in procedure: key box location, arrival time window, late arrival, luggage before check-in, ID registration" },
  { key: "checkout", kbCategory: "checkout", desc: "departure procedure: time, where to leave keys, what to do with dishes/linens/trash, late departure handling, taxi before departure" },
  { key: "access", kbCategory: "checkin", desc: "building and apartment access: main door, intercom, which floor, apartment door lock quirks, garage door, lost key procedure (no codes)" },
  { key: "wifi_tv", kbCategory: "wifi", desc: "internet and entertainment: network name, router location, what to do if slow, smart TV apps, channels, streaming, sound bar" },
  { key: "kitchen_appliances", kbCategory: "faq", desc: "cooking appliances: induction hob, oven modes, microwave, kettle, toaster, coffee machine type and pods, extractor hood" },
  { key: "kitchen_supplies", kbCategory: "faq", desc: "kitchen supplies and dishwasher: where pots/knives are, spices/oil, dishwasher program and tablets, water filter jug, fridge/freezer" },
  { key: "laundry", kbCategory: "cleaning", desc: "laundry: washing machine location and program, detergent, dryer or drying rack, iron and board, clothespins" },
  { key: "climate", kbCategory: "faq", desc: "heating and cooling: air conditioner remote and modes, radiators and boiler, thermostat, fans, windows and blinds for heat" },
  { key: "bathroom", kbCategory: "faq", desc: "bathroom and hot water: shower mixer, boiler/hot water wait, toiletries provided, hair dryer, towels, toilet do's and don'ts" },
  { key: "bedroom", kbCategory: "faq", desc: "bedrooms and linens: bed sizes, extra blankets/pillows, sofa bed mechanism, blackout curtains, wardrobe hangers, mosquito net" },
  { key: "trash", kbCategory: "trash", desc: "trash and recycling: bins in the flat, building containers location, recycling rules, glass, collection days, bulky items" },
  { key: "parking", kbCategory: "parking", desc: "parking and cars: private spot, street parking rules, paid zones, height limit, motorbike, car wash nearby, garage remote" },
  { key: "building", kbCategory: "general", desc: "the building: elevator size, stairs, doorman hours, mailbox, storage room, shared courtyard, bike storage (no rental)" },
  { key: "rules", kbCategory: "rules", desc: "house rules: smoking, pets, parties, quiet hours, visitors, shoes indoors, max occupancy, candles" },
  { key: "safety", kbCategory: "general", desc: "safety and emergencies: fire extinguisher and blanket location, first aid kit, emergency numbers, gas smell procedure, smoke detector beeping" },
  { key: "utilities", kbCategory: "faq", desc: "utilities: power outage and fuse box, water outage and building tank, internet outage fallback, generator, circuit breaker" },
  { key: "outdoor", kbCategory: "general", desc: "balcony and outdoor space: balcony furniture, plants watering, drying clothes outside, awning, view, balcony door lock" },
  { key: "kids", kbCategory: "faq", desc: "children and babies: travel cot, high chair, bath tub for babies, child-safety locks, toys and books, nearby playgrounds" },
  { key: "accessibility", kbCategory: "faq", desc: "accessibility: steps at entrance, elevator door width, shower threshold, grab bars, ground-floor alternatives, walking distances" },
  { key: "workspace", kbCategory: "faq", desc: "working remotely: desk and chair, monitor, power adapters and socket type, quiet room, printing alternatives (no printer at home)" },
  { key: "shops", kbCategory: "local_tips", desc: "groceries and shops: supermarkets, bakery, butcher, greengrocer, weekly market day, late-night kiosk, organic shop (fictional names)" },
  { key: "restaurants", kbCategory: "local_tips", desc: "restaurants and cafes: breakfast spot, seafood place, vegetarian option, dessert shop, takeaway, reservation tips (fictional names)" },
  { key: "sights", kbCategory: "local_tips", desc: "sights and culture: museums, old town, viewpoints, markets, opening days and closing days, tickets (fictional names)" },
  { key: "nature", kbCategory: "local_tips", desc: "beaches, parks and walks: nearest beach, sun loungers, park for running, walking trail, sunset spot, water quality" },
  { key: "transit", kbCategory: "location", desc: "public transport: metro line and nearest station, buses, tram, ferry, transit card purchase and top-up, night service" },
  { key: "travel", kbCategory: "location", desc: "airport and long-distance: airport shuttle stop and schedule, taxi estimate, train station, intercity bus terminal, car rental office" },
  { key: "health", kbCategory: "local_tips", desc: "health services: nearest pharmacy and on-duty pharmacy rule, hospital emergency room, clinic, dentist, vet (fictional names)" },
  { key: "services", kbCategory: "local_tips", desc: "everyday services: ATM, currency exchange, post office, luggage storage, laundromat, hairdresser, phone SIM shop" },
  { key: "housekeeping", kbCategory: "cleaning", desc: "cleaning service: mid-stay cleaning availability, towel change schedule, cleaning products under sink, what to do after spills, damage reporting" },
  { key: "local_tips", kbCategory: "local_tips", desc: "local tips and seasons: tap water drinkability, mosquitoes in summer, windy days, tipping, festivals, siesta hours, safety at night" },
];

const LANG_CYCLE = ["en", "de", "en", "ru", "en", "fr", "en", "ar", "en", "es"];

const BATCH_SCHEMA = {
  name: "kb_batch",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "lang", "content", "facts"],
          properties: {
            title: { type: "string" },
            lang: { type: "string", enum: ["tr", "en"] },
            content: { type: "string" },
            facts: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["needle", "questions"],
                properties: {
                  needle: { type: "string" },
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["lang", "text"],
                      properties: { lang: { type: "string" }, text: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = [
  "You write a realistic knowledge base that a short-term-rental host keeps for ONE specific apartment, plus realistic guest",
  "messages that the entries answer. Every place, shop, restaurant, street and person name is FICTIONAL and generic - never a",
  "real brand or real business. Output ONLY the JSON schema.",
].join(" ");

interface GenFact {
  needle: string;
  questions: { lang: string; text: string }[];
}
interface GenItem {
  title: string;
  lang: "tr" | "en";
  content: string;
  facts: GenFact[];
}

function batchPrompt(property: string, cat: (typeof CATEGORIES)[number], n: number, qLang: string, guide: boolean): string {
  return [
    `Apartment: ${property}.`,
    guide
      ? `Write ${n} LONG "house guide" entries (category ${cat.kbCategory}), each 2,200-2,900 characters of flowing Turkish text with 6 concrete facts spread across the text - at least two facts in the LAST third.`
      : `Topic area: ${cat.desc}. Write ${n} entries, each about a DIFFERENT specific fact of this area (no two entries about the same thing).`,
    guide
      ? "Each guide: 6 facts."
      : `Entry: title 2-5 words; content 1-4 sentences, 80-450 characters, concrete (times, places, steps, numbers, names). About 1 in 6 entries is written in English (lang "en"), the rest in Turkish ("tr"). Each entry has 1 or 2 facts.`,
    "needle = the exact sentence or clause from the content that carries the answer - COPY IT VERBATIM (it must be an exact substring of content, same characters and punctuation).",
    `Each fact has exactly 2 guest questions: questions[0] in Turkish (lang "tr"), questions[1] in lang "${qLang}". Write them like real guests on a messaging app: indirect, with context (who they are, why they ask), 6-30 words. They must be answerable ONLY by that needle, must NOT copy distinctive words of the title or content when a natural paraphrase exists (e.g. "we'll be cold at night" instead of "radiator"), and must not reveal the answer.`,
    `Never mention any of these anywhere: ${FORBIDDEN_TOPICS.join(", ")}.`,
  ].join("\n");
}

async function generateBatch(property: string, cat: (typeof CATEGORIES)[number], n: number, qLang: string, guide: boolean): Promise<GenItem[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await callStructuredJson({
      apiKey: key,
      model: GEN_MODEL,
      system: SYSTEM,
      user: batchPrompt(property, cat, n, qLang, guide),
      schema: BATCH_SCHEMA,
      timeoutMs: 20_000 * 6,
      maxTokens: 16_000,
      maxCompletionTokens: 32_000,
      reasoningEffort: undefined,
    });
    if (res.ok) return ((res.data as { items: GenItem[] }).items ?? []) as GenItem[];
  }
  return [];
}

export interface RagScaleItem {
  id: string;
  category: string;
  title: string;
  content: string;
  lang: "tr" | "en";
  /** Gün (0 = en yeni) — updatedAt yükleyicide kurulur. */
  ageDays: number;
}
export interface RagScaleFact {
  id: string;
  itemId: string;
  needle: string;
  questions: { lang: string; text: string }[];
}
export interface RagScaleSet {
  version: 1;
  split: "dev" | "holdout";
  note: string;
  property: string;
  generator: string;
  items: RagScaleItem[];
  facts: RagScaleFact[];
}

function forbidden(text: string): boolean {
  const t = text.toLocaleLowerCase("en");
  return FORBIDDEN_TOPICS.some((f) => t.includes(f.toLocaleLowerCase("en")));
}

async function generateSet(split: "dev" | "holdout", property: string, seed: number): Promise<RagScaleSet> {
  const items: RagScaleItem[] = [];
  const facts: RagScaleFact[] = [];
  let rnd = seed >>> 0;
  const rand = () => {
    rnd = (rnd + 0x6d2b79f5) >>> 0;
    let t = rnd;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const jobs: { cat: (typeof CATEGORIES)[number]; n: number; qLang: string; guide: boolean }[] = CATEGORIES.map((cat, i) => ({
    cat,
    n: 10,
    qLang: LANG_CYCLE[i % LANG_CYCLE.length],
    guide: false,
  }));
  jobs.push({ cat: { key: "guide", kbCategory: "general", desc: "house guide" }, n: 3, qLang: "en", guide: true });
  const results: GenItem[][] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < jobs.length) {
        const j = next++;
        results[j] = await generateBatch(property, jobs[j].cat, jobs[j].n, jobs[j].qLang, jobs[j].guide);
      }
    }),
  );
  jobs.forEach((job, j) => {
    (results[j] ?? []).forEach((it, k) => {
      const content = (it.content ?? "").trim().slice(0, 3_000);
      if (!content || forbidden(`${it.title} ${content}`)) return;
      const id = `${split === "dev" ? "d" : "h"}_${job.cat.key}_${k}`;
      const good = (it.facts ?? []).filter((f) => typeof f.needle === "string" && f.needle.trim().length >= 12 && content.includes(f.needle.trim()));
      if (good.length === 0) return;
      items.push({ id, category: job.cat.kbCategory, title: (it.title ?? "").trim().slice(0, 80) || job.cat.key, content, lang: it.lang === "en" ? "en" : "tr", ageDays: Math.floor(rand() * 400) });
      good.forEach((f, fi) => {
        const qs = (f.questions ?? []).filter((q) => typeof q.text === "string" && q.text.trim().length >= 8 && !q.text.includes(f.needle.trim()));
        if (qs.length > 0) facts.push({ id: `${id}_f${fi}`, itemId: id, needle: f.needle.trim(), questions: qs.map((q) => ({ lang: q.lang, text: q.text.trim() })) });
      });
    });
  });
  return {
    version: 1,
    split,
    note:
      split === "holdout"
        ? "HOLDOUT — yalnız son doğrulama için; içerik okunmaz/yazdırılmaz, ona göre ayar YAPILMAZ. Üretici: tests/eval/rag-dataset-gen.eval.test.ts."
        : "DEV — ayar ve teşhis için (görülebilir). Üretici: tests/eval/rag-dataset-gen.eval.test.ts.",
    property,
    generator: GEN_MODEL,
    items,
    facts,
  };
}

describe.skipIf(!enabled)("RAG ölçek seti üretimi (ücretli, bir kez)", () => {
  it("dev + holdout", async () => {
    mkdirSync(OUT, { recursive: true });
    const sets: [string, "dev" | "holdout", string, number][] = [
      ["dev.json", "dev", "a two-bedroom flat called Lale Evleri 4 on the third floor of an apartment building in a fictional coastal Turkish town (Kumsal) with a marina, old bazaar and hills", 11],
      ["holdout.json", "holdout", "a one-bedroom loft called Nergis Loft in a converted warehouse in a fictional inland Turkish city (Yaylakent) with a river, university district and a big park", 29],
    ];
    for (const [file, split, property, seed] of sets) {
      const target = path.join(OUT, file);
      if (existsSync(target)) continue; // bir kez üretilir; yeniden üretmek için dosyayı silin
      const set = await generateSet(split, property, seed);
      writeFileSync(target, `${JSON.stringify(set, null, 1)}\n`);
      console.log(`[rag-gen] ${file}: items=${set.items.length} facts=${set.facts.length}`);
      expect(set.items.length).toBeGreaterThan(250);
    }
  }, 60 * 60_000);
});
