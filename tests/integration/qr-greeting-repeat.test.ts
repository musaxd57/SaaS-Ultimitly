import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// SELAM TEKRARI (kurucu/Codex canlı gözlem, 09-08): asistan bilgiyi doğru
// kullanıyor ama HEMEN SONRAKİ cevapta yeniden "Merhaba" diyor.
//
// 🚨 KÖK NEDEN İKİ KATMANLI ve ikisi de modelin suçu DEĞİL:
//  1. `TONE_GUIDANCE.warm` KOŞULSUZ "Misafiri adıyla selamla" diyordu — model
//     her turda bu kurala uyuyordu, doğru davranıyordu.
//  2. Konuşma geçmişi isteme GİRİYOR ama "daha önce cevap verdin mi" bilgisi
//     hiçbir yerde SÖYLENMİYORDU. Modelden bunu geçmişe bakıp çıkarmasını
//     beklemek, tam da başarısız olan şey.
//
// ÇÖZÜM: KODDA hesapla, modele SÖYLE (CLAUDE.md'nin kendi gereksinimi:
// `conversationState` / `isFirstOperatorReply`). Model çıkarım yapmaz.
//
// 🚨 SAYIM PENCEREYE DEĞİL KONUŞMANIN TAMAMINA bakar: bağlam penceresi bir
// GÖSTERİM tavanıdır, gerçek kaynağı değil. Uzun sohbette ilk cevap pencerenin
// dışına düşerse "ilk cevap" sanıp yeniden selamlardık.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});

const mockSuggest = vi.fn();
vi.mock("@/lib/ai", () => ({ suggestReply: (...a: unknown[]) => mockSuggest(...a) }));

import { NextRequest } from "next/server";
import { POST as CHAT } from "@/app/api/chat/[token]/route";
import { buildGuestChatContextWindow, ensureGuestChatConversation } from "@/lib/guest-chat";
import { buildReplyUserPrompt } from "@/lib/ai/prompts";
import type { SuggestReplyInput } from "@/lib/ai/types";

const DAY = 86_400_000;

function reply(over: Record<string, unknown> = {}) {
  return {
    reply: "Otopark bina altındadır.",
    intent: "parking",
    riskLevel: "none",
    riskType: null,
    confidence: 0.9,
    source: "openai",
    priority: "standard",
    risk: null,
    actionSuggestion: null,
    detectedLanguage: "tr",
    usedSources: ["kb:parking"],
    sourceAudit: { declared: 1, verified: 1 },
    missingInfo: [],
    statedCheckoutTime: null,
    ...over,
  };
}

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const token = `qrtok_${Math.random().toString(36).slice(2)}${"x".repeat(12)}`;
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatEnabled: true, chatToken: token, checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const res = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Test Misafir",
      arrivalDate: new Date(Date.now() - DAY),
      departureDate: new Date(Date.now() + 2 * DAY),
      status: "confirmed",
      channel: "manual",
      currency: "EUR",
    },
  });
  await prisma.knowledgeBaseItem.create({
    data: {
      propertyId,
      category: "parking",
      title: "Otopark",
      content: "Bina altı otopark ücretsizdir.",
      isActive: true,
      source: "host_manual",
      reviewState: "approved",
      approvedAt: new Date(),
    },
  });
  return { orgId, propertyId, token, reservationId: res.id };
}

