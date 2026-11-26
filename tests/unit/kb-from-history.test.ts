import { describe, it, expect } from "vitest";
import {
  buildKbSuggestionsFromHistory,
  isHostAuthored,
  maskGuestName,
  sensitiveClassesIn,
  INTENT_TO_CATEGORY,
  SUGGESTION_MAX_CHARS,
  type HistoryMessage,
} from "@/lib/kb-from-history";

// ---------------------------------------------------------------------------
// KNOWLEDGE HUB BACAK B — host'un kendi geçmiş cevaplarından KB ÖNERİSİ.
//
// 🚨 ÜÇ ZORUNLU KURAL (docs/DEGERLENDIRME-2026-09-11-…) bu dosyada pinlidir:
//  ① geçmiş cevap GERÇEK değil GÖZLEMDİR      → operasyonel niyet eşlenmez
//  ② yanlış cevabın ÇOĞALMASI                  → "sorunlu" konuşma dışlanır
//  ③ KVKK                                       → misafir adı {isim}'e çevrilir
// ---------------------------------------------------------------------------

let n = 0;
const t0 = new Date("2026-09-01T10:00:00Z");
function msg(over: Partial<HistoryMessage> & Pick<HistoryMessage, "direction" | "body">): HistoryMessage {
  n += 1;
  return {
    id: `m${String(n).padStart(4, "0")}`,
    conversationId: "c1",
    propertyId: "p1",
    authorType: over.direction === "inbound" ? "guest" : "host",
    senderName: null,
    createdAt: new Date(t0.getTime() + n * 60_000),
    ...over,
  };
}
/** Bir soru→cevap turu; her tur ayrı konuşmada olabilir. */
function turn(q: string, a: string, over: Partial<HistoryMessage> = {}): HistoryMessage[] {
  return [msg({ direction: "inbound", body: q, ...over }), msg({ direction: "outbound", body: a, ...over })];
}

