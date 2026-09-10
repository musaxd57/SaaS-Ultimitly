import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType } from "@/lib/ai/fallback";
import { deriveMessageSignal } from "@/modules/intelligence/signals/derive";

// ---------------------------------------------------------------------------
// TÜRKÇE OLUMSUZ-FİİL ŞİKÂYET BOŞLUĞU (docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md)
//
// Ölçülen tablo (09-08): "Sıcak su yok" complaint, "Sıcak su gelmiyor" general —
// aynı şikâyet, fiil değişince sınıf değişiyordu; dil paritesi de bozuktu
// (EN "no heating" var, TR "ısıtma gelmiyor" yok). Bu dosya o tabloyu
// SÖZLEŞME olarak pinler; golden set çiftleri (tehdit + övgü tuzağı) ayrı.
//
// İNCELEME TURU (09-10, ajan — kod-doğrulandı): ilk sürümde altı kalıp ÇIPLAKTI
// (bozuldu/bozulmuş/arızalı/ısınmıyor/blackout/no heat) ve "elektrik yok",
// "cereyan yok", "elektrik kesintisi", "power cut" gerçek yanlış pozitif üretiyordu
// ("Hava bozuldu", "blackout curtains", "Otoparkta elektrik yok mu, şarj için priz
// var mı?"). Bedel: oto-yanıt kapanır + host'a "Sorunlu" e-postası + V1 negatif
// sinyal. Düzeltme: arıza fiilleri CİHAZ ADIYLA AYNI MESAJDA olmalı (cihaz kuralı),
// kalan kalıplar çapalandı, "-yo" gövdeleri ve zarf çapaları eklendi.
// ---------------------------------------------------------------------------

/** [mesaj, intent, riskType] — satır başına TEK beklenen değer (gevşek `toContain` yok). */
const CONTRACT: [string, string, string | null][] = [
  ["Sıcak su gelmiyor, duş soğuk.", "complaint", "complaint"],
  ["Su akmıyor.", "complaint", "complaint"],
  ["Isıtma gelmiyor.", "complaint", "complaint"],
  ["Elektrikler gitti.", "complaint", "complaint"],
  // 🚨 riskType safety_emergency'nin sebebi KİLİT AĞI DEĞİL: `foldTurkishAscii("açıl") = "acil"` ve
  // SAFETY_CRITICAL_WORDS çıplak "acil" altdizi eşleşir (ölçüldü 09-10: "Havuz ne zaman açılıyor?" da
  // safety_emergency). Bu tur o ağa DOKUNMADI (ayrı iş #51); satır bugünkü davranışı dürüstçe pinler.
  ["Kapı açılmıyor.", "complaint", "safety_emergency"],
  ["Kilit açılmadı.", "complaint", "safety_emergency"],
  ["Kapı kapanmıyor.", "complaint", "complaint"],
  ["Klimadan soğuk hava gelmiyor.", "complaint", "complaint"],
  ["Sıcak su yok.", "complaint", "complaint"],
  ["Klima bozuk, çalışmıyor.", "complaint", "complaint"],
  // Arıza ailesi — CİHAZ KURALI: fiil (bozuldu/bozulmuş/arızalı/arızalandı) + cihaz adı aynı mesajda.
  ["Buzdolabı bozuldu.", "complaint", "complaint"],
  ["Çamaşır makinesi bozulmuş.", "complaint", "complaint"],
  ["Klimamız bozuldu.", "complaint", "complaint"],
  ["Kombimiz arızalandı.", "complaint", "complaint"],
  ["Televizyon arızalı.", "complaint", "complaint"],
  // Araya zarf giren doğal biçimler + konuşma dili "-yo"
  ["Sıcak su hiç gelmiyor.", "complaint", "complaint"],
  ["Su hiç akmıyor.", "complaint", "complaint"],
  ["Sıcak su gelmiyo.", "complaint", "complaint"],
  ["Su akmıyo, duş çalışmıyo.", "complaint", "complaint"],
  ["Kombi hiç yanmıyor.", "complaint", "complaint"],
  ["Elektrik hâlâ yok.", "complaint", "complaint"],
  // EN ikizi olup TR'de olmayanlar (parite): sıkışma / tıkanma / sızıntı
  ["Kapı sıkıştı, açamıyoruz.", "complaint", "complaint"],
  ["Tuvalet tıkandı.", "complaint", "complaint"],
  ["Lavabo tıkalı.", "complaint", "complaint"],
  ["Musluk damlatıyor.", "complaint", "complaint"],
  // Büyük harf / ASCII yazım (tr katlama + ASCII katlama) — listede ASCII ikizi YOK,
  // `includesAnyFold` kelimeyi de katlar; bu satırlar o sözleşmeyi pinler.
  ["ELEKTRİKLER GİTTİ", "complaint", "complaint"],
  ["isitma gelmiyor", "complaint", "complaint"],
  ["kapi acilmiyor", "complaint", "safety_emergency"],
  ["isiklar yanmiyor", "complaint", "complaint"],
];

