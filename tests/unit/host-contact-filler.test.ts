import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { stripHostContactFiller } from "@/lib/ai/host-contact-filler";
import { asksHypotheticalSituation, conditionalHostContactKind } from "@/lib/ai/absence";
import { autoReplyGateVerdict } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// R13-b / R13-c (kurucu kararı 10-28 gece, aynen `docs/INCELEME-2026-10-28-opus-ikinci-dilim.md` sonu): "zaten hostla yazışıyorlar …
// 'Bir sorun olursa ev sahibinize yazın.' … kesinlikle bu gidemesin" · "genel 'bir sorun olursa ev sahibinizi arayın/yazın' kapanışı hiç
// eklenmesin … Yalnız 'Anahtarı kaybedersem ne yapmalıyım?' gibi sorularda, geçerli talimat gerçekten ev sahibine ulaşmaksa kullanılabilsin …
// Gerekli güvenlik uyarıları korunsun. Misafir zaten sorunu bizim sohbetimize bildiriyorsa tekrar 'ev sahibine yazın' diye başından
// savrulmasın." Kurucunun tablosunun her satırı bire bir burada.
// ---------------------------------------------------------------------------

const KB = [
  "Anahtarı kaybederseniz ev sahibinizi arayın; yedek anahtar resepsiyonda.",
  "Otopark binanın arkasında, ücretsizdir.",
  "Wi-Fi ağı Lale, şifre 12345678.",
];
const run = (guest: string, reply: string, kb: readonly string[] = KB) => stripHostContactFiller(reply, [guest], kb);

describe("kurucunun tablosu (R13-b) — yaşanan sorun bildirimine koşullu talimat: tutulur", () => {
  for (const [g, r] of [
    ["İnternet yok, bağlanamıyorum", "Bir sorun olursa ev sahibinize yazın."],
    ["Elektrik yok", "Bir sorun olursa ev sahibinizi arayın."],
    ["Su yok", "Bir sorun olursa ev sahibinize yazın."],
    ["Isıtma yok", "Bir sorun olursa ev sahibinizi arayın."],
    ["İnternet kesildi", "Bir sorun olursa ev sahibinize yazın."],
    ["TV açılmıyor", "Bir sorun olursa ev sahibinizi arayıp bilgi verebilirsiniz."],
  ] as const) {
    it(`"${g}" → "${r}" → tutulur, ev sahibi yanıtlar`, () => {
      const o = run(g, r);
      expect(o.hostContactOnly).toBe(true);
      expect(o.text).toBe(r);
      // Kapı (kanal + QR) işareti görünce tutar.
      const result = { intent: "general", riskLevel: "low", confidence: 0.95, source: "openai", reply: o.text, hostContactOnly: true as const };
      expect(autoReplyGateVerdict(result, g)).toEqual({ reason: "blocked", detail: "reply_host_contact_only" });
      expect(evaluateEscalation({ ...result, usedSources: [] }, g)).toEqual({ escalate: true, reason: "reply_host_contact_only" });
    });
  }

  it("'Wi-Fi'ye bağlanamıyorum' → şifre gider, 'ev sahibinize yazın' kuyruğu çıkar (şifre gerçek cevap — değişmez)", () => {
    const o = run("Wi-Fi'ye bağlanamıyorum", "Ağ adı Lale, şifre 12345678. Bir sorun olursa ev sahibinize yazın.");
    expect(o).toEqual({ text: "Ağ adı Lale, şifre 12345678.", hostContactOnly: false });
  });

  it("'Wi-Fi bozulursa ne yapmalıyım?' → 'Bozulursa ev sahibinize yazın.' GİTMEZ (kurucu: zaten hostla yazışıyorlar)", () => {
    expect(run("Wi-Fi bozulursa ne yapmalıyım?", "Wi-Fi bozulursa ev sahibinize yazın.").hostContactOnly).toBe(true);
    expect(run("What if the Wi-Fi stops working?", "If the Wi-Fi stops working, message your host.").hostContactOnly).toBe(true);
  });
});

