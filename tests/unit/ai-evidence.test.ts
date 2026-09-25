import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Codex #28/#29 — evidence integrity of the model's structured output:
//   #28 usedSources "reservation:*" accepted ANY suffix whenever a reservation
//       existed → a fabricated "reservation:door_code" rendered as a trusted
//       "used context" chip. Now field-whitelisted like property:*.
//   #29 statedCheckoutTime was accepted on FORMAT alone and is persisted onto
//       the reservation (guestCheckoutTime → turnover planning) → a regex-valid
//       hallucination got written. Now it must be deterministically evidenced
//       in the guest's own message.
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { suggestReply } from "@/lib/ai";
import { timeCorrectedInMessage, timeStatedInMessage } from "@/lib/ai/stated-time";
import type { SuggestReplyInput } from "@/lib/ai/types";

function makeInput(guestMessage: string): SuggestReplyInput {
  return {
    guestMessage,
    property: { name: "Galata Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "Galata", city: "İstanbul" },
    reservation: { guestName: "John Smith", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
    knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ: X şifre: Y" }],
    tone: "warm",
    language: "tr",
  };
}

/** Stub OpenAI to return exactly this parsed payload. */
function stubModel(payload: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }] }),
          { status: 200 },
        ),
    ),
  );
}

const BASE = {
  intent: "wifi",
  confidence: 0.9,
  reply: "Örnek cevap",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "tr",
  riskType: null,
  missingInfo: [],
};

beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("usedSources reservation:* field whitelist (#28)", () => {
  it("keeps REAL reservation fields, drops invented ones", async () => {
    stubModel({
      ...BASE,
      usedSources: [
        "kb:wifi",
        "reservation:arrivalDate",
        "reservation:status",
        "reservation:door_code", // fabricated — must drop
        "reservation:price", // not in the model's context — must drop
      ],
      statedCheckoutTime: null,
    });
    const result = await suggestReply(makeInput("Wifi şifresi nedir?"));
    expect(result.source).toBe("openai");
    expect(result.usedSources).toEqual(["kb:wifi", "reservation:arrivalDate", "reservation:status"]);
  });

  it("drops ALL reservation:* claims when there is no reservation at all", async () => {
    stubModel({ ...BASE, usedSources: ["reservation:arrivalDate"], statedCheckoutTime: null });
    const input = { ...makeInput("Wifi şifresi nedir?"), reservation: null };
    const result = await suggestReply(input);
    expect(result.usedSources).toEqual([]);
  });
});

describe("statedCheckoutTime requires evidence in the guest message (#29)", () => {
  it("accepted when the guest explicitly wrote the time", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "18:00" });
    const result = await suggestReply(makeInput("Yarın 18:00 gibi çıkarız."));
    expect(result.statedCheckoutTime).toBe("18:00");
  });

  it("accepted for '6pm' stated as 18:00 and 'saat 9' stated as 09:00", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "18:00" });
    expect((await suggestReply(makeInput("We will leave around 6pm tomorrow"))).statedCheckoutTime).toBe("18:00");

    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "09:00" });
    expect((await suggestReply(makeInput("Saat 9 gibi çıkarız"))).statedCheckoutTime).toBe("09:00");
  });

  it("HALLUCINATION dropped: message contains no such time", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "10:00" });
    const result = await suggestReply(makeInput("Konaklama harikaydı, teşekkürler!"));
    expect(result.statedCheckoutTime).toBeNull();
  });

  it("a bare count ('2 valizimiz var') can NOT anchor a 14:00 claim", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "14:00" });
    const result = await suggestReply(makeInput("2 valizimiz var, çıkışta resepsiyona bırakabilir miyiz?"));
    expect(result.statedCheckoutTime).toBeNull();
  });
});

describe("statedCheckoutTime — DÜZELTME kabul edilir (09-25, kurucu örneği)", () => {
  const withStored = (msg: string, stored: string | null) => {
    const base = makeInput(msg);
    return { ...base, reservation: { ...base.reservation!, guestCheckoutTime: stored } };
  };

  it("🚨 '10 demiştim ama 11 olacak' + kayıtlı 10:00 → YENİ saat (eskiden reddediliyor, eski saat kalıyordu)", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "11:00" });
    expect((await suggestReply(withStored("10 demiştim ama 11 olacak", "10:00"))).statedCheckoutTime).toBe("11:00");
  });

  it("kayıtlı eski saat YOKSA düzeltme kabulü yok (halüsinasyon durdurucu aynen)", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "11:00" });
    expect((await suggestReply(withStored("10 demiştim ama 11 olacak", null))).statedCheckoutTime).toBeNull();
  });

  it("yeni saat mesajda YOKSA reddedilir (model uydurmasın)", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "12:00" });
    expect((await suggestReply(withStored("10 demiştim ama biraz geç olacak", "10:00"))).statedCheckoutTime).toBeNull();
  });

  it("misafir ayrılmayı REDDEDİYORSA düzeltme de reddedilir (veto aynen)", async () => {
    stubModel({ ...BASE, intent: "checkout", usedSources: [], statedCheckoutTime: "11:00" });
    expect((await suggestReply(withStored("10 demiştim ama çıkmayacağız, 11 bile değil", "10:00"))).statedCheckoutTime).toBeNull();
  });
});