/** [mesaj, beklenen intent | null (= complaint olmasın, başka ne olursa)] */
const TRAPS: [string, string | null][] = [
  ["Yarın gelmiyoruz, ertesi gün geleceğiz.", null],
  ["Plaja gittik, her şey harikaydı!", null],
  ["Eksik bir şey yok, konaklama mükemmeldi.", null],
  ["Sıcak su hemen geliyor, duş süperdi, teşekkürler!", null],
  ["Hiçbir arıza yaşamadık, teşekkürler.", null],
  ["Giriş çok kolaydı, teşekkürler.", null],
  ["Sorun yok, her şey için teşekkürler!", null],
  ["No worries, the power adapter you left was perfect!", null],
  ["The door opened right away with the code, all good.", null],
  // İnceleme turu (09-10) — ilk sürümde HEPSİ complaint idi (ölçüldü)
  ["Hava bozuldu, bugün evde kalıyoruz.", null],
  ["Midem bozuldu, en yakın eczane nerede?", "location"],
  ["Planımız bozuldu, bir gün erken çıkacağız.", "early_departure"],
  ["Uçuş programımız bozuldu, geç saatte gelebilir miyiz?", null],
  ["Moralim bozuldu ama evle ilgisi yok, her şey harika.", null],
  ["Do you have blackout curtains in the bedroom?", null],
  ["Is there no heated pool in winter?", null],
  ["No heat wave this week, lovely weather.", null],
  ["Otoparkta elektrik yok mu, şarj için priz var mı?", "parking"],
  ["Odada cereyan yok, rahat uyuduk, teşekkürler.", null],
  ["Yerden ısıtma yok mu, halı var mı?", null],
  ["Havuz ısınmıyor mu hiç, ısıtmalı mı?", null],
  ["Elektrik kesintisi olursa ne yapmalıyız, jeneratör var mı?", null],
  ["Bölgede planlı elektrik kesintisi var mı?", null],
  ["Are power cuts common here? Should we bring a torch?", null],
  ["There is no water dispenser, should we buy bottles?", null],
  // Cihaz kuralının iki yarısı tek başına YETMEZ
  ["Bozuldu.", null],
  ["Arızalı.", null],
  ["Klima var mı?", null],
];

describe("classifyFallback — sözleşme tablosu (09-08 ölçümü → 09-10 sözleşme; inceleme turuyla daraltıldı)", () => {
  it.each(CONTRACT)("%s → intent %s / riskType %s", (m, intent, risk) => {
    const r = classifyFallback(m);
    expect(r.intent).toBe(intent);
    expect(r.isComplaint).toBe(intent === "complaint");
    expect(detectRiskType(m)).toBe(risk);
  });

  it.each(TRAPS)("TUZAK complaint DEĞİL: %s (intent %s)", (m, intent) => {
    const r = classifyFallback(m);
    expect(r.intent).not.toBe("complaint");
    if (intent) expect(r.intent).toBe(intent);
    expect(detectRiskType(m)).not.toBe("complaint");
  });

  it("bilinçli kararlar KORUNUR: 'İnternet gelmiyor' wifi (bilgi tabanından yanıtlanır), 'çekmiyor' complaint değil; internet/wifi cihaz kuralında YOK", () => {
    expect(classifyFallback("İnternet gelmiyor.").intent).toBe("wifi");
    expect(classifyFallback("Wifi çekmiyor odada.").intent).toBe("wifi");
    expect(classifyFallback("İnternet bozuldu.").intent).toBe("wifi");
    // Modem bir cihazdır: "modem bozuldu" şikâyettir (KB'den çözülmez, host müdahalesi).
    expect(classifyFallback("Modem bozuldu.").intent).toBe("complaint");
  });

  it("EN paritesi: elektrik / kesinti / kapı / su / tıkanma / sızıntı", () => {
    for (const m of [
      "There is no electricity in the flat.",
      "Power outage since this morning.",
      "There's a power cut since noon.",
      "There's a power cut, nothing works.",
      "Total blackout in the flat.",
      "The door won't open with the code.",
      "There is no running water.",
      "The toilet is clogged.",
      "The tap is leaking.",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });

  it("BİLİNEN SINIR (bilerek pinli): araya iki+ kelime giren biçim ve çözülmüş bildirim — kelime ağı sözdizimi bilmez", () => {
    // Ağ bitişik eşleşir (allowWordGap=false; gevşetme ÖLÇÜLDÜ ve reddedildi: olumsuzlama parçacığını
    // isminden koparıp "No problem, the heating was great!"ı da yakalıyordu). Bu iki cümle model yoluna kalır.
    expect(classifyFallback("Elektrikler dün gece gitti.").intent).not.toBe("complaint");
    expect(classifyFallback("Kapı bir türlü açılmıyor.").intent).not.toBe("complaint");
    // Çözülmüş bildirim: ağ "çözüldü"yü ayırt etmez → complaint kalır (yön güvenli: host görür, oto-yanıt gitmez).
    expect(classifyFallback("Sigorta attı ama kaldırdık, sorun yok.").intent).toBe("complaint");
  });
});

describe("V1 sinyal — olumsuz fiilli şikâyet artık sinyal ÜRETİR (eskiden general → null)", () => {
  const msg = (body: string) => ({
    id: "m1",
    direction: "inbound",
    authorType: "guest",
    body,
    createdAt: new Date("2026-09-10T09:00:00Z"),
    conversation: { id: "c1", propertyId: "p1", reservationId: "r1" },
  });

  it("'Sıcak su gelmiyor, duş soğuk.' → complaint / negative / 0.7", () => {
    const s = deriveMessageSignal("org1", msg("Sıcak su gelmiyor, duş soğuk."), null);
    expect(s).not.toBeNull();
    expect(s!.category).toBe("complaint");
    expect(s!.sentiment).toBe("negative");
    expect(s!.severity).toBe(0.7);
    // Metin sinyale TAŞINMAZ (PII'siz).
    expect(JSON.stringify(s)).not.toMatch(/Sıcak su/);
  });

  it("övgü ve yanlış-pozitif tuzağı sinyal üretmez (null kalır) — sahte PropertyMemory örüntüsü YOK", () => {
    expect(deriveMessageSignal("org1", msg("Sıcak su hemen geliyor, duş süperdi, teşekkürler!"), null)).toBeNull();
    expect(deriveMessageSignal("org1", msg("Hava bozuldu, bugün evde kalıyoruz."), null)).toBeNull();
  });
});
