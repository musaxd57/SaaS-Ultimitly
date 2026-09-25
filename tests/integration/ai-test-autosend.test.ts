import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// /api/ai/test AUTO-SEND preview parity: when the REAL production gate says a
// reply would auto-send, the preview must include the machine-note exactly like
// the real outgoing body (reply → note → signature). A draft (gate says no)
// must stay note-free. The model is mocked to an "openai"-sourced result —
// the gate never passes the fallback source, so this can't be tested offline
// otherwise.

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));

import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/ai/test/route";
import { automatedReplyNote } from "@/lib/automation";

const mockSuggest = vi.mocked(suggestReply);
// 🚨 KAYNAKTAN TÜRETİLİR, ELLE YAZILMAZ (08-08). Buraya cümle SABİTLENMİŞTİ
// ve dipnot metni düzeltilince (eski hâli tutulamayacak bir söz veriyordu:
// "bir hata olursa ekibimiz hemen düzeltir" — öyle bir mekanizma YOK) bu
// dosyalar kırmızıya döndü. Testin ASIL değişmezi metnin kendisi değil,
// "dipnot OTO-gönderilen gövdeye eklenir, taslağa EKLENMEZ" paritesidir;
// literal pin o değişmezi korumadan kopyayı DONDURUYORDU.
const AUTO_NOTE_TR = automatedReplyNote("tr", true)!;
// ⚠️ TÜRETİLMİŞ PİNİN TUZAĞI: dipnot bir gün boş string dönerse `toContain("")`
// DAİMA geçer ve bu dosyadaki her dipnot iddiası sessizce anlamsızlaşır.
// Bu satır tam olarak o hâli yakalar.
if (!AUTO_NOTE_TR || AUTO_NOTE_TR.length < 10) {
  throw new Error("automatedReplyNote boş/çok kısa döndü — dipnot iddiaları vacuous olurdu");
}

const SAFE_WIFI = {
  intent: "wifi",
  confidence: 0.9,
  reply: "Wi-Fi ağımız LALEBUTİK, şifresi Lale2025.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
};

const req = (message: string) =>
  new NextRequest("http://localhost/api/ai/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
const ctx = { params: Promise.resolve({}) };

let n = 0;
async function seed(opts: { disclosure?: boolean } = {}) {
  const { orgId } = await makeOrgWithProperty();
  await prisma.organization.update({
    where: { id: orgId },
    data: { aiSignature: "Sevgiler,\nMusa", ...(opts.disclosure === false ? { autoReplyDisclosure: false } : {}) },
  });
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: `a${++n}@x.com`, passwordHash: "x", role: "owner" },
  });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
});

