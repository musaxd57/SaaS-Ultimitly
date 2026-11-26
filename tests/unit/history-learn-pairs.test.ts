import { describe, it, expect } from "vitest";
import { buildLearnPairs } from "@/lib/history-learn/pairs";
import type { HistoryMessage } from "@/lib/kb-from-history";

const T0 = Date.UTC(2026, 5, 1, 10, 0, 0);
let seq = 0;
function msg(conv: string, minute: number, direction: "inbound" | "outbound", body: string, extra: Partial<HistoryMessage> = {}): HistoryMessage {
  seq += 1;
  return {
    id: `m${String(seq).padStart(4, "0")}`,
    conversationId: conv,
    propertyId: "p1",
    direction,
    authorType: direction === "inbound" ? "guest" : "host",
    senderName: direction === "inbound" ? "Misafir" : "Ev sahibi",
    body,
    createdAt: new Date(T0 + minute * 60_000),
    ...extra,
  };
}

describe("Geçmişten öğren — eşleştirme", () => {
  it("misafir bloğu + peş peşe ev sahibi mesajları TEK çift", () => {
    const pairs = buildLearnPairs([
      msg("c1", 0, "inbound", "Merhaba"),
      msg("c1", 1, "inbound", "Otopark var mı?"),
      msg("c1", 5, "outbound", "Evet, binanın arkasında."),
      msg("c1", 6, "outbound", "Ücretsiz."),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe("Merhaba\nOtopark var mı?");
    expect(pairs[0].answer).toBe("Evet, binanın arkasında.\nÜcretsiz.");
    expect(pairs[0].questionIds).toHaveLength(2);
    expect(pairs[0].answerIds).toHaveLength(2);
  });

  it("🚨 K7: otomatik şablon mesajı cevap DEĞİL — blok bekler, ardından gelen ev sahibi cevabı eşleşir; KONTROL: şablon yerine yapay zekâ → çift yok", () => {
    const auto = buildLearnPairs([
      msg("c1", 0, "inbound", "Otopark var mı?"),
      msg("c1", 1, "outbound", "Hoş geldiniz! Giriş bilgileri ektedir.", { authorType: "automation" }),
      msg("c1", 3, "outbound", "Otopark binanın arkasında."),
    ]);
    // Şablonla ev sahibi aynı giden dizide: şablon cevabın parçası DEĞİL.
    expect(auto).toHaveLength(1);
    expect(auto[0].answer).toBe("Otopark binanın arkasında.");

    const split = buildLearnPairs([
      msg("c2", 0, "inbound", "Otopark var mı?"),
      msg("c2", 1, "outbound", "Hoş geldiniz!", { authorType: "automation" }),
      msg("c2", 2, "inbound", "Bir de wifi?"),
      msg("c2", 4, "outbound", "Otopark arkada, wifi şifresi kartta."),
    ]);
    expect(split).toHaveLength(1);
    expect(split[0].question).toBe("Otopark var mı?\nBir de wifi?");

    const ai = buildLearnPairs([
      msg("c3", 0, "inbound", "Otopark var mı?"),
      msg("c3", 1, "outbound", "Binanın arkasında otopark var.", { authorType: "ai", aiAssisted: true, senderName: "GuestOps AI" }),
      msg("c3", 3, "outbound", "Otopark binanın arkasında."),
    ]);
    expect(ai).toHaveLength(0);
  });

  it("yapay zekâ cevabı bloğu tüketir: sonraki ev sahibi mesajı o sorunun cevabı sayılmaz", () => {
    const pairs = buildLearnPairs([
      msg("c1", 0, "inbound", "Wifi şifresi?"),
      msg("c1", 1, "outbound", "Kartta yazıyor.", { authorType: "ai", aiAssisted: true }),
      msg("c1", 2, "inbound", "Teşekkürler"),
      msg("c1", 3, "outbound", "Rica ederim."),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe("Teşekkürler");
  });

  it("eski satır: authorType NULL + bilinen yapay zekâ adı → yapay zekâ sayılır", () => {
    const pairs = buildLearnPairs([
      msg("c1", 0, "inbound", "Havlu var mı?"),
      msg("c1", 1, "outbound", "Evet.", { authorType: null, senderName: "GuestOps AI" }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("12 saatten geç cevap eşleşmez; sınırda eşleşir", () => {
    const late = buildLearnPairs([msg("c1", 0, "inbound", "Havlu?"), msg("c1", 12 * 60 + 1, "outbound", "Dolapta.")]);
    expect(late).toHaveLength(0);
    const edge = buildLearnPairs([msg("c2", 0, "inbound", "Havlu?"), msg("c2", 12 * 60, "outbound", "Dolapta.")]);
    expect(edge).toHaveLength(1);
  });

  it("sorunlu konuşma dışarıda; sistem olayı ve boş gövde bloğu etkilemez", () => {
    const rows = [
      msg("c1", 0, "inbound", "Klima bozuk"),
      msg("c1", 1, "outbound", "Özür dileriz, indirim yapıyoruz."),
      msg("c2", 0, "inbound", "Çöp nereye?"),
      msg("c2", 1, "outbound", "", { systemEventType: "guest_chat_ai_resumed" }),
      msg("c2", 2, "inbound", "   "),
      msg("c2", 3, "outbound", "Kapının yanındaki konteynere."),
    ];
    const pairs = buildLearnPairs(rows, [{ id: "c1", status: "problem" }]);
    expect(pairs.map((p) => p.conversationId)).toEqual(["c2"]);
    expect(pairs[0].question).toBe("Çöp nereye?");
  });

  it("çift HAM ve KIRPILMAMIŞ (maske önce, kırpma sonra — mask.ts); çıktı yeni → eski sıralı", () => {
    const long = "a".repeat(5_000);
    const pairs = buildLearnPairs([
      msg("old", 0, "inbound", "Soru 1"),
      msg("old", 1, "outbound", long),
      msg("new", 100, "inbound", "Soru 2"),
      msg("new", 101, "outbound", "Cevap 2"),
    ]);
    expect(pairs.map((p) => p.conversationId)).toEqual(["new", "old"]);
    expect(pairs[1].answer).toBe(long);
  });

  it("ev sahibi + yapay zekâ AYNI giden dizide → çift DÜŞER (kimin cevabı belirsiz); KONTROL: yalnız ev sahibi → çift", () => {
    const mixed = buildLearnPairs([
      msg("c1", 0, "inbound", "Havlu var mı?"),
      msg("c1", 1, "outbound", "Dolapta.", { authorType: "ai", aiAssisted: true }),
      msg("c1", 2, "outbound", "Ekstra havlu da bırakırım."),
    ]);
    expect(mixed).toHaveLength(0);
    const host = buildLearnPairs([msg("c2", 0, "inbound", "Havlu var mı?"), msg("c2", 2, "outbound", "Ekstra havlu da bırakırım.")]);
    expect(host).toHaveLength(1);
  });

  it("süre İLK ev sahibi mesajından ölçülür: ilki pencere içinde, sonraki dışarıda → çift var ve iki mesajı da taşır", () => {
    const pairs = buildLearnPairs([
      msg("c1", 0, "inbound", "Otopark?"),
      msg("c1", 11 * 60, "outbound", "Arkada."),
      msg("c1", 13 * 60, "outbound", "Ücretsiz."),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].answer).toBe("Arkada.\nÜcretsiz.");
  });

  it("eşit zaman damgasında id sırası (deterministik)", () => {
    const a = msg("c1", 0, "inbound", "Soru");
    const b = { ...msg("c1", 0, "outbound", "Cevap"), id: "zzz" };
    expect(buildLearnPairs([b, a])).toHaveLength(1);
  });
});

describe("🚨 yapay zekâ taslağının yankısı ev sahibi kanıtı DEĞİL (Opus H1, Codex ilke 2)", () => {
  const DRAFT = "Kumandadaki kırmızı düğmeye basıp 10 saniye bekleyin, televizyon açılacaktır.";
  it("misafir mesajında tutulan taslak 'Taslağı kullan' ile (aiAssisted=false) gönderildiyse çift ÜRETİLMEZ — küçük düzenlemeyle de", () => {
    const verbatim = buildLearnPairs([
      msg("c1", 0, "inbound", "TV açılmıyor", { aiSuggestedReply: DRAFT }),
      msg("c1", 5, "outbound", DRAFT, { aiAssisted: false }),
    ]);
    expect(verbatim).toEqual([]);
    const edited = buildLearnPairs([
      msg("c2", 0, "inbound", "TV açılmıyor", { aiSuggestedReply: DRAFT }),
      msg("c2", 5, "outbound", `Merhaba! ${DRAFT} Kolay gelsin.`, { aiAssisted: false }),
    ]);
    expect(edited).toEqual([]);
  });

  it("aşırı uygulama yok: taslaktan FARKLI kendi cevabı yazan ev sahibi çift üretir; taslak yoksa bugünkü gibi", () => {
    const own = buildLearnPairs([
      msg("c1", 0, "inbound", "TV açılmıyor", { aiSuggestedReply: DRAFT }),
      msg("c1", 5, "outbound", "Uydu alıcısının fişi takılı olmayabilir, prizi kontrol eder misiniz?"),
    ]);
    expect(own).toHaveLength(1);
    const none = buildLearnPairs([msg("c3", 0, "inbound", "TV açılmıyor"), msg("c3", 5, "outbound", DRAFT)]);
    expect(none).toHaveLength(1);
    // Kısa taslak ("Evet, var.") içinde geçtiği gerçek cevabı düşürmez (Haiku 10-15).
    const short = buildLearnPairs([
      msg("c4", 0, "inbound", "Otopark var mı?", { aiSuggestedReply: "Evet, var." }),
      msg("c4", 5, "outbound", "Evet, var. Binanın arkasında 2 yer var, ücretsiz."),
    ]);
    expect(short).toHaveLength(1);
  });

  it("uzun taslak / cevapta doğrusal (sözcük kümesi tavanlı)", () => {
    const long = "kelime ".repeat(50_000);
    const t0 = performance.now();
    buildLearnPairs([msg("c1", 0, "inbound", "Soru", { aiSuggestedReply: long }), msg("c1", 5, "outbound", long)]);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });
});
