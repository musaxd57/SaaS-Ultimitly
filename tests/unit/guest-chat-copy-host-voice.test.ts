import { describe, it, expect } from "vitest";
import { GUEST_COPY, QR_SERVER_TEXT, type GuestChatCopy } from "@/components/guest-chat/guest-chat-copy";
import { hostVoiceViolation } from "@/lib/ai/host-voice-guard";

// ---------------------------------------------------------------------------
// Kurucu 11-06: misafirin QR ekranında gördüğü SABİT metinler ev sahibinin ağzından — "ev sahibinizin verdiği kod", "contact your host"
// gibi üçüncü şahıs yok ("sanki ev sahibi değil de başka biri yazıyor gibi oluyor"). Denetçi, yapay zekâ cevaplarına uygulanan kodun AYNISI
// (`hostVoiceViolation`: üçüncü kişi ev sahibi · arka plan anlatımı · üçüncü taraf işletmeye gönderme).
// Kapsam dışı yalnız alt yazı etiketi (`footer` — "Otomatik asistan + ev sahibi"): sohbetteki tarafları adlandıran etiket, değişikliği
// kurucu sorusunda (rapor 11-06 gece).
// ---------------------------------------------------------------------------

const PENDING_FOUNDER_QUESTION: ReadonlySet<keyof GuestChatCopy> = new Set(["footer"]);

function stringsOf(copy: GuestChatCopy): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(copy) as [keyof GuestChatCopy, unknown][]) {
    if (PENDING_FOUNDER_QUESTION.has(key)) continue;
    if (typeof value === "string") out.push([key, value]);
    else if (typeof value === "function") {
      const fn = value as (x: unknown) => string;
      out.push([`${key}("Lale")`, String(fn("Lale"))], [`${key}(5)`, String(fn(5))]);
    }
  }
  return out;
}

describe("QR ekranı sabit metinleri — ev sahibinin ağzından (kurucu 11-06)", () => {
  it("anti-vakum: denetçi eski metinleri gerçekten yakalıyor", () => {
    expect(hostVoiceViolation("Sohbeti başlatmak için ev sahibinizin size verdiği sohbet kodunu girin.")).toBe("host_third_person");
    expect(hostVoiceViolation("Kodu bilmiyorsanız ev sahibinizle iletişime geçin.")).toBe("host_third_person");
    expect(hostVoiceViolation("Wrong code. Please check the chat code your host gave you.")).toBe("host_third_person");
    expect(hostVoiceViolation("Şu anda çok fazla mesaj aldık. Ev sahibiniz bilgilendirildi; kısa süre sonra tekrar yazabilirsiniz.")).toBe("host_third_person");
    expect(hostVoiceViolation("Replies may be prepared by AI. The host team can join the conversation when needed.")).toBe("host_third_person");
  });

  for (const locale of Object.keys(GUEST_COPY) as (keyof typeof GUEST_COPY)[]) {
    it(`${locale}: her metin ev sahibinin sesinde (üçüncü kişi ev sahibi / arka plan anlatımı / başka işletmeye gönderme yok)`, () => {
      const strings = stringsOf(GUEST_COPY[locale]);
      expect(strings.length).toBeGreaterThan(20);
      const offenders = strings.filter(([, text]) => hostVoiceViolation(text) !== null).map(([key, text]) => `${key}: ${text}`);
      expect(offenders).toEqual([]);
    });
  }

  it("sunucunun sabit cevapları da (çok mesaj, kod gerekli, başka cihaz); bildirim cümlesi yok", () => {
    for (const [key, text] of Object.entries(QR_SERVER_TEXT)) {
      expect(hostVoiceViolation(text), key).toBeNull();
      expect(text, key).not.toMatch(/bilgilendirildi|iletildi|kaydedildi/i);
    }
  });

  it("kod ekranı 'size verdiğimiz' der; yardım yolu rezervasyon uygulamasının mesaj bölümü (ev sahibi adına 'bize yazın')", () => {
    expect(GUEST_COPY.tr.pinPrompt).toBe("Sohbeti başlatmak için size verdiğimiz sohbet kodunu girin.");
    expect(GUEST_COPY.tr.pinWrong).toBe("Kod hatalı. Size verdiğimiz sohbet kodunu kontrol edin.");
    expect(GUEST_COPY.en.pinPrompt).toBe("Enter the chat code we gave you to start the chat.");
    expect(GUEST_COPY.tr.unavailableHint).toMatch(/bize yazın\.$/);
    expect(GUEST_COPY.en.unavailableHint).toMatch(/^If you need help, message us/);
  });
});