describe("timeCorrectedInMessage (pure)", () => {
  it("eski ve yeni saat AYNI cümlede (çıplak rakam dahil) → düzeltme", () => {
    expect(timeCorrectedInMessage("10:00", "11:00", "10 demiştim ama 11 olacak")).toBe(true);
    expect(timeCorrectedInMessage("10:00", "11:30", "Saat 10:00 yerine 11:30'da çıkarız")).toBe(true);
    expect(timeCorrectedInMessage("10:00", "11:00", "make it 11 instead of 10")).toBe(true);
  });

  it("farklı cümleler, aynı saat, eksik eski saat → düzeltme DEĞİL", () => {
    expect(timeCorrectedInMessage("10:00", "11:00", "10 demiştim. 11 olacak.")).toBe(false);
    expect(timeCorrectedInMessage("10:00", "10:00", "10 demiştim ama 10 olacak")).toBe(false);
    expect(timeCorrectedInMessage("10:00", "11:00", "biraz geç olacak, 11 gibi")).toBe(false);
    expect(timeCorrectedInMessage("bozuk", "11:00", "10 demiştim ama 11 olacak")).toBe(false);
  });

  it("rakam başka bir sayının parçasıysa saat sayılmaz ('110', '10.5')", () => {
    expect(timeCorrectedInMessage("10:00", "11:00", "oda 110, kat 11")).toBe(false);
    // "110"un içinden "11" okunmaz (eski saat 11 sanılıp düzeltme kabul edilmesin).
    expect(timeCorrectedInMessage("11:00", "10:00", "oda 110'dayız, saat 10 olsun")).toBe(false);
    expect(timeCorrectedInMessage("11:00", "10:00", "11 demiştik, saat 10 olsun")).toBe(true);
    // İnceleme 09-25 (test boşluğu): "10.5" başlıkta vardı ama sınanmıyordu — ondalık sayının parçası saat değildir.
    expect(timeCorrectedInMessage("10:00", "11:00", "10.5 km uzaktayız, 11 olacak")).toBe(false);
    expect(timeCorrectedInMessage("10:00", "11:00", "10:30 demiştim ama 11 olacak")).toBe(false);
  });

  it("🚨 P2 (inceleme 09-25): TEK belirteç iki saati birden karşılayamaz (12 saat arası okunuş)", () => {
    expect(timeCorrectedInMessage("10:00", "22:00", "Çıkış saatini 10 demiştim, aynen geçerli.")).toBe(false);
    expect(timeCorrectedInMessage("08:00", "20:00", "8 kişiyiz")).toBe(false);
    expect(timeCorrectedInMessage("11:00", "23:00", "Saat 11 demiştim, teşekkürler")).toBe(false);
    expect(timeCorrectedInMessage("01:00", "13:00", "1 valizimiz var")).toBe(false);
    // İKİ belirteçli cümlede de: eski VE yeni saati aynı "10" (10:00 / 22:00 okunuşu) karşılıyor, öteki belirteç ikisini
    // de karşılamıyor → düzeltme değil (mutasyon turu 09-25: tek belirteçli örnekler sayı şartına takılıyordu).
    expect(timeCorrectedInMessage("10:00", "22:00", "10 demiştim ama 11:30 olacak")).toBe(false);
    expect(timeCorrectedInMessage("10:00", "11:30", "10 demiştim ama 11:30 olacak")).toBe(true); // KONTROL
  });

  it("🚨 P2: üç saatli cümle bu yoldan kabul edilmez (uçuş saati düzeltme sanılmasın)", () => {
    expect(timeCorrectedInMessage("10:00", "14:00", "Sabah 10 dedik ama uçağımız 14:00'te, 11'de çıkarız")).toBe(false);
    expect(timeCorrectedInMessage("11:00", "19:30", "11 demiştim ama uçağımız 19:30'da, sabah 8 gibi çıkarız")).toBe(false);
    // Çıkış fiili taşıyan saat ANA yoldan kabul edilir (düzeltme yolu gerekmez).
    expect(timeStatedInMessage("11:00", "Sabah 10 dedik ama uçağımız 14:00'te, 11'de çıkarız")).toBe(true);
  });

  it("🚨 P2: sayaç / numara / tarih saat değildir; düzeltme ya da çıkış işareti şarttır", () => {
    expect(timeCorrectedInMessage("10:00", "11:00", "oda 10, kat 11")).toBe(false);
    // Düzeltme İŞARETİ olan numara cümlesi (mutasyon turu 09-25: yukarıdaki satır işaret şartına takılıyordu, numara
    // kuralını sınamıyordu): "oda 10" saat değildir.
    expect(timeCorrectedInMessage("10:00", "11:00", "Oda 10 değil 11 olacak")).toBe(false);
    expect(timeCorrectedInMessage("10:00", "11:00", "Havlular 10 tane mi 11 tane mi?")).toBe(false);
    expect(timeCorrectedInMessage("10:00", "11:00", "10/11 tarihinde geleceğiz")).toBe(false);
    expect(timeCorrectedInMessage("10:00", "11:00", "10 kişi demiştik ama 11 olacağız")).toBe(false);
    expect(timeCorrectedInMessage("10:00", "11:00", "Otobüs 10 ile 11 arası geçiyor")).toBe(false); // işaret yok
    // am/pm okunuşu korunur: "10 pm" yalnız 22:00'dır.
    expect(timeCorrectedInMessage("10:00", "11:00", "10 pm demiştim ama 11 olacak")).toBe(false);
    expect(timeCorrectedInMessage("22:00", "23:00", "10 pm demiştim ama 11 pm olacak")).toBe(true);
  });
});

