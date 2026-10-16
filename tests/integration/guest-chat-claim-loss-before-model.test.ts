import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SuggestReplyResult } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// QR SAHİPLİK KAYBI İLK ÜCRETLİ ÇAĞRIDAN ÖNCE (kurucu 10-16: "yalnız işin sonunda sahiplik kontrolüyle yetinme"; yaşayan mutant Q1).
// Bilgi tabanı seçimi (ilk model çağrısından önceki adım) sürerken kilit başka işçiye geçer → ilk ücretli çağrıdan hemen önceki eşzamanlı
// yenileme bunu görür: model HİÇ çağrılmaz, kayıt yazılmaz. Modülü saran taklit dosya geneline etki eder → AYRI dosya.
// ---------------------------------------------------------------------------

// Kancalar: adım ÇALIŞIRKEN kilit başka işçiye geçer (eski işçi hâlâ çalışıyor). Sayaçlar ücretli / kota adımlarının yapılıp yapılmadığını sayar.
const { hook, counts } = vi.hoisted(() => ({
  hook: { retrieve: null as null | (() => Promise<void>), limits: null as null | (() => Promise<void>), budget: null as null | (() => Promise<void>) },
  counts: { retrieve: 0, budget: 0 },
}));
const runHook = async (k: "retrieve" | "limits" | "budget") => {
  const fn = hook[k];
  hook[k] = null;
  if (fn) await fn();
};
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
vi.mock("@/lib/ai/kb-retrieve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/kb-retrieve")>();
  return {
    ...actual,
    retrieveKbForPrompt: async (...args: Parameters<typeof actual.retrieveKbForPrompt>) => {
      counts.retrieve++;
      await runHook("retrieve");
      return actual.retrieveKbForPrompt(...args);
    },
  };
});
vi.mock("@/lib/billing/plan-limits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/plan-limits")>();
  return {
    ...actual,
    limitsForOrg: async (...args: Parameters<typeof actual.limitsForOrg>) => {
      await runHook("limits");
      return actual.limitsForOrg(...args);
    },
  };
});
vi.mock("@/lib/ai/daily-budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/daily-budget")>();
  return {
    ...actual,
    consumeDailyAiBudgetForQr: async (...args: Parameters<typeof actual.consumeDailyAiBudgetForQr>) => {
      counts.budget++;
      const out = await actual.consumeDailyAiBudgetForQr(...args);
      await runHook("budget");
      return out;
    },
  };
});

import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/chat/[token]/route";

const mockSuggest = vi.mocked(suggestReply);
const RID = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";
const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;

function result(): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.9,
    reply: "Çöp salı günü toplanır.",
    risk: null,
    priority: "standard",
    source: "openai",
    actionSuggestion: null,
    riskLevel: "none",
    detectedLanguage: "tr",
    riskType: null,
    usedSources: [],
    missingInfo: [],
    statedCheckoutTime: null,
  };
}

function call(token: string, message: string, requestId?: string) {
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
    body: JSON.stringify({ message, ...(requestId ? { requestId } : {}) }),
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

async function enableChat(propertyId: string): Promise<string> {
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  await prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
  });
  return token;
}

describe("QR — sahiplik kaybı ilk ücretli çağrıdan önce", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    mockSuggest.mockReset();
    mockSuggest.mockResolvedValue(result());
    hook.retrieve = hook.limits = hook.budget = null;
    counts.retrieve = counts.budget = 0;
    process.env.GUEST_CHAT_ENABLED = "1";
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
    else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });

  it("KONTROL: kilit elde kalınca aynı yol modeli bir kez çağırır ve kaydı yazar (kanca boş)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const res = await call(token, "Çöp ne zaman alınıyor?", RID);
    expect(res.status).toBe(200);
    expect((await res.json()).deduped).toBeFalsy();
    expect(mockSuggest).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { body: "Çöp ne zaman alınıyor?" } })).toBe(1);
  });

  const steal = (name: string) => async () => {
    expect(await prisma.systemLock.count({ where: { name } })).toBe(1); // kanca gerçekten talep SONRASI
    await prisma.systemLock.deleteMany({ where: { name } });
    await prisma.systemLock.create({ data: { name, lockedUntil: new Date(Date.now() + 120_000), holder: "baska.isci" } });
  };

  it("🚨 kota adımından ÖNCE kilit başka işçiye geçti → kota DÜŞÜLMEZ, getirme ve model YOK (Opus N4)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    hook.limits = steal(`outbound-send:qr-in:${reservation.id}:${RID}`);
    const res = await call(token, "Çöp ne zaman alınıyor?", RID);
    expect((await res.json()).deduped).toBe(true);
    expect(counts.budget).toBe(0); // ⬅️ KOTA ÖNCESİ KONTROL YOKSA: 1 (eski işçi kotadan düşerdi)
    expect(counts.retrieve).toBe(0);
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("🚨 kota düşüldükten sonra, getirmeden ÖNCE kilit kaybı → getirme katmanının ücretli çağrıları YAPILMAZ (Opus N4)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    hook.budget = steal(`outbound-send:qr-in:${reservation.id}:${RID}`);
    const res = await call(token, "Çöp ne zaman alınıyor?", RID);
    expect((await res.json()).deduped).toBe(true);
    expect(counts.budget).toBe(1);
    expect(counts.retrieve).toBe(0); // ⬅️ GETİRME ÖNCESİ KONTROL YOKSA: 1
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it("🚨 bilgi tabanı seçimi sırasında kilit başka işçiye geçti → model HİÇ çağrılmaz, kayıt yok, cevap 'deduped'", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);
    const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
    const name = `outbound-send:qr-in:${reservation.id}:${RID}`;
    hook.retrieve = async () => {
      // Kanca gerçekten talep SONRASI koşuyor: kendi kilidimiz o an yerinde olmalı (yoksa test boşa geçer).
      expect(await prisma.systemLock.count({ where: { name } })).toBe(1);
      await prisma.systemLock.deleteMany({ where: { name } });
      await prisma.systemLock.create({ data: { name, lockedUntil: new Date(Date.now() + 120_000), holder: "baska.isci" } });
    };
    const res = await call(token, "Çöp ne zaman alınıyor?", RID);
    expect(res.status).toBe(200);
    expect((await res.json()).deduped).toBe(true);
    expect(hook.retrieve).toBeNull(); // kanca koştu
    expect(mockSuggest).not.toHaveBeenCalled(); // ⬅️ YENİLEMESİZ: ücretli çağrı yapılır, kayıtta düşerdi
    expect(await prisma.message.count({ where: { body: "Çöp ne zaman alınıyor?" } })).toBe(0);
    // Başka işçinin kilidine dokunulmaz.
    expect((await prisma.systemLock.findUniqueOrThrow({ where: { name } })).holder).toBe("baska.isci");
  });
});
