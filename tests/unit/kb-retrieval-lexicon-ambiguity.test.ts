import { describe, it, expect } from "vitest";
import { expandQuery, matchConcepts } from "@/lib/ai/retrieval/lexicon";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { contentStems, stem } from "@/lib/ai/retrieval/text";
import { fieldTimeHits } from "@/lib/ai/retrieval/time-fields";
import { neutralPadding } from "../helpers/kb-padding";

// ---------------------------------------------------------------------------
// BELİRSİZ TEK KELİME KAVRAMI TETİKLEMEZ (kurucu onayı 09-26 "ikisi birden"; dış inceleme + ölçüm).
//
// Sözlükte `terms` hem tespit hem genişletmeydi: tek başına birden çok konuyu gösterebilen sözcük yanlış kavramı
// tetikliyordu (ölçüldü, 40 kalemlik bilgi tabanı): "Daire çok sıcak" → sıcak su · "Power outage" / "Elektrik
// kesintisi" → su kesintisi · "bagajı depoya" → su deposu · "eşyalarımızı bırakabilir miyiz" → kayıp eşya ·
// "merdivenle mi çıkılıyor" / "alarm kodu" → yangın (yangın kalemi asansör / alarm kaleminin ÖNÜNE geçiyordu).
// Bu sözcükler artık `expandOnly`: kavram kalıpla ("sıcak su", "su kesintisi", "duman alarmı") tespit edilince yine
// genişletmeye girer. Saat alanı kuralının "başka konu" sezgisi onları YİNE görür (`loose`) — davranışı aynı.
// ---------------------------------------------------------------------------

const ids = (q: string) => matchConcepts(contentStems(q)).map((m) => m.concept.id);

describe("belirsiz tek kelime kavramı TEK BAŞINA tetiklemez", () => {
  const cases: [string, string][] = [
    ["Daire çok sıcak", "hot_water"],
    ["Power outage in the apartment", "water_cut"],
    ["Elektrik kesintisi var", "water_cut"],
    ["Bagajlarımızı depoya bırakabilir miyiz?", "water_cut"],
    ["Eşyalarımızı girişten önce bırakabilir miyiz?", "lost"],
    ["Daireye merdivenle mi çıkılıyor?", "fire"],
    ["Alarm kodu ne?", "fire"],
  ];
  for (const [q, not] of cases) {
    it(`"${q}" → ${not} DEĞİL`, () => {
      expect(ids(q)).not.toContain(not);
    });
  }

  it("doğru kavram yine tespit edilir (klima, elektrik)", () => {
    expect(ids("Daire çok sıcak")).toContain("ac");
    expect(ids("Power outage in the apartment")).toContain("power");
    expect(ids("Elektrik kesintisi var")).toContain("power");
  });
});

describe("GERİ ÇAĞIRMA — kalıpla tespit kaybolmaz", () => {
  const cases: [string, string][] = [
    ["Sıcak su gelmiyor", "hot_water"],
    ["Suyun sıcağı gelmiyor", "hot_water"],
    ["Su kesintisi var mı?", "water_cut"],
    ["No water in the apartment", "water_cut"],
    ["Is there a water outage?", "water_cut"],
    ["Su deposu var mı?", "water_cut"],
    ["Duman alarmı ötüyor", "fire"],
    ["Smoke alarm is beeping", "fire"],
    ["Yangın merdiveni nerede?", "fire"],
    ["Eşyamı unuttum", "lost"],
    ["I left something in the flat", "lost"],
  ];
  for (const [q, concept] of cases) {
    it(`"${q}" → ${concept}`, () => {
      expect(ids(q)).toContain(concept);
    });
  }

  it("kalıpla tespit edilen kavram yalnız-genişletme sözcüklerini YİNE ekler", () => {
    const exp = (q: string) => expandQuery(contentStems(q)).expansion;
    expect([...exp("No water in the apartment").keys()]).toEqual(expect.arrayContaining([stem("kesinti"), stem("outage"), stem("depo")]));
    expect(exp("hot water please").has(stem("sicak"))).toBe(true);
    expect(exp("Duman alarmı ötüyor").has(stem("merdiven"))).toBe(true);
    expect(exp("I left something in the flat").has(stem("esya"))).toBe(true);
  });
});