describe("kurucunun tablosu (R13-c) — bilgi cevabına eklenen genel kapanış çıkar", () => {
  for (const [g, r, want] of [
    ["Otopark var mı?", "Evet, binanın arkasında ücretsiz otopark var. Bir sorun olursa ev sahibinizi arayın.", "Evet, binanın arkasında ücretsiz otopark var."],
    ["Otopark var mı?", "Otopark arkada. Bir sorun olursa ev sahibinizi arayıp bilgi verebilirsiniz.", "Otopark arkada."],
    ["Havuz kaçta açılıyor?", "Havuz 09:00'da açılır. Herhangi bir sorun olursa ev sahibinize ulaşabilirsiniz.", "Havuz 09:00'da açılır."],
    ["Is there parking?", "Yes, free parking behind the building.\nIf anything breaks, please contact your host.", "Yes, free parking behind the building."],
    ["Geç geleceğiz", "Sorun değil. Geç gelecekseniz ev sahibinize haber verin.", "Sorun değil."],
  ] as const) {
    it(`"${g}" → yalnız kapanış çıkar`, () => {
      expect(run(g, r)).toEqual({ text: want, hostContactOnly: false });
    });
  }

  it("selam + kapanıştan ibaret cevap → içerik yok → tutulur", () => {
    expect(run("Merhaba", "Merhaba! Bir sorun olursa ev sahibinizi arayın.").hostContactOnly).toBe(true);
  });
});

describe("korunanlar (aşırı uygulama yok)", () => {
  it("misafir TAM O durumu varsayımsal sordu + talimat bilgi tabanında → 'arayın' kalır", () => {
    const r = "Anahtarı kaybederseniz ev sahibinizi arayın.";
    expect(run("Anahtarı kaybedersem ne yapmalıyım?", r)).toEqual({ text: r, hostContactOnly: false });
  });

  it("aynı soru ama bilgi tabanında dayanak YOK → çıkar (kurucu: 'dayanağı varsa')", () => {
    expect(run("Anahtarı kaybedersem ne yapmalıyım?", "Anahtarı kaybederseniz ev sahibinizi arayın.", ["Otopark ücretsizdir."]).hostContactOnly).toBe(true);
    expect(run("Anahtarı kaybedersem ne yapmalıyım?", "Anahtarı kaybederseniz ev sahibinizi arayın.", []).hostContactOnly).toBe(true);
  });

  it("misafir anahtarı KAYBETTİ (yaşanan olay) → koşullu talimat çıkar, tutulur (savrulmasın)", () => {
    expect(run("Anahtarı kaybettim", "Anahtarı kaybederseniz ev sahibinizi arayın.").hostContactOnly).toBe(true);
  });

  it("başka bir durumu sordu → konu tutmaz → çıkar", () => {
    expect(run("Wi-Fi bozulursa ne yapmalıyım?", "Wi-Fi şifresi 12345678. Anahtarı kaybederseniz ev sahibinizi arayın.")).toEqual({
      text: "Wi-Fi şifresi 12345678.",
      hostContactOnly: false,
    });
  });

  it("güvenlik uyarısı (gaz / yangın / acil servis) korunur", () => {
    const r = "Evet, otopark var. Gaz kokusu alırsanız 112'yi arayın ve ev sahibinize ulaşın.";
    expect(run("Otopark var mı?", r)).toEqual({ text: r, hostContactOnly: false });
  });

  it("bilgi yönlendirmesi ('… için ev sahibinize sorabilirsiniz') SİLİNMEZ — 'bilgim yok' kuralı tutar (soru sessizce kaybolmasın)", () => {
    for (const r of ["Sauna için ev sahibinize sorabilirsiniz.", "Otopark var. Sauna için ev sahibinize sorabilirsiniz.", "Ev sahibinizi arayıp otoparkı sorabilirsiniz."]) {
      expect(run("Sauna var mı?", r), r).toEqual({ text: r, hostContactOnly: false });
    }
  });

  it("iletişim değeri veren / olumsuz / ev sahibine başvurmayan cümle değişmez", () => {
    for (const r of [
      "Ev sahibinize ulaşabilirsiniz, telefon: 0532 123 45 67.",
      "Ev sahibinize sormanıza gerek yok, şifre kartın arkasında.",
      "Otopark binanın arkasında, ücretsizdir.",
      "Ev sahibiniz sizi kapıda karşılayacak.",
      "",
    ]) {
      expect(run("Otopark var mı?", r), r).toEqual({ text: r, hostContactOnly: false });
    }
  });

  it("çok satırlı cevapta paragraf boşluğu ve madde işareti korunur", () => {
    const r = "Otopark arkada.\n\n- Havuz 09:00'da açılır.\n- Bir sorun olursa ev sahibinize yazın.";
    expect(run("Otopark ve havuz?", r)).toEqual({ text: "Otopark arkada.\n\n- Havuz 09:00'da açılır.", hostContactOnly: false });
  });
});