describe("POST /api/ai/test — auto-send verdict + note parity", () => {
  it("gate-clean reply → wouldAutoSend true and the preview carries note ABOVE signature (real outgoing order)", async () => {
    await seed();
    mockSuggest.mockResolvedValue(SAFE_WIFI);
    const json = await (await POST(req("Merhaba, wifi şifresi nedir?"), ctx)).json();
    expect(json.wouldAutoSend).toBe(true);
    expect(json.reply).toContain(AUTO_NOTE_TR);
    expect(json.reply.indexOf(AUTO_NOTE_TR)).toBeGreaterThan(json.reply.indexOf("Lale2025")); // note after reply
    expect(json.reply.endsWith("Sevgiler,\nMusa")).toBe(true); //                                signature last
  });

  it("disclosure OFF → auto-send preview has signature but NO note", async () => {
    await seed({ disclosure: false });
    mockSuggest.mockResolvedValue(SAFE_WIFI);
    const json = await (await POST(req("Merhaba, wifi şifresi nedir?"), ctx)).json();
    expect(json.wouldAutoSend).toBe(true);
    expect(json.reply).not.toContain(AUTO_NOTE_TR);
    expect(json.reply.endsWith("Sevgiler,\nMusa")).toBe(true);
  });

  it("🚨 PARİTE: yokluk itirafı → wouldAutoSend FALSE (kart gerçek göndericiyi YANSITMALI)", async () => {
    // Bu rota kapıyı ÇAĞIRIYORDU ama `reply` alanını VERMİYORDU (alan opsiyonel →
    // ne derleme ne test uyarıyordu). Sonuç ÖLÇÜLDÜ: gerçek gönderici bu cevabı
    // BLOKLARKEN kart "kendiliğinden gönderilirdi" diyordu. Rotanın kendi yorumu
    // "the exact production gate" diyor — bu satır o iddiayı sınar.
    await seed();
    mockSuggest.mockResolvedValue({
      ...SAFE_WIFI,
      intent: "general",
      reply: "Bu konuda kayıtlı bilgim yok; ev sahibiniz yardımcı olabilir.",
    });
    const json = await (await POST(req("Otopark var mı?"), ctx)).json();
    expect(json.wouldAutoSend).toBe(false);
  });

  it("🚨 PARİTE: saat kaynağı çelişkisi (P4-b kodda, 09-25) → wouldAutoSend FALSE; çelişkisiz aynı cevap TRUE", async () => {
    // Kart kapıya alanları TEK TEK veriyor: `timeConflicts` verilmezse gerçek gönderici tutarken kart "gönderilirdi"
    // derdi (`reply` dersinin aynısı). Kontrol satırı aynı cevabın çelişkisiz geçtiğini gösterir (vakum değil).
    await seed();
    const checkin = { ...SAFE_WIFI, intent: "checkin", reply: "Giriş saatiniz 13:00'tür." };
    mockSuggest.mockResolvedValue({ ...checkin, timeConflicts: [] });
    expect((await (await POST(req("Giriş saati kaçta?"), ctx)).json()).wouldAutoSend).toBe(true);
    mockSuggest.mockResolvedValue({ ...checkin, timeConflicts: [{ field: "checkInTime", propertyValue: "13:00", kbValues: ["14:00"] }] });
    expect((await (await POST(req("Giriş saati kaçta?"), ctx)).json()).wouldAutoSend).toBe(false);
  });

  it("🚨 PARİTE: misafirin dilinde olmayan cevap (09-25) → wouldAutoSend FALSE; aynı içerik misafirin dilinde TRUE", async () => {
    // Kart gerçek kapıyı çağırır: dil kontrolü misafirin mesajı + `reply` ile koşar (ek alan gerekmez) — kart
    // "gönderilirdi" derken gerçek gönderici tutmasın. Kontrol satırı aynı cevabın doğru dilde geçtiğini gösterir.
    await seed();
    mockSuggest.mockResolvedValue({ ...SAFE_WIFI, reply: "The Wi-Fi network is LALEBUTIK and the password is Lale2025." });
    expect((await (await POST(req("Hi, what is the wifi password?"), ctx)).json()).wouldAutoSend).toBe(true);
    mockSuggest.mockResolvedValue({ ...SAFE_WIFI, reply: "Wi-Fi ağımız LALEBUTİK, şifresi Lale2025. İyi günler dileriz, bir şey olursa yazın." });
    expect((await (await POST(req("Hi, what is the wifi password?"), ctx)).json()).wouldAutoSend).toBe(false);
  });

  it("dipnot dili gerçek göndericiyle aynı kuraldan: model 'tr' beyan etse de İngilizce misafire İngilizce dipnot (09-25)", async () => {
    await seed();
    mockSuggest.mockResolvedValue({ ...SAFE_WIFI, detectedLanguage: "tr", reply: "The Wi-Fi network is LALEBUTIK and the password is Lale2025." });
    const json = await (await POST(req("Hi, what is the wifi password?"), ctx)).json();
    expect(json.wouldAutoSend).toBe(true);
    expect(json.reply).toContain(automatedReplyNote("en", true)!);
    expect(json.reply).not.toContain(AUTO_NOTE_TR);
  });

  it("🚨 TASLAK = EV SAHİBİNİN SESİ (09-25): gönderilmeyecek cevapta devir kalıbı ev sahibinin ağzından; gönderilecek cevap AYNEN", async () => {
    await seed();
    // Tutulan cevap (iade niyeti kapıda durur): kalıp çevrilir.
    mockSuggest.mockResolvedValue({ ...SAFE_WIFI, intent: "refund", reply: "Anlıyorum. Mesajınız kaydedildi; ev sahibiniz görebilir." });
    const held = await (await POST(req("Kısmi iade istiyorum."), ctx)).json();
    expect(held.wouldAutoSend).toBe(false);
    expect(held.reply.startsWith("Anlıyorum. Mesajınızı aldım; kontrol edip size dönüş yapacağım.")).toBe(true);
    expect(held.reply).not.toContain("ev sahibiniz görebilir");
    // Otomatik gidecek cevap: misafire giden metnin birebir önizlemesi — çevrilmez.
    mockSuggest.mockResolvedValue({ ...SAFE_WIFI, reply: "Wi-Fi şifresi kartta. Mesajınız kaydedildi; ev sahibiniz görebilir." });
    const auto = await (await POST(req("Merhaba, wifi şifresi nedir?"), ctx)).json();
    expect(auto.wouldAutoSend).toBe(true);
    expect(auto.reply.startsWith("Wi-Fi şifresi kartta. Mesajınız kaydedildi; ev sahibiniz görebilir.")).toBe(true);
  });

  it("gate-blocked reply (refund) → wouldAutoSend false and the DRAFT stays note-free", async () => {
    await seed();
    mockSuggest.mockResolvedValue({ ...SAFE_WIFI, intent: "refund", reply: "İade talebinizi yöneticimize ilettim." });
    const json = await (await POST(req("Kısmi iade istiyorum."), ctx)).json();
    expect(json.wouldAutoSend).toBe(false); // blocklist intent — the gate never lets refunds out
    expect(json.reply).not.toContain(AUTO_NOTE_TR); // manual/approval draft never carries the note
    expect(json.reply.endsWith("Sevgiler,\nMusa")).toBe(true);
  });

  it("🚨 PARİTE: anlama katmanının risk niyeti önizlemeye ULAŞIR (katman açık → gönderilmezdi; eski `AI_INTENT_POLICY` okunmaz)", async () => {
    // Kelime ağının KAÇIRDIĞI insan talebi (ölçüldü). Katman ağ çağrısı sahte; kapı gerçek.
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      language: "tr",
                      requests: [{ intent: "human_request", query_tr: "ev sahibiyle görüşme", query_original: "ev sahibiyle görüşme" }],
                      stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null },
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    try {
      await seed();
      const answer = { ...SAFE_WIFI, intent: "general", reply: "Size nasıl yardımcı olabilirim?" };
      mockSuggest.mockResolvedValue(answer);
      // KONTROL: katman kapalı → kelime ağı bu insan talebini görmüyor, gönderilirdi.
      const off = await (await POST(req("Ev sahibiyle bizzat konuşabilir miyim?"), ctx)).json();
      expect(off.wouldAutoSend).toBe(true);
      // Katman açık: risk niyeti silinemez (birleşim değişmezi) — eski gölge anahtarı yazılı olsa da.
      vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
      vi.stubEnv("AI_INTENT_POLICY", "shadow");
      const on = await (await POST(req("Ev sahibiyle bizzat konuşabilir miyim?"), ctx)).json();
      expect(on.wouldAutoSend).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
