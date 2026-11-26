import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReplyUserPrompt } from "@/lib/ai/prompts";
import type { SuggestReplyInput } from "@/lib/ai/types";
import type { ConversationStateSummary } from "@/lib/ai/conversation-state";

// ---------------------------------------------------------------------------
// Konuşma Anlama Durumu v1 dilim B — istem bağlantısı + izolasyon (tasarım `docs/MESAJLASMA-CEKIRDEGI-V2-2026-09-25.md` §2.2).
// Bayrak kapalıyken yükleyici `records` vermez → istem BAYT BAYT aynı. Hiçbir kapı modülü durumu OKUMAZ: yanlış bir durum
// kararı gevşetemez, en kötü hâli kötü bir taslaktır ve kapılar onu yine süzer.
// ---------------------------------------------------------------------------

function input(records?: ConversationStateSummary): SuggestReplyInput {
  return {
    guestMessage: "Erken giriş ne oldu?",
    property: { name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" },
    knowledgeBase: [],
    reservation: null,
    history: [
      { direction: "inbound", body: "Saat 12'de girebilir miyiz?" },
      { direction: "outbound", body: "Talebiniz kaydedildi; ev sahibiniz görebilir." },
    ],
    tone: "warm",
    language: "tr",
    conversationState: records === undefined ? { isFirstOperatorReply: false } : { isFirstOperatorReply: false, records },
  };
}

const PENDING: ConversationStateSummary = {
  outbound: 1,
  hostOutbound: 0,
  unansweredGuest: 1,
  items: [{ topic: "early_checkin", status: "deferred_to_host" }],
  lifecycleSent: ["welcome"],
};

describe("istem — kayıt bloğu", () => {
  it("🚨 kayıt yoksa istem BAYT BAYT aynı (bayrak kapalı = bugünkü davranış)", () => {
    const without = buildReplyUserPrompt(input());
    const withUndefined = buildReplyUserPrompt({ ...input(), conversationState: { isFirstOperatorReply: false, records: undefined } });
    expect(withUndefined).toBe(without);
    expect(without).not.toMatch(/KONUŞMA KAYITLARI/);
  });

  it("kayıt varsa blok geçmişin ardında, ETİKET uyarısı ve karar kuralıyla", () => {
    const p = buildReplyUserPrompt(input(PENDING));
    expect(p).toMatch(/KONUŞMA KAYITLARI \(kodda, kalıcı kayıtlardan kuruldu\):/);
    expect(p).toMatch(/erken giriş: misafire kararın ev sahibinde olduğu söylendi; ev sahibi henüz yazmadı\./);
    expect(p).toMatch(/konu adları eski sınıflandırmanın ETİKETİDİR, olgu değil/);
    expect(p).toMatch(/Kararı ev sahibinde olan konuda karar VERME, söz VERME, sonuç UYDURMA/);
    expect(p).toMatch(/Otomatik gönderilmiş bilgilendirme: karşılama\./);
    expect(p.indexOf("KONUŞMA KAYITLARI")).toBeGreaterThan(p.indexOf("<<HISTORY_END>>"));
  });

  it("söylenecek bir şey yoksa (ilk temas, kayıt yok, otomatik mesaj yok) blok yazılmaz", () => {
    const empty: ConversationStateSummary = { outbound: 0, hostOutbound: 0, unansweredGuest: 1, items: [], lifecycleSent: [] };
    expect(buildReplyUserPrompt(input(empty))).toBe(buildReplyUserPrompt(input()));
  });
});

// ---------------------------------------------------------------------------
// İZOLASYON (mekanik pin): durumu yalnız istem, tip ve yükleyici bilir; yükleyiciyi yalnız üç cevap yüzeyi çağırır.
// Yeni bir içe aktaran bilinçli olarak bu listeye eklenir — özellikle bir KAPI modülü asla (durum kararı gevşetemez).
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const IMPORT_OF = (mod: string) => new RegExp(`from\\s+["'](?:@/lib/ai/|\\./|\\.\\./ai/)${mod}["']`);

describe("izolasyon — durumu kim bilir", () => {
  const files = sourceFiles(SRC).map((p) => ({ rel: relative(ROOT, p).split("\\").join("/"), text: readFileSync(p, "utf8") }));

  it("anti-vakum: kaynak ağacı okundu", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.rel === "src/lib/ai/prompts.ts")).toBe(true);
  });

  it("🚨 conversation-state modülünü YALNIZ istem, tip, yükleyici ve anlama katmanının tek girişi içe aktarır", () => {
    // `kb-retrieve.ts` yalnız bayrağı okur (anlama katmanının tarih satırı; kapı DEĞİL — hiçbir karar vermez).
    const importers = files.filter((f) => IMPORT_OF("conversation-state").test(f.text)).map((f) => f.rel).sort();
    expect(importers).toEqual([
      "src/lib/ai/conversation-state-loader.ts",
      "src/lib/ai/kb-retrieve.ts",
      "src/lib/ai/prompts.ts",
      "src/lib/ai/types.ts",
    ]);
  });

  it("🚨 yükleyiciyi YALNIZ üç cevap yüzeyi çağırır (kanal, gelen kutusu önerisi, QR)", () => {
    const importers = files.filter((f) => IMPORT_OF("conversation-state-loader").test(f.text)).map((f) => f.rel).sort();
    expect(importers).toEqual([
      "src/app/api/chat/[token]/route.ts",
      "src/app/api/conversations/[id]/ai-suggest/route.ts",
      "src/lib/automation.ts",
    ]);
  });
});
