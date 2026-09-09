import { KB_ITEM_CAP, KB_RETRIEVAL_FETCH_CAP } from "@/lib/ai/limits";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { selectKbForPrompt, type KbRetrievalMode, type KbSelectResult } from "@/lib/ai/retrieval/select";
import type { KbChunkSource } from "@/lib/ai/retrieval/chunker";
import { FILLERS, longGuide } from "./kb-retrieval-scenarios";

// ---------------------------------------------------------------------------
// EŞLEŞTİRİLMİŞ legacy/hibrit EVAL — MODEL'SİZ TARAF (RAG dilim 3, Codex turu 3).
//
// Aynı soru + aynı bilgi tabanı iki modda `kb-fetch` AYNASINDAN geçer (legacy:
// en yeni 30; hibrit: en yeni 200 + seçici) ve `packKnowledgeBase`e girer —
// yani modele giden blok ÜRETİMLE aynı yoldan kurulur. "Gold istemde mi" KODDAN
// ölçülür; gerçek model cevabının kontrolü eval dosyasındadır.
// ---------------------------------------------------------------------------

export interface PairedKbSpec {
  /** İlk N dolgu (`FILLERS`, `excludeTopics` hariç). */
  fillers: number;
  excludeTopics?: string[];
  extra?: (
    | { ref: "guide"; age: "oldest" | "newest" }
    | { id: string; category: string; title: string; content: string; age: "oldest" | "newest" }
  )[];
}

export interface PairedScenario {
  id: string;
  question: string;
  history?: { direction: "inbound" | "outbound"; body: string }[];
  propertyCheckOutTime?: string;
  kb: PairedKbSpec;
  gold: { needles: string[] };
  expect: {
    correctAny?: string[];
    correctAll?: string[];
    forbidden?: string[];
    noUnverifiedCommitment?: boolean;
    noDefiniteValue?: boolean;
    acknowledgeAbsenceWhenGoldMissing?: boolean;
    usedSourcesEmptyWhenGoldMissing?: boolean;
    why: string;
  };
}

export type PairedItem = KbChunkSource & { supersededById: null };

const BASE = Date.UTC(2026, 8, 1, 10, 0, 0);
const DAY = 86_400_000;

/** Deterministik bilgi tabanı: dolgular BASE + i dk; "oldest" BASE − 1 gün, "newest" BASE + 1 gün. */
export function buildPairedKb(spec: PairedKbSpec): PairedItem[] {
  const excluded = new Set(spec.excludeTopics ?? []);
  const items: PairedItem[] = FILLERS.filter((f) => !excluded.has(f.topic))
    .slice(0, spec.fillers)
    .map((f, i) => ({
      id: `kb_filler_${f.topic}`,
      category: f.category,
      title: f.title,
      content: f.content,
      updatedAt: new Date(BASE + i * 60_000),
      supersededById: null,
    }));
  for (const e of spec.extra ?? []) {
    const updatedAt = new Date(e.age === "oldest" ? BASE - DAY : BASE + DAY);
    if ("ref" in e) items.push({ id: "kb_guide", category: "general", title: "Ev rehberi", content: longGuide(), updatedAt, supersededById: null });
    else items.push({ id: e.id, category: e.category, title: e.title, content: e.content, updatedAt, supersededById: null });
  }
  return items;
}

export interface PairedInputs {
  mode: KbRetrievalMode;
  /** `kb-fetch` aynası: `updatedAt desc` + take (30 / 200). */
  fetched: PairedItem[];
  fetchDropped: number;
  kbSel: KbSelectResult<PairedItem>;
  /** `packKnowledgeBase` çıktısı — istemdeki bilgi bloğunun kendisi. */
  promptText: string;
  promptChars: number;
  /** Tüm gold cümleleri blokta mı (gold yoksa null = ölçülemez). */
  goldInPrompt: boolean | null;
  droppedTotal: number;
}

/** Modele gidecek bilgi bloğunu ÜRETİMLE aynı yoldan kur (model çağrısı YOK). */
export function pairedInputs(s: PairedScenario, mode: KbRetrievalMode, items = buildPairedKb(s.kb)): PairedInputs {
  const sorted = [...items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const take = mode === "hybrid" ? KB_RETRIEVAL_FETCH_CAP : KB_ITEM_CAP;
  const fetched = sorted.slice(0, take);
  const fetchDropped = sorted.length - fetched.length;
  const kbSel = selectKbForPrompt({ items: fetched, guestMessage: s.question, history: s.history, mode });
  const droppedTotal = fetchDropped + kbSel.droppedItems;
  const promptText = packKnowledgeBase(kbSel.items, droppedTotal, kbSel.selection, kbSel.notes).text;
  const goldInPrompt = s.gold.needles.length === 0 ? null : s.gold.needles.every((n) => promptText.includes(n));
  return { mode, fetched, fetchDropped, kbSel, promptText, promptChars: promptText.length, goldInPrompt, droppedTotal };
}