describe("timeStatedInMessage — ileri bakış (inceleme 09-25)", () => {
  it("🚨 ipucu cümleciğinin KENDİ saati varsa sonraki cümleciğin saati çıkış sayılmaz", () => {
    expect(timeStatedInMessage("09:00", "11'de çıkarız demiştim; çıkmadan önce 09:00'da kahvaltı yapabilir miyiz")).toBe(false);
    expect(timeStatedInMessage("11:00", "11'de çıkarız demiştim; çıkmadan önce 09:00'da kahvaltı yapabilir miyiz")).toBe(true);
    // KONTROL: ipucu cümleciğinde saat yoksa ileri bakış sürer.
    expect(timeStatedInMessage("10:00", "yarın çıkıyoruz, saat 10:00 gibi")).toBe(true);
  });
});

describe("timeStatedInMessage (pure)", () => {
  it("explicit forms (with checkout context)", () => {
    expect(timeStatedInMessage("18:00", "18:00 gibi çıkarız")).toBe(true);
    expect(timeStatedInMessage("18:00", "18:00'de çıkacağız")).toBe(true);
    expect(timeStatedInMessage("18:30", "we leave at 6:30 pm")).toBe(true);
    expect(timeStatedInMessage("06:30", "we leave at 6:30 am")).toBe(true);
    expect(timeStatedInMessage("18:30", "çıkış 18.30 olur")).toBe(true);
    expect(timeStatedInMessage("18:30", "we leave at 6:30")).toBe(true); // afternoon reading allowed
  });

  it("cued bare hours (with checkout context)", () => {
    expect(timeStatedInMessage("18:00", "akşam 6 gibi çıkarız")).toBe(true);
    expect(timeStatedInMessage("09:00", "saat 9 civarı ayrılırız")).toBe(true);
    expect(timeStatedInMessage("18:00", "18'de çıkarız")).toBe(true);
    expect(timeStatedInMessage("12:00", "çıkışı öğlen 12 yapabilir miyiz")).toBe(true);
    expect(timeStatedInMessage("21:00", "we depart at 9 pm")).toBe(true);
    expect(timeStatedInMessage("18:00", "ÇIKACAĞIZ akşam 6 gibi")).toBe(true); // all-caps I → i lowercasing
  });

  it("a time WITHOUT checkout context is NOT a checkout claim (Codex follow-up)", () => {
    expect(timeStatedInMessage("18:00", "Check-in 18:00 mi?")).toBe(false); // check-IN question
    expect(timeStatedInMessage("18:00", "Dinner at 18:00")).toBe(false); // unrelated event
    expect(timeStatedInMessage("09:00", "saat 9 civarı")).toBe(false); // no checkout verb at all
    expect(timeStatedInMessage("21:00", "at 9 pm")).toBe(false);
    // The cue can't be borrowed from a DIFFERENT sentence.
    expect(timeStatedInMessage("18:00", "Dinner at 18:00. We will leave tomorrow.")).toBe(false);
  });

  it("no false anchors from uncued numbers / mismatches", () => {
    expect(timeStatedInMessage("14:00", "2 valizimiz var, çıkışta bırakacağız")).toBe(false);
    expect(timeStatedInMessage("10:00", "oda 10 numarada mı")).toBe(false); // no time cue
    expect(timeStatedInMessage("18:00", "19:00 gibi çıkarız")).toBe(false);
    expect(timeStatedInMessage("18:15", "18:00 gibi çıkarız")).toBe(false);
    expect(timeStatedInMessage("06:00", "we leave at 6 pm")).toBe(false); // pm pins it to 18:00
    expect(timeStatedInMessage("18:00", "harika bir konaklamaydı")).toBe(false);
  });
});