describe("yardımcılar", () => {
  it("conditionalHostContactKind: yaz / mesaj / haber → write · ara / ulaş → call · bilgi yönlendirmesi ve düz cümle → null", () => {
    expect(conditionalHostContactKind("Bir sorun olursa ev sahibinize yazın.")).toBe("write");
    expect(conditionalHostContactKind("If anything breaks, message your host.")).toBe("write");
    expect(conditionalHostContactKind("Geç gelecekseniz ev sahibinize haber verin.")).toBe("write");
    expect(conditionalHostContactKind("Bir sorun olursa ev sahibinizi arayın.")).toBe("call");
    expect(conditionalHostContactKind("Bir sorun olursa ev sahibinizi arayıp bilgi verebilirsiniz.")).toBe("call");
    expect(conditionalHostContactKind("If anything breaks, please contact your host.")).toBe("call");
    expect(conditionalHostContactKind("Sauna için ev sahibinize sorabilirsiniz.")).toBeNull();
    expect(conditionalHostContactKind("Otopark ücretsizdir.")).toBeNull();
  });

  it("asksHypotheticalSituation: koşul eki / bağlacı varsayımsaldır; yaşanan olay bildirimi değildir", () => {
    for (const t of ["Anahtarı kaybedersem ne yapmalıyım?", "Wi-Fi bozulursa ne yapalım?", "What if the Wi-Fi stops working?", "Elektrik kesilirse?"]) {
      expect(asksHypotheticalSituation(t), t).toBe(true);
    }
    for (const t of ["Anahtarı kaybettim", "Wi-Fi çalışmıyor", "The power is out", "Otopark var mı?"]) {
      expect(asksHypotheticalSituation(t), t).toBe(false);
    }
  });

  it("süre: uzun girdi doğrusal", () => {
    const t0 = performance.now();
    run("Otopark var mı?", "Otopark arkada. Bir sorun olursa ev sahibinizi arayın. ".repeat(2_000));
    run("Otopark var mı?", `${"a".repeat(50_000)} ev sahibinize yazın.`);
    run(`${"anahtarı kaybedersem ".repeat(3_000)}?`, "Anahtarı kaybederseniz ev sahibinizi arayın.");
    expect(performance.now() - t0).toBeLessThan(3_000);
  });
});

// ── BAĞLANTI: üretim cevap yolu (`suggestReply`) siliciyi gerçekten çağırıyor ve işareti taşıyor ──────────────────────────────────────
const input = (guestMessage: string): SuggestReplyInput => ({
  guestMessage,
  property: { name: "Lale Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "Galata", city: "İstanbul" },
  reservation: { guestName: "Ayşe", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
  knowledgeBase: [{ category: "general", title: "Otopark", content: "Otopark binanın arkasında, ücretsizdir." }],
  tone: "warm",
  language: "tr",
});
function openAiReturns(reply: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  intent: "parking",
                  confidence: 0.95,
                  reply,
                  risk: null,
                  priority: "standard",
                  actionSuggestion: null,
                  riskLevel: "none",
                  detectedLanguage: "tr",
                  riskType: null,
                  usedSources: ["kb:general"],
                  missingInfo: [],
                  statedCheckoutTime: null,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
}

describe("bağlantı — suggestReply", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("bilgi cevabındaki genel kapanış çıkar; işaret yok", async () => {
    openAiReturns("Otopark binanın arkasında, ücretsizdir. Bir sorun olursa ev sahibinizi arayın.");
    const r = await suggestReply(input("Otopark var mı?"));
    expect(r.reply).toBe("Otopark binanın arkasında, ücretsizdir.");
    expect(r.hostContactOnly).toBeUndefined();
  });

  it("yalnız kapanıştan ibaret cevap → metin aynen, işaret var → kapı tutar", async () => {
    openAiReturns("Bir sorun olursa ev sahibinize yazın.");
    const r = await suggestReply(input("Elektrik yok"));
    expect(r.hostContactOnly).toBe(true);
    expect(autoReplyGateVerdict(r, "Elektrik yok")?.detail).toBe("reply_host_contact_only");
  });
});