let seq = 0;
function ask(token: string, message: string, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return CHAT(
    new NextRequest(`http://localhost/api/chat/${token}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, requestId: `g${++seq}-${Math.random().toString(36).slice(2)}` }),
    }),
    { params: Promise.resolve({ token }) },
  );
}
const cookieOf = (r: Response) => r.headers.get("set-cookie")?.split(";")[0] ?? undefined;

function inputFor(isFirst: boolean): SuggestReplyInput {
  return {
    guestMessage: "Otopark var mı?",
    property: { name: "Daire", checkInTime: "15:00", checkOutTime: "11:00" },
    knowledgeBase: [],
    reservation: null,
    history: [],
    tone: "warm",
    language: "tr",
    conversationState: { isFirstOperatorReply: isFirst },
  };
}

describe("selam tekrarı — kodda hesaplanır, modele söylenir", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  // --- istem: kural GERÇEKTEN yazılıyor mu -------------------------------

  it("İLK cevapta selam YASAĞI YOK (ilk temas selamlanmalı)", () => {
    const p = buildReplyUserPrompt(inputFor(true));
    expect(p).not.toMatch(/YENİDEN SELAMLAMA/);
  });

  it("SONRAKİ cevapta istem AÇIKÇA 'yeniden selamlama' der", () => {
    const p = buildReplyUserPrompt(inputFor(false));
    expect(p).toMatch(/YENİDEN SELAMLAMA/);
    // Modelin geçmişe bakıp çıkarmasını BEKLEMİYORUZ — kural açık cümle.
    expect(p).toMatch(/daha önce.*cevap ver/i);
  });

  it("bilinmiyorsa (alan verilmediyse) kural EKLENMEZ — uydurma kısıt yok", () => {
    const withoutState = { ...inputFor(false) };
    delete withoutState.conversationState;
    const p = buildReplyUserPrompt(withoutState);
    expect(p).not.toMatch(/YENİDEN SELAMLAMA/);
  });

  it("SICAK TON'un selamlama kuralı artık KOŞULLU (ilk cevap)", () => {
    const p = buildReplyUserPrompt(inputFor(false));
    // Eskiden koşulsuz "Misafiri adıyla selamla" vardı ve modele her turda
    // selamlamayı emrediyordu — kuralların kendisi çelişiyordu.
    expect(p).not.toMatch(/^\s*- Misafiri adıyla selamla/m);
    expect(p).toMatch(/İLK cevabında misafiri adıyla selamla/);
  });

  // --- pencere: sayım KONUŞMANIN TAMAMINA bakar --------------------------

  it("hiç cevap yokken ilk cevap sayılır", async () => {
    const { propertyId, reservationId } = await seed();
    const convId = await ensureGuestChatConversation(propertyId, { id: reservationId, guestName: "Misafir" });
    await prisma.message.create({
      data: { conversation: { connect: { id: convId } }, direction: "inbound", senderName: "Misafir", body: "Merhaba" },
    });
    const w = await buildGuestChatContextWindow(convId);
    expect(w.hasPriorOperatorReply).toBe(false);
  });

  it("PENCERE DIŞINDA kalan eski bir cevap da SAYILIR (tavan gerçek kaynak değil)", async () => {
    const { propertyId, reservationId } = await seed();
    const convId = await ensureGuestChatConversation(propertyId, { id: reservationId, guestName: "Misafir" });
    // En eski satır: bizim cevabımız. Ardından pencereyi dolduracak kadar mesaj.
    await prisma.message.create({
      data: { conversation: { connect: { id: convId } }, direction: "outbound", senderName: "GuestOps AI", body: "Merhaba, hoş geldiniz." },
    });
    for (let i = 0; i < 30; i++) {
      await prisma.message.create({
        data: { conversation: { connect: { id: convId } }, direction: "inbound", senderName: "Misafir", body: `soru ${i}` },
      });
    }
    const w = await buildGuestChatContextWindow(convId);
    // Pencere kapasitesi 24 mesaj → ilk cevap penceredeN DÜŞTÜ...
    expect(w.history.some((h) => h.body.includes("hoş geldiniz"))).toBe(false);
    // ...ama "daha önce cevap verdik" gerçeği KAYBOLMADI.
    expect(w.hasPriorOperatorReply).toBe(true);
  });

  it("SİSTEM OLAYI ve boş gövde cevap sayılmaz", async () => {
    const { propertyId, reservationId } = await seed();
    const convId = await ensureGuestChatConversation(propertyId, { id: reservationId, guestName: "Misafir" });
    await prisma.message.create({
      data: {
        conversation: { connect: { id: convId } },
        direction: "outbound",
        senderName: "sistem",
        body: "",
        systemEventType: "guest_chat_ai_resumed",
      },
    });
    const w = await buildGuestChatContextWindow(convId);
    expect(w.hasPriorOperatorReply).toBe(false);
  });

  // --- uçtan uca: QR rotası doğru değeri GEÇİRİYOR mu --------------------

  it("QR: ilk soruda isFirstOperatorReply TRUE, ikincisinde FALSE", async () => {
    const { token } = await seed();
    mockSuggest.mockResolvedValue(reply());

    const r1 = await ask(token, "Otopark var mı?");
    const cookie = cookieOf(r1);
    const first = mockSuggest.mock.calls[0][0] as SuggestReplyInput;
    expect(first.conversationState?.isFirstOperatorReply).toBe(true);

    await ask(token, "Çöp nereye atılıyor?", cookie);
    const second = mockSuggest.mock.calls[1][0] as SuggestReplyInput;
    // 🚨 CANLI KUSUR TAM BURADAYDI: ikinci turda da model "ilk temas" sanıyordu.
    expect(second.conversationState?.isFirstOperatorReply).toBe(false);
  });
});
