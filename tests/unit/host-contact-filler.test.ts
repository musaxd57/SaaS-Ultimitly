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
// Eski imza karşılaştırmaları (metin + işaret); çıkarılan parçaların kaydı `host-contact-ban.test.ts`te sınanır.
const run = (guest: string, reply: string, kb: readonly string[] = KB) => {
  const { text, hostContactOnly } = stripHostContactFiller(reply, [guest], kb);
  return { text, hostContactOnly };
};

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
  it("🚨 K-1029-C (kurucu 10-29 gece: 'ek / koşul eki sezgileri karar vermesin'): varsayımsal soru + dayanaklı 'arayın' artık KALMAZ — soru ev sahibine açık kalır (model sinyali ölçülene kadar; kurucu sorusu F1)", () => {
    // Önce: koşul eki ("-rsem") misafirin varsayımsal sorduğunu söylüyor, cümle misafire gidiyordu.
    const r = "Anahtarı kaybederseniz ev sahibinizi arayın.";
    expect(run("Anahtarı kaybedersem ne yapmalıyım?", r)).toEqual({ text: r, hostContactOnly: true });
  });

  it("aynı soru ama bilgi tabanında dayanak YOK → çıkar (kurucu: 'dayanağı varsa')", () => {
    expect(run("Anahtarı kaybedersem ne yapmalıyım?", "Anahtarı kaybederseniz ev sahibinizi arayın.", ["Otopark ücretsizdir."]).hostContactOnly).toBe(true);
    expect(run("Anahtarı kaybedersem ne yapmalıyım?", "Anahtarı kaybederseniz ev sahibinizi arayın.", []).hostContactOnly).toBe(true);
  });

  it("misafir anahtarı KAYBETTİ (yaşanan olay) → koşullu talimat çıkar, tutulur (savrulmasın)", () => {
    expect(run("Anahtarı kaybettim", "Anahtarı kaybederseniz ev sahibinizi arayın.").hostContactOnly).toBe(true);
  });

  it("🚨 K-1029-A (GD1 yeniden, kurucu 10-29 gece): sorulan durumun 'ev sahibinize yazın' cevabı SİLİNİR, doğru cevap gider — o soru 'cevaplandı' değil AÇIK kalır (çıkarılan parçanın kaydı + `host-contact-settle`)", () => {
    // Önce (GD1): bütün cevap tutuluyordu, otopark cevabı da gitmiyordu.
    const r = "Otopark arkada. Wi-Fi bozulursa ev sahibinize yazın.";
    expect(run("Otopark var mı? Wi-Fi bozulursa ne yapmalıyım?", r)).toEqual({ text: "Otopark arkada.", hostContactOnly: false });
    const removed = stripHostContactFiller(r, ["Otopark var mı? Wi-Fi bozulursa ne yapmalıyım?"], KB).removals;
    expect(removed).toHaveLength(1);
    expect(removed[0].generic).toBe(false); // konulu: Wi-Fi isteğinin sahibi bulunur
    const c = "Otopark arkada. Anahtarı kaybederseniz ev sahibinizi arayın.";
    expect(run("Otopark var mı? Anahtarı kaybedersem ne yapmalıyım?", c, ["Otopark ücretsizdir."])).toEqual({ text: "Otopark arkada.", hostContactOnly: false });
    // Kontrol: sorulmayan durumun genel kapanışı yine çıkar, cevap gider.
    expect(run("Otopark var mı?", "Otopark arkada. Wi-Fi bozulursa ev sahibinize yazın.")).toEqual({ text: "Otopark arkada.", hostContactOnly: false });
  });

  it("🚨 K-1029-B (GD5, kurucu 10-29 gece: 'yalnız talimat yan cümlesi silinir, bilgi gider' — geçici): bilgi yan cümlesi kalır, ilk koşul / talimat yan cümlesinden sonrası çıkar", () => {
    // Önce (GD5): bütün cevap tutuluyordu.
    for (const [g, r, want] of [
      ["Havlu nerede? Otopark var mı?", "Havlular yatak odasındaki dolapta, bir sorun olursa ev sahibinize yazın. Otopark binanın arkasında.", "Havlular yatak odasındaki dolapta. Otopark binanın arkasında."],
      ["Klima nasıl açılır? Otopark?", "Kumanda komodinin üstünde, çalışmazsa ev sahibinizi arayın. Otopark arkada.", "Kumanda komodinin üstünde. Otopark arkada."],
      ["Havlu nerede? Otopark?", "Havlular dolapta ve bir sorun olursa ev sahibinize yazın. Otopark arkada.", "Havlular dolapta. Otopark arkada."],
      ["Where are the towels? Parking?", "Towels are in the wardrobe; if anything breaks, contact your host. Parking is behind the building.", "Towels are in the wardrobe. Parking is behind the building."],
      // Yalnız sayı taşıyan bilgi yan cümlesi de bilgidir (mutasyon G5b).
      ["Kapı kodu ne? Otopark?", "Otopark arkada. Kod 4821, bir sorun olursa ev sahibinize yazın.", "Otopark arkada. Kod 4821."],
    ] as const) {
      expect(run(g, r)).toEqual({ text: want, hostContactOnly: false });
    }
    // Kontrol (aşırı uygulama yok): koşul yan cümlesi + talimattan ibaret cümle yine çıkar, cevap gider.
    for (const [g, r, want] of [
      ["Otopark var mı?", "Otopark arkada. Bir sorun olursa, ev sahibinize yazın.", "Otopark arkada."],
      ["Is there parking?", "Parking is behind the building. If anything breaks, please contact your host.", "Parking is behind the building."],
      ["Otopark var mı?", "Otopark arkada. Konaklamanız boyunca bir sorun yaşarsanız, ev sahibinize yazın.", "Otopark arkada."],
      // Genel "konaklamanız boyunca / during your stay" yan cümlesi bilgi değildir (mutasyon G5c).
      ["Is there parking?", "Parking is behind the building. During your stay, if anything breaks, contact your host.", "Parking is behind the building."],
      // Selam / teşekkür yan cümlesi bilgi değildir (mutasyon G5g).
      ["Otopark var mı?", "Otopark arkada. Teşekkürler, bir sorun olursa ev sahibinize yazın.", "Otopark arkada."],
    ] as const) {
      expect(run(g, r)).toEqual({ text: want, hostContactOnly: false });
    }
  });

  it("başka bir durumu sordu → konu tutmaz → çıkar", () => {
    expect(run("Wi-Fi bozulursa ne yapmalıyım?", "Wi-Fi şifresi 12345678. Anahtarı kaybederseniz ev sahibinizi arayın.")).toEqual({
      text: "Wi-Fi şifresi 12345678.",
      hostContactOnly: false,
    });
  });

  it("güvenlik uyarısı (yangın / gaz / acil servis) korunur — koşullu 'arayın' sınıfında olsa da", () => {
    const r = "Otopark arkada. Yangın olursa 112'yi ve ev sahibinizi arayın.";
    expect(conditionalHostContactKind("Yangın olursa 112'yi ve ev sahibinizi arayın.")).toBe("call");
    expect(run("Otopark var mı?", r)).toEqual({ text: r, hostContactOnly: false });
    // Gaz cümlesi bugün zaten bilgi yönlendirmesi sayılıyor (koşullu sınıfa girmez) — silinmez, kapı karar verir.
    const g = "Evet, otopark var. Gaz kokusu alırsanız 112'yi arayın ve ev sahibinize ulaşın.";
    expect(run("Otopark var mı?", g)).toEqual({ text: g, hostContactOnly: false });
    // Güvenlik sözcüğü olmayan genel "acil durumda arayın" kapanışı genel kapanıştır → çıkar.
    expect(run("Otopark var mı?", "Otopark arkada. Acil bir durumda ev sahibinizi arayın.")).toEqual({ text: "Otopark arkada.", hostContactOnly: false });
  });

  it("🚨 GD9 (gece döngüsü 10-29): tehlike sözcüğüne BENZEYEN ad güvenlik uyarısı sayılmaz (gazete / gazino / Gaziantep / polisaj / karbonat)", () => {
    for (const s of [
      "Gazino tarafında bir sorun olursa ev sahibinizi arayın.",
      "Gaziantep'ten gelirken sorun olursa ev sahibinizi arayın.",
      "Polisaj makinesi bozulursa ev sahibinizi arayın.",
      "Karbonat bitince bir sorun olursa ev sahibinizi arayın.",
      "Polisiye kitaplarla ilgili bir sorun olursa ev sahibinizi arayın.",
    ]) {
      expect(run("Otopark var mı?", `Otopark arkada. ${s}`), s).toEqual({ text: "Otopark arkada.", hostContactOnly: false });
    }
    // Kontrol: gerçek tehlike sözcüğü çekimleriyle korunur.
    for (const s of ["Gaz kokusu olursa ev sahibinizi arayın.", "Gazı fark ederseniz ev sahibinizi arayın.", "Polise haber vermeniz gerekirse ev sahibinizi arayın.", "Karbon monoksit alarmı öterse ev sahibinizi arayın."]) {
      expect(run("Otopark var mı?", `Otopark arkada. ${s}`).text, s).toBe(`Otopark arkada. ${s}`);
    }
  });

  it("'yazın' talimatı misafir TAM O durumu sorsa ve bilgi tabanı aynısını söylese de çıkar (kurucu: zaten ev sahibiyle yazışıyorlar)", () => {
    const kb = ["Wi-Fi bozulursa ev sahibinize yazın."];
    expect(run("Wi-Fi bozulursa ne yapmalıyım?", "Wi-Fi bozulursa ev sahibinize yazın.", kb).hostContactOnly).toBe(true);
    // K-1029-C: "arayın" + dayanak da artık kalmaz (ek sezgisi karar vermez; kurucu sorusu F1) → soru ev sahibine açık.
    const call = ["Wi-Fi bozulursa ev sahibinizi arayın."];
    expect(run("Wi-Fi bozulursa ne yapmalıyım?", "Wi-Fi bozulursa ev sahibinizi arayın.", call).hostContactOnly).toBe(true);
  });

  it("🚨 K-1029-A: bilgi yönlendirmesi ('… için ev sahibinize sorabilirsiniz') de ÇIKAR — doğru cevap gider, sauna sorusu açık kalır (soru kaybolmaz: kayıt konulu)", () => {
    // Önce: cümle kalıyor, "bilgim yok" kuralı BÜTÜN cevabı tutuyordu (otopark cevabı da gitmiyordu).
    expect(run("Otopark? Sauna var mı?", "Otopark var. Sauna için ev sahibinize sorabilirsiniz.")).toEqual({ text: "Otopark var.", hostContactOnly: false });
    expect(stripHostContactFiller("Otopark var. Sauna için ev sahibinize sorabilirsiniz.").removals[0]).toMatchObject({ form: "referral", generic: false });
    for (const r of ["Sauna için ev sahibinize sorabilirsiniz.", "Ev sahibinizi arayıp otoparkı sorabilirsiniz."]) {
      expect(run("Sauna var mı?", r), r).toEqual({ text: r, hostContactOnly: true });
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

  it("🚨 GD6 (gece döngüsü 10-29): İngilizce '-rse' sözcükleri ve 'Bursa' koşul eki DEĞİL — yaşanan olay varsayımsal sayılmaz", () => {
    for (const t of ["Of course, the router is not working", "The noise is worse today", "I'm a nurse and the heater is broken", "Bursa'dan geliyoruz, kombi çalışmıyor"]) {
      expect(asksHypotheticalSituation(t), t).toBe(false);
    }
    // Kontrol: gerçek koşul aynı metinde yine görülür.
    expect(asksHypotheticalSituation("Of course — what if the router stops working?")).toBe(true);
    expect(asksHypotheticalSituation("Bursa'dan geliyoruz; geç kalırsak ne olur?")).toBe(true);
    // Bağlantı: sorunu BİLDİREN misafire koşullu "arayın" cümlesi (dayanaklı + konu örtüşür) gitmez.
    const kb = ["If the router stops working, call your host."];
    const r = "If the router stops working, call your host.";
    expect(stripHostContactFiller(r, ["Of course the router is not working"], kb).hostContactOnly).toBe(true);
    // K-1029-C: varsayımsal soruda da artık kalmaz (ek sezgisi karar vermez).
    expect(stripHostContactFiller(r, ["What if the router stops working?"], kb).hostContactOnly).toBe(true);
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

  // Tasarım A12 (10-30): kısmi gönderim ACİL DURDURMA — varsayılan kapalı, yalnız "1".
  // Silinen yönlendirmenin konusu (kuaför) kalan cevapta geçmez; aynı konuya değinseydi ("Otopark için ev sahibinize yazın") v3'ten beri
  // cevabın tamamı tutulurdu (yarım cevap — aşağıdaki kontrol).
  const TOPICAL = "Otopark binanın arkasında, ücretsizdir. Kuaför için ev sahibinize yazın.";
  it("A12 kapalı (varsayılan / 'true'): konulu silmede kalan doğru cevap gider", async () => {
    for (const v of ["", "true", "0"]) {
      vi.stubEnv("AI_HOST_CONTACT_PARTIAL_DISABLED", v);
      openAiReturns(TOPICAL);
      const r = await suggestReply(input("Otopark var mı? Yakında kuaför var mı?"));
      expect(r.reply, v).toBe("Otopark binanın arkasında, ücretsizdir.");
      expect(r.hostContactOnly, v).toBeUndefined();
    }
  });
  it("🚨 A12 açık ('1'): konulu silme cevabın TAMAMINI tutar; taslak yine silinmiş metin", async () => {
    vi.stubEnv("AI_HOST_CONTACT_PARTIAL_DISABLED", "1");
    openAiReturns(TOPICAL);
    const r = await suggestReply(input("Otopark var mı? Yakında kuaför var mı?"));
    expect(r.reply).toBe("Otopark binanın arkasında, ücretsizdir.");
    expect(r.hostContactOnly).toBe(true);
    expect(autoReplyGateVerdict(r, "Otopark var mı?")?.detail).toBe("reply_host_contact_only");
  });
  it("v3: yönlendirme kalan cevabın KONUSUNA değiniyorsa (yarım cevap) A12 kapalıyken de cevabın tamamı tutulur", async () => {
    openAiReturns("Otopark binanın arkasında, ücretsizdir. Otopark için ev sahibinize yazın.");
    const r = await suggestReply(input("Otopark var mı?"));
    expect(r.hostContactOnly).toBe(true);
    expect(r.hostContactDraft).toBe("Otopark binanın arkasında, ücretsizdir.");
  });
  it("A12 açık: GENEL kapanış silmesi tutmaz; misafir olasılık sorduysa genel silme de tutar", async () => {
    vi.stubEnv("AI_HOST_CONTACT_PARTIAL_DISABLED", "1");
    openAiReturns("Otopark binanın arkasında, ücretsizdir. Bir sorun olursa ev sahibinize yazın.");
    expect((await suggestReply(input("Otopark var mı?"))).hostContactOnly).toBeUndefined();
    openAiReturns("Otopark binanın arkasında, ücretsizdir. Bir sorun olursa ev sahibinize yazın.");
    expect((await suggestReply(input("Otopark dolarsa ne yapmalıyım?"))).hostContactOnly).toBe(true);
  });
});