describe("buildKbSuggestionsFromHistory — temel sözleşme", () => {
  it("aynı konu 2 kez cevaplanmışsa ÖNERİ çıkar, 1 kez cevaplanmışsa ÇIKMAZ", () => {
    const twice = [
      ...turn("Wifi şifresi nedir?", "Ağ LaleApt, şifre 12345678.", { conversationId: "cA" }),
      ...turn("wifi parolası ne acaba", "Şifre 12345678, ağ LaleApt.", { conversationId: "cB" }),
    ];
    const once = turn("Otopark var mı?", "Evet, bina altında ücretsiz otopark var.", { conversationId: "cC" });

    const out = buildKbSuggestionsFromHistory([...twice, ...once]);
    expect(out.map((s) => s.category)).toEqual(["wifi"]);
    expect(out[0].occurrences).toBe(2);
    expect(out[0].propertyId).toBe("p1");
  });

  it("🚨 EN YENİ cevap önerilir, en SIK olan değil (host şifreyi değiştirmiş olabilir)", () => {
    const out = buildKbSuggestionsFromHistory([
      ...turn("wifi şifresi?", "Şifre ESKI1111.", { conversationId: "cA" }),
      ...turn("wifi şifresi?", "Şifre ESKI1111.", { conversationId: "cB" }),
      ...turn("wifi şifresi?", "Şifre YENI2222.", { conversationId: "cC" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].answer).toContain("YENI2222");
    expect(out[0].answer).not.toContain("ESKI1111");
    expect(out[0].occurrences, "sayım yalnız EŞİK içindir").toBe(3);
  });

  it("mülk başına AYRI önerilir (kiracı/mülk karışmaz)", () => {
    const out = buildKbSuggestionsFromHistory([
      ...turn("wifi şifresi?", "P1 şifresi AAA.", { conversationId: "cA", propertyId: "p1" }),
      ...turn("wifi şifresi?", "P1 şifresi AAA.", { conversationId: "cB", propertyId: "p1" }),
      ...turn("wifi şifresi?", "P2 şifresi BBB.", { conversationId: "cC", propertyId: "p2" }),
      ...turn("wifi şifresi?", "P2 şifresi BBB.", { conversationId: "cD", propertyId: "p2" }),
    ]);
    expect(out).toHaveLength(2);
    const byProp = Object.fromEntries(out.map((s) => [s.propertyId, s.answer]));
    expect(byProp.p1).toContain("AAA");
    expect(byProp.p1).not.toContain("BBB");
    expect(byProp.p2).toContain("BBB");
  });

  it("boş girdi çökmez", () => {
    expect(buildKbSuggestionsFromHistory([])).toEqual([]);
    expect(buildKbSuggestionsFromHistory([], [])).toEqual([]);
  });
});

describe("🚨 KURAL ① — geçmiş cevap GÖZLEMDİR: operasyonel niyet ÖNERİ ÜRETMEZ", () => {
  it("şikâyet / iade / insan talebi cevapları KB'ye ÖNERİLMEZ", () => {
    // Bu konuşmalardaki host cevabı TEK BİR MİSAFİRE özgü bir KARARDIR
    // ("bu sefer izin veriyorum") — kalıcı kural sanılırsa ürün YANLIŞ SÖZ verir.
    const out = buildKbSuggestionsFromHistory([
      ...turn("Klima bozuk, çalışmıyor!", "Çok üzgünüm, hemen tamirci yolluyorum.", { conversationId: "cA" }),
      ...turn("Klima bozuk, çalışmıyor!", "Çok üzgünüm, hemen tamirci yolluyorum.", { conversationId: "cB" }),
      ...turn("Param iade edilsin istiyorum.", "Bu seferlik tam iade yapıyorum.", { conversationId: "cC" }),
      ...turn("Param iade edilsin istiyorum.", "Bu seferlik tam iade yapıyorum.", { conversationId: "cD" }),
    ]);
    expect(out).toEqual([]);
  });

  it("🚨 giriş/çıkış saati ÖNERİLMEZ — o bir MÜLK ALANI (çift kopya yasağı)", () => {
    // `kb-extract.ts` (A5) de aynı kuralı uyguluyor: iki kaynak çelişince
    // retrieval'ın çelişki koruması devreye girer ve misafire saat SÖYLENMEZ.
    const out = buildKbSuggestionsFromHistory([
      ...turn("Giriş saati kaçta?", "Giriş 15:00'te.", { conversationId: "cA" }),
      ...turn("Check-in saati nedir?", "Giriş 15:00'te.", { conversationId: "cB" }),
      ...turn("Çıkış saati kaçta?", "Çıkış 11:00.", { conversationId: "cC" }),
      ...turn("Çıkış saati kaçta?", "Çıkış 11:00.", { conversationId: "cD" }),
    ]);
    expect(out).toEqual([]);
  });

  it("🚨 ELEME TEK KAYNAKTAN: allowlist tam olarak dört bilgi kategorisi", () => {
    // Mutasyon turu ölçtü: bir de denylist vardı ve İKİSİ DE PİNLENEMİYORDU
    // (biri silinince öteki yakalıyordu) → denylist SİLİNDİ. Kalan tek kapı bu.
    expect(Object.keys(INTENT_TO_CATEGORY).sort()).toEqual(["cleaning", "location", "parking", "wifi"]);
    // Karşı yön: operasyonel ve yapılandırılmış-alan niyetleri BURADA OLMAMALI.
    for (const i of ["complaint", "refund", "early_departure", "human_request", "checkin", "checkout", "amenity", "general"]) {
      expect(i in INTENT_TO_CATEGORY, i).toBe(false);
    }
  });
});

describe("🚨 KURAL ② — yanlış cevap ÇOĞALMAZ", () => {
  it("'sorunlu' işaretli konuşmadaki cevap ÖNERİYE GİRMEZ", () => {
    const msgs = [
      ...turn("wifi şifresi?", "Şifre AAA.", { conversationId: "cOK1" }),
      ...turn("wifi şifresi?", "Şifre AAA.", { conversationId: "cOK2" }),
      ...turn("wifi şifresi?", "Kusura bakmayın, modem arızalı.", { conversationId: "cBAD" }),
    ];
    const out = buildKbSuggestionsFromHistory(msgs, [{ id: "cBAD", status: "problem" }]);
    expect(out).toHaveLength(1);
    expect(out[0].occurrences, "sorunlu tur sayıma da girmemeli").toBe(2);
    expect(out[0].answer).not.toContain("arızalı");
  });

  it("🚨 KENDİ AI ÇIKTIMIZ host cevabı SAYILMAZ (ölçülmüş tuzak, üç eleme)", () => {
    // `write-service.ts` sağlayıcıdan gelen HER outbound'u `authorType:"host"`
    // damgalıyor; yerel yazma başarısızsa kendi AI gönderimimiz "host" olarak
    // geri geliyor. `refreshStyleProfile` yorumu aynı tuzağa bir kez düşüldüğünü
    // kaydediyor: ad denylist'i TEK BAŞINA yetmemişti.
    expect(isHostAuthored(msg({ direction: "outbound", body: "x", aiAssisted: true }))).toBe(false);
    expect(isHostAuthored(msg({ direction: "outbound", body: "x", authorType: "ai" }))).toBe(false);
    expect(isHostAuthored(msg({ direction: "outbound", body: "x", senderName: "GuestOps AI" }))).toBe(false);
    expect(isHostAuthored(msg({ direction: "outbound", body: "x", senderName: "Lixus AI" }))).toBe(false);
    // KARŞI YÖN: gerçek host cevabı ve eski (authorType NULL) satır GEÇER.
    expect(isHostAuthored(msg({ direction: "outbound", body: "x", authorType: "host" }))).toBe(true);
    expect(isHostAuthored(msg({ direction: "outbound", body: "x", authorType: null, senderName: "Musa" }))).toBe(true);
    // Gelen mesaj, sistem olayı ve boş gövde asla cevap değildir.
    expect(isHostAuthored(msg({ direction: "inbound", body: "x" }))).toBe(false);
    expect(isHostAuthored(msg({ direction: "outbound", body: "x", systemEventType: "resumed" }))).toBe(false);
    expect(isHostAuthored(msg({ direction: "outbound", body: "   " }))).toBe(false);
  });

  it("AI cevapları ÖNERİ SAYIMINI da şişirmez (uçtan uca)", () => {
    const out = buildKbSuggestionsFromHistory([
      ...turn("wifi şifresi?", "Şifre AAA.", { conversationId: "cA" }),
      msg({ direction: "inbound", body: "wifi şifresi?", conversationId: "cB" }),
      msg({ direction: "outbound", body: "Şifre AAA.", conversationId: "cB", senderName: "Lixus AI" }),
    ]);
    expect(out, "tek GERÇEK host cevabı eşiği geçmemeli").toEqual([]);
  });
});

describe("🚨 KURAL ③ — KVKK: misafir adı KB'ye SIZMAZ", () => {
  it("cevaptaki misafir adı {isim} yer tutucusuna çevrilir", () => {
    const out = buildKbSuggestionsFromHistory(
      [
        ...turn("wifi şifresi?", "Merhaba Ayşe, şifre 12345678.", { conversationId: "cA" }),
        ...turn("wifi şifresi?", "Merhaba Ayşe, şifre 12345678.", { conversationId: "cB" }),
      ],
      [],
      { guestNamesByConversation: { cA: "Ayşe Yılmaz", cB: "Ayşe Yılmaz" } },
    );
    expect(out).toHaveLength(1);
    expect(out[0].answer, "eski misafirin adı KB'ye giriyor").not.toContain("Ayşe");
    expect(out[0].answer).toContain("{isim}");
    expect(out[0].answer, "asıl bilgi korunmalı").toContain("12345678");
  });

  it("maskGuestName — kelime sınırı ve büyük/küçük harf", () => {
    expect(maskGuestName("Merhaba Ayşe, hoş geldiniz.", "Ayşe Yılmaz")).toBe("Merhaba {isim}, hoş geldiniz.");
    expect(maskGuestName("merhaba ayşe!", "Ayşe")).toBe("merhaba {isim}!");
    // 🚨 KELİME İÇİNDE eşleşmez — yoksa gerçek kelimeler parçalanır.
    expect(maskGuestName("Ayşegül sokağındaki market", "Ayşe")).toBe("Ayşegül sokağındaki market");
    // Çok kısa / boş ad hiçbir şeyi bozmaz (yanlış ikame en kötü sonuç).
    expect(maskGuestName("Al bunu.", "Al")).toBe("Al bunu.");
    expect(maskGuestName("metin", null)).toBe("metin");
    expect(maskGuestName("metin", "")).toBe("metin");
  });

  it("🚨 SOYADI ve İKİNCİ ÖN AD da temizlenir (eskiden yalnız İLK kelime)", () => {
    // Ölçüm (09-18 ajanı): 25 gerçekçi metinde misafirin TAM adı hiçbirinde
    // temizlenmiyordu; "Ömer Faruk Tan" → yalnız "Ömer" düşüyordu.
    expect(maskGuestName("Ömer Faruk Tan adına kayıt açtım.", "Ömer Faruk Tan")).toBe("{isim} adına kayıt açtım.");
    expect(maskGuestName("Ayşe Yılmaz'ın faturası hazır.", "Ayşe Yılmaz")).toBe("{isim}'ın faturası hazır.");
    expect(maskGuestName("Yılmaz Bey, hoş geldiniz.", "Ayşe Yılmaz")).toBe("{isim} Bey, hoş geldiniz.");
  });

  it("🚨 KISA PARÇALI TAM AD da temizlenir (eskiden maskeleme KOMPLE kapanıyordu)", () => {
    // Eski kod `first.length < 3` görünce HİÇBİR ŞEY yapmıyordu; "Li Wei" gibi
    // adlarda metin ham kalıyordu. Tam ad birlikte AYIRT EDİCİDİR.
    expect(maskGuestName("Li Wei için not bıraktım.", "Li Wei")).toBe("{isim} için not bıraktım.");
    // Karşı yön KORUNDU: tek başına kısa parça ikame edilmez (yanlış ikame riski).
    expect(maskGuestName("Al bunu.", "Al")).toBe("Al bunu.");
    expect(maskGuestName("Li bunu aldı.", "Li Wei")).toBe("Li bunu aldı.");
  });

  it("hassas sınıflar İŞARETLENİR, içerik BOZULMAZ", () => {
    // 🚨 Sır SİLİNMEZ: bu bacağın işi "wifi şifresi X" cümlesini bilgiye
    // çevirmektir. Uyarı KARARIN VERİLECEĞİ YERE konur, metne değil.
    expect(sensitiveClassesIn("Sorularınız için 0532 118 4477 numarasını arayın.")).toContain("phone");
    expect(sensitiveClassesIn("Bana host.lale@example.com adresinden yazın.")).toContain("email");
    expect(sensitiveClassesIn("Rezervasyon numaranız HMX8842193.")).toContain("idNumber");
    // Karşı yön: sıradan bir wifi cevabı hassas SAYILMAZ (yoksa her öneri uyarılı olurdu).
    expect(sensitiveClassesIn("Ağ adı LaleApt, şifre 12345678.")).toEqual([]);
  });

  it("öneri hassas sınıfları TAŞIR (uyarı host'a ulaşsın)", () => {
    const out = buildKbSuggestionsFromHistory([
      ...turn("Otopark var mı?", "Otopark altta; sorun olursa 0532 118 4477 arayın.", { conversationId: "cA" }),
      ...turn("park yeri var mı", "Otopark altta; sorun olursa 0532 118 4477 arayın.", { conversationId: "cB" }),
    ]);
    expect(out[0].sensitiveClasses).toContain("phone");
    expect(out[0].answer, "içerik bozulmadı").toContain("0532");
  });

  it("ad verilmezse metin DEĞİŞMEZ (uydurma ikame yok)", () => {
    const out = buildKbSuggestionsFromHistory([
      ...turn("wifi şifresi?", "Merhaba Ayşe, şifre 12345678.", { conversationId: "cA" }),
      ...turn("wifi şifresi?", "Merhaba Ayşe, şifre 12345678.", { conversationId: "cB" }),
    ]);
    expect(out[0].answer).toContain("Ayşe");
  });
});

// ---------------------------------------------------------------------------
// 🚨 EŞLEŞTİRME DÜRÜSTLÜĞÜ (dış denetim 09-18, bulgu 1 — KODDA DOĞRULANDI).
//
// `Message.replyToMessageId` YOK, yani "bu cevap ŞU soruya verildi" bağı bir
// ÇIKARIMDIR. Çıkarımın yanlış olduğu ÜÇ ölçülmüş sınıf vardı ve üçünde de
// bedel aynı: YANLIŞ KATEGORİDE ONAYLI BİLGİ. Fail-closed yön seçildi —
// belirsizse öneri ÜRETİLMEZ (öneri kaybı ucuz, yanlış bilgi pahalı).
// ---------------------------------------------------------------------------
describe("🚨 eşleştirme dürüstlüğü — belirsizse ÖNERİ YOK", () => {
  it("🚨 ARAYA GİREN FARKLI KONU cevabı ÇALAMAZ (wifi cevabı parking'e yazılıyordu)", () => {
    // Ölçülen senaryo: misafir önce wifi sorar, sonra otopark sorar, host
    // wifi'yi cevaplar. Eski kod "en yakın önceki misafir mesajı" dediği için
    // cevabı OTOPARK sorusuyla eşleştiriyor ve şifreyi `parking` kategorisine
    // yazıyordu.
    const conv = (id: string) => [
      msg({ direction: "inbound", body: "Wifi şifresi nedir?", conversationId: id }),
      msg({ direction: "inbound", body: "Otopark var mı?", conversationId: id }),
      msg({ direction: "outbound", body: "Şifre 12345678.", conversationId: id }),
    ];
    const out = buildKbSuggestionsFromHistory([...conv("cA"), ...conv("cB")]);
    expect(out, "iki AYRI bilgi kategorisi bekliyor → hangisine cevap verildiği BİLİNEMEZ").toEqual([]);
  });

  it("selamlama araya girse bile TEK bilgi kategorisi varsa eşleşme SÜRER", () => {
    // Karşı yön: "Merhaba" + "wifi şifresi?" YAYGIN ve belirsiz DEĞİL —
    // selamlama hiçbir bilgi kategorisine eşlenmez, geriye tek aday kalır.
    const conv = (id: string) => [
      msg({ direction: "inbound", body: "Merhaba, iyi akşamlar.", conversationId: id }),
      msg({ direction: "inbound", body: "Wifi şifresi nedir?", conversationId: id }),
      msg({ direction: "outbound", body: "Şifre 12345678.", conversationId: id }),
    ];
    const out = buildKbSuggestionsFromHistory([...conv("cA"), ...conv("cB")]);
    expect(out.map((s) => s.category)).toEqual(["wifi"]);
  });

  it("🚨 PEŞ PEŞE HOST MESAJI TEK CEVAPTIR — tek olay eşiği geçemez", () => {
    // Host cevabı iki mesaj hâlinde yazıyor. Eski kod bunu İKİ TEKRAR sayıyor
    // ve `minOccurrences=2` eşiği TEK OLAYLA geçiliyordu.
    const out = buildKbSuggestionsFromHistory([
      msg({ direction: "inbound", body: "Wifi şifresi nedir?", conversationId: "cA" }),
      msg({ direction: "outbound", body: "Şifre 12345678.", conversationId: "cA" }),
      msg({ direction: "outbound", body: "Ağ adı LaleNet.", conversationId: "cA" }),
    ]);
    expect(out, "tek soru + iki parçalı cevap = BİR olay").toEqual([]);
  });

  it("peş peşe host mesajlarının İÇERİĞİ birleşir (bilgi kaybolmaz)", () => {
    const conv = (id: string) => [
      msg({ direction: "inbound", body: "Wifi şifresi nedir?", conversationId: id }),
      msg({ direction: "outbound", body: "Şifre 12345678.", conversationId: id }),
      msg({ direction: "outbound", body: "Ağ adı LaleNet.", conversationId: id }),
    ];
    const out = buildKbSuggestionsFromHistory([...conv("cA"), ...conv("cB")]);
    expect(out).toHaveLength(1);
    expect(out[0].answer).toContain("12345678");
    expect(out[0].answer, "ikinci parça da bilgidir").toContain("LaleNet");
    expect(out[0].occurrences, "iki KONUŞMA = iki olay").toBe(2);
  });

  it("🚨 ZAMAN PENCERESİ — günler sonraki PROAKTİF host mesajı cevap sayılmaz", () => {
    // Ölçülen kusur: host çıkıştan günler sonra "değerlendirme bırakır mısınız?"
    // yazıyor; arada misafir mesajı olmadığı için günler önceki soruyla
    // eşleşiyordu.
    const far = (id: string) => {
      const q = msg({ direction: "inbound", body: "Otopark var mı?", conversationId: id });
      const a = msg({ direction: "outbound", body: "Değerlendirme bırakır mısınız?", conversationId: id });
      a.createdAt = new Date(q.createdAt.getTime() + 40 * 86_400_000);
      return [q, a];
    };
    const out = buildKbSuggestionsFromHistory([...far("cA"), ...far("cB")]);
    expect(out).toEqual([]);
  });

  it("🚨 GÖSTERİLEN ÇİFT GERÇEK ÇİFTTİR — en yeni cevabın KENDİ sorusu basılır", () => {
    // Eski kod kovayı İLK açan soruyu saklıyor ama EN YENİ cevabı basıyordu:
    // ekranda hiç var olmamış bir çift görünüyordu.
    const out = buildKbSuggestionsFromHistory([
      ...turn("wifi şifresi ESKİSORU nedir?", "Şifre ESKI1111.", { conversationId: "cA" }),
      ...turn("wifi parolası YENİSORU ne acaba", "Şifre YENI2222.", { conversationId: "cB" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].answer).toContain("YENI2222");
    expect(out[0].exampleQuestion, "gösterilen soru, gösterilen cevabın kendi sorusu olmalı").toContain("YENİSORU");
    expect(out[0].exampleQuestion).not.toContain("ESKİSORU");
  });

  it("occurrences KONUŞMA sayar, MESAJ değil (aynı misafir iki kez sorarsa bir olay)", () => {
    const out = buildKbSuggestionsFromHistory([
      ...turn("wifi şifresi?", "Şifre AAA.", { conversationId: "cA" }),
      ...turn("wifi şifresi tekrar?", "Şifre AAA.", { conversationId: "cA" }),
    ]);
    expect(out, "tek konuşma = tek olay; eşik 2 geçilmemeli").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 🚨 MEVCUT KB'YE KARŞI FİLTRE (dış denetim 09-18, bulgu 2).
// `existingKb` çekiliyordu ama YALNIZ şablon bacağına veriliyordu → host öneriyi
// ekledikten sonra "Yeniden tara" deyince AYNI öneri geri geliyor, ikinci kez
// eklenirse aynı kategoride ÇELİŞKİLİ iki aktif kalem oluşuyordu.
// ---------------------------------------------------------------------------
describe("🚨 mevcut KB ile çakışan öneri ÜRETİLMEZ", () => {
  const twice = [
    ...turn("wifi şifresi?", "Şifre AAA.", { conversationId: "cA" }),
    ...turn("wifi şifresi?", "Şifre AAA.", { conversationId: "cB" }),
  ];

  it("aynı mülk+kategoride AI'nın okuyabildiği kalem varsa öneri düşer", () => {
    const out = buildKbSuggestionsFromHistory(twice, [], {
      existingKb: [{ propertyId: "p1", category: "wifi" }],
    });
    expect(out).toEqual([]);
  });

  it("BAŞKA mülkün aynı kategorisi bastırmaz (kapsam mülk düzeyinde)", () => {
    const out = buildKbSuggestionsFromHistory(twice, [], {
      existingKb: [{ propertyId: "p2", category: "wifi" }],
    });
    expect(out.map((s) => s.category)).toEqual(["wifi"]);
  });

  it("existingKb verilmezse davranış BİREBİR eski (sessiz daralma yok)", () => {
    expect(buildKbSuggestionsFromHistory(twice).map((s) => s.category)).toEqual(["wifi"]);
  });
});

// ---------------------------------------------------------------------------
// 🚨 KVKK — MİSAFİRİN KENDİ METNİ DE MASKELENİR (dış denetim 09-18, bulgu 3).
// `maskGuestName` YALNIZ `answer`a uygulanıyordu; `exampleQuestion` misafirin
// HAM metnidir ve aynı ekranda gösterilir.
// ---------------------------------------------------------------------------
describe("🚨 KVKK — örnek soru da maskelenir", () => {
  it("exampleQuestion'daki misafir adı {isim}'e çevrilir", () => {
    const out = buildKbSuggestionsFromHistory(
      [
        ...turn("Ben Ayşe, wifi şifresi nedir?", "Şifre 12345678.", { conversationId: "cA" }),
        ...turn("Ben Ayşe, wifi şifresi nedir?", "Şifre 12345678.", { conversationId: "cB" }),
      ],
      [],
      { guestNamesByConversation: { cA: "Ayşe Yılmaz", cB: "Ayşe Yılmaz" } },
    );
    expect(out).toHaveLength(1);
    expect(out[0].exampleQuestion, "misafirin adı host'un ekranına ham gidiyor").not.toContain("Ayşe");
    expect(out[0].exampleQuestion).toContain("{isim}");
  });
});

describe("kırpma ve iz", () => {
  it("uzun cevap kelime sınırında kırpılır", () => {
    const long = "Otopark bilgisi: " + "detay ".repeat(500);
    const out = buildKbSuggestionsFromHistory([
      ...turn("Otopark var mı?", long, { conversationId: "cA" }),
      ...turn("Otopark var mı?", long, { conversationId: "cB" }),
    ]);
    expect(out[0].answer.length).toBeLessThanOrEqual(SUGGESTION_MAX_CHARS + 1);
    expect(out[0].answer.endsWith("…")).toBe(true);
  });

  it("kaynak mesaj kimlikleri ve örnek soru taşınır (iz + bağlam)", () => {
    const out = buildKbSuggestionsFromHistory([
      ...turn("Otopark var mı?", "Bina altında ücretsiz.", { conversationId: "cA" }),
      ...turn("park yeri var mı", "Bina altında ücretsiz.", { conversationId: "cB" }),
    ]);
    expect(out[0].sourceMessageIds).toHaveLength(2);
    expect(out[0].exampleQuestion.length).toBeGreaterThan(0);
    expect(out[0].lastAnsweredAt instanceof Date).toBe(true);
  });
});