describe("saat alanı kuralı DEĞİŞMEZ — bu sözcükler 'başka konu' sayılmaya devam eder", () => {
  // Başlığın alanı, başka bir konudan söz eden cümleciğe ÖDÜNÇ verilmez (sahte saat çelişkisi = gereksiz devir).
  const cases: [string, string][] = [
    ["Giriş", "Merdiven kapısı 23:00'te kilitlenir."],
    ["Giriş", "Alarm 22:00'de kurulur."],
    ["Giriş", "Eşyalarınızı 12:00'den sonra bırakabilirsiniz."],
    ["Giriş", "Depo 06:00'da açılır."],
    ["Giriş", "Kesinti 10:00'da biter."],
    ["Çıkış", "Sıcak su 07:00'de gelir."],
  ];
  for (const [title, clause] of cases) {
    it(`"${title}" başlığında "${clause}" giriş/çıkış saati sayılmaz`, () => {
      expect(fieldTimeHits(title, clause)).toEqual([]);
    });
  }

  it("gerçek saat hâlâ atfedilir (vakumlu değil)", () => {
    expect(fieldTimeHits("Giriş", "Giriş 14:00'ten sonradır.")).toEqual([
      expect.objectContaining({ field: "checkin", time: "14:00" }),
    ]);
  });
});

describe("seçim: doğru kalem yanlış kavramın kalemine yenilmez (40 kalemlik bilgi tabanı)", () => {
  const t0 = Date.UTC(2026, 0, 1);
  const real = [
    { id: "hotwater", category: "general", title: "Sıcak su", content: "Sıcak su için kombi mutfak dolabının içinde. Kombi açık kalmalı; su 5 dakikada ısınır." },
    { id: "watercut", category: "general", title: "Su kesintisi", content: "Mahallede su kesintisi olursa binanın su deposu birkaç saat yeter." },
    { id: "power", category: "general", title: "Elektrik", content: "Elektrik giderse sigorta kutusu kapının yanında; şalteri yukarı kaldırın." },
    { id: "elevator", category: "general", title: "Asansör", content: "Binada asansör var, daire 4. katta." },
    { id: "fire", category: "general", title: "Yangın güvenliği", content: "Yangın söndürücü mutfakta; yangın merdiveni koridorun sonunda. Duman alarmı öterse pencereyi açın." },
    { id: "alarm", category: "general", title: "Alarm", content: "Dairede hırsız alarmı yok; bina girişinde kamera var." },
    { id: "wifi", category: "wifi", title: "Wi-Fi", content: "Ağ adı Lale-5G, şifre modemin altında yazıyor." },
  ];
  const items = [...real.map((r, i) => ({ ...r, updatedAt: new Date(t0 + i * 60_000) })), ...neutralPadding(33, t0)];
  const picked = (q: string) =>
    selectKbForPrompt({ items, guestMessage: q, mode: "hybrid" }).items.map((x) => x.id).filter((id) => !id.startsWith("pad_"));

  it("'Daireye merdivenle mi çıkılıyor?' → asansör yangından ÖNCE", () => {
    const p = picked("Daireye merdivenle mi çıkılıyor?");
    expect(p[0]).toBe("elevator");
  });

  it("'Alarm kodu ne?' → alarm kalemi yangından ÖNCE", () => {
    const p = picked("Alarm kodu ne?");
    expect(p.indexOf("alarm")).toBeLessThan(p.indexOf("fire") === -1 ? Infinity : p.indexOf("fire"));
    expect(p[0]).toBe("alarm");
  });

  it("'Power outage in the apartment' → yalnız elektrik; su kesintisi isteme GİRMEZ", () => {
    expect(picked("Power outage in the apartment")).toEqual(["power"]);
  });
});
