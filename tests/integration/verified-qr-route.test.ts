// ---------------------------------------------------------------------------
// QR MİSAFİR SOHBETİ — doğrulanmış müsaitlik / uzatma KOD metni (anahtar `AI_VERIFIED_QR_ENABLED`, VARSAYILAN KAPALI; kurucu yokken karar
// #3, `docs/KURUCU-YOKKEN-KARARLAR-2026-10-09.md`). Gerçek rota + gerçek PostgreSQL + gerçek QR kapısı; cevap modeli MOCK, anlama katmanı ve
// bekçi sahte fetch. Her "gitmez" iddiasının aynı tohumla "gider" kontrolü var.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});
const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/[token]/route";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { addNights, todayKey } from "@/modules/availability/core";

const TZ = "Europe/Istanbul";
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const TODAY = todayKey(new Date(), TZ);
const ARR = addNights(TODAY, -1);
const DEP = addNights(TODAY, 3);
const human = (k: string) => `${Number(k.slice(8, 10))} ${TR_MONTHS[Number(k.slice(5, 7)) - 1]}${k.slice(0, 4) === TODAY.slice(0, 4) ? "" : ` ${k.slice(0, 4)}`}`;
const EXT_CODE = `${human(DEP)} gecesi daire müsait. Konaklamanızı uzatmak için Airbnb uygulamasından rezervasyon değişikliği talebi gönderebilirsiniz; yeni tutarı Airbnb gösterir.`;
const F1 = addNights(TODAY, 20);
const F2 = addNights(F1, 2);
const AVAIL_CODE = `${human(F1)} giriş, ${human(F2)} çıkış için daire müsait.`;
const MODEL_DRAFT = "Bilgiyi ev sahibinize iletiyorum.";

let stay = { kind: "extend", intents: ["extend_stay"] };
// Modelin şema beyanı da konuya uymalı: kapı BÜTÜN katmanların türlerinin birleşimine bakar (beyan "extend" iken müsaitlik muaf olmaz).
const baseModel = (asked = "extend") => ({
  reply: MODEL_DRAFT,
  intent: "general",
  riskLevel: "low",
  riskType: null,
  confidence: 0.95,
  source: "openai",
  priority: "standard",
  usedSources: [],
  missingInfo: [],
  detectedLanguage: "tr",
  stayChange: { asked, stance: "defers" },
});
const asAvailability = () => {
  stay = { kind: "availability", intents: ["availability"] };
  guardKind = "availability";
  mockSuggest.mockResolvedValue(baseModel("availability"));
};
let guardKind = "extend";

function fakeFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const content =
      name === "stay_change_guard"
        ? JSON.stringify({
            guest_requests_change: guardKind !== "none",
            kind: guardKind,
            requested_checkin_time: null,
            requested_checkout_time: null,
            reply_states_calendar: true,
            reply_grants_change: false,
            reply_defers_to_host: false,
            reply_refuses: false,
            reply_price_terms: false,
            reply_amounts: [],
          })
        : JSON.stringify({
            language: "tr",
            requests: stay.intents.map((intent) => ({ intent, query_tr: "soru", query_original: "soru" })),
            stay_change: { requested: stay.kind !== "none", kind: stay.kind, checkin_time: null, checkout_time: null },
          });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
  });
}

async function seed(opts: { channel?: string } = {}) {
  const { propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  await prisma.calendarSource.create({
    data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics", lastStatus: "ok", lastSyncedAt: new Date(Date.now() - 3_600_000) },
  });
  await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ayşe Yılmaz",
      arrivalDate: new Date(`${ARR}T00:00:00Z`),
      departureDate: new Date(`${DEP}T00:00:00Z`),
      status: "confirmed",
      channel: opts.channel ?? "airbnb",
    },
  });
  return { propertyId, token };
}

let seq = 0;
const ask = (token: string, message: string) =>
  POST(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, requestId: `vq-${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );

const lastBotReply = async (propertyId: string) =>
  (await prisma.message.findFirst({ where: { direction: "outbound", conversation: { propertyId } }, orderBy: { createdAt: "desc" } }))?.body ?? null;

describe("QR — doğrulanmış müsaitlik / uzatma kod metni", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    vi.stubEnv("AI_VERIFIED_QR_ENABLED", "1");
    stay = { kind: "extend", intents: ["extend_stay"] };
    guardKind = "extend";
    vi.stubGlobal("fetch", fakeFetch());
    mockSuggest.mockResolvedValue(baseModel());
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 uzatma isteği + çıkış gecesi boş → KOD METNİ (müsait + talep yolu) gider", async () => {
    const s = await seed();
    expect((await ask(s.token, "Merhaba, bir gece daha kalabilir miyiz?")).status).toBe(200);
    expect(await lastBotReply(s.propertyId)).toBe(EXT_CODE);
    // Karar kaydı GÖNDERİLEN metni betimler (Haiku 10-09: atılan taslağın "availability_unconfirmed" vetosunu yazıyordu, gönderim
    // "auto_sent" iken) — gönderilen kod metni için konaklama vetosu kaydı YOK.
    const ev = await prisma.riskEvent.findFirstOrThrow({ where: { surface: "guest_chat" } });
    expect(ev.finalDecision).toBe("auto_sent");
    expect(JSON.parse(String(ev.kbEvidenceJson)).sc?.v ?? null).toBeNull();
  });

  it("KONTROL: QR anahtarı KAPALI → kod metni gitmez (kanal anahtarları açık olsa da)", async () => {
    vi.stubEnv("AI_VERIFIED_QR_ENABLED", "");
    vi.stubEnv("AI_VERIFIED_EXTENSION_ENABLED", "1");
    vi.stubEnv("AI_VERIFIED_AVAILABILITY_ENABLED", "1");
    const s = await seed();
    await ask(s.token, "Merhaba, bir gece daha kalabilir miyiz?");
    expect(await lastBotReply(s.propertyId)).not.toBe(EXT_CODE);
  });

  it("konaklamaya DEĞMEYEN müsaitlik sorusu → müsaitlik kod metni", async () => {
    asAvailability();
    const s = await seed();
    await ask(s.token, `Merhaba, ${human(F1)} ile ${human(F2)} arası daire müsait mi?`);
    expect(await lastBotReply(s.propertyId)).toBe(AVAIL_CODE);
  });

  it("🚨 çıkış gününden başlayan müsaitlik sorusu (bitişik = uzatma) → müsaitlik kod metni GİTMEZ", async () => {
    asAvailability();
    const s = await seed();
    await ask(s.token, `Merhaba, ${human(DEP)} ile ${human(addNights(DEP, 2))} arası daire müsait mi?`);
    const r = await lastBotReply(s.propertyId);
    expect(r ?? "").not.toMatch(/daire müsait/);
  });

  it("🚨 bekçi uzatma isteği görmüyor → gitmez", async () => {
    guardKind = "none";
    const s = await seed();
    await ask(s.token, "Merhaba, bir gece daha kalabilir miyiz?");
    expect(await lastBotReply(s.propertyId)).not.toBe(EXT_CODE);
  });

  it("🚨 rezervasyon Airbnb değil → uzatma kod metni gitmez", async () => {
    const s = await seed({ channel: "direct" });
    await ask(s.token, "Merhaba, bir gece daha kalabilir miyiz?");
    expect(await lastBotReply(s.propertyId)).not.toBe(EXT_CODE);
  });
});
