import { describe, it, expect } from "vitest";
import {
  FOREIGN_SURFACE_FORMS,
  foreignTokens,
  matchForeignConcepts,
} from "@/lib/ai/retrieval/lexicon-foreign";
import { CONCEPTS, matchConcepts } from "@/lib/ai/retrieval/lexicon";
import { contentStems, isStopword } from "@/lib/ai/retrieval/text";
import { selectKbForPrompt } from "@/lib/ai/retrieval/select";
import { neutralPadding } from "../helpers/kb-padding";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { makeSyntheticKb } from "../helpers/kb-retrieval-synthetic";

// ---------------------------------------------------------------------------
// YABANCI DİL YÜZEY BİÇİMLERİ (DE/FR/ES/RU/AR) — RAG çok dilli dilim (09-24).
//
// Ölçüm (ajan, 400 yabancı sorgu, üç KB): cevap cümlesi isteme %63 → %97, yanlış dar seçim 48 → 9,
// blok ~%81 küçük; Türkçe/İngilizce seçim BİREBİR aynı. Bu dosya o sonucun sözleşmesidir:
//  · her dilde kavram tespiti + çekim biçimleri (Kiril/Arapça/Latin kuralları ayrı)
//  · ölçülmüş çarpışma tuzakları ASLA eşleşmez
//  · veri pinleri (bilinmeyen kavram, boş girdi, 2 harflik Latin girdi yok)
//  · seçici: Rusça/Arapça soru artık "hiç isabet yok" geri çekilmesine DÜŞMEZ, doğru kalem önde
//  · Türkçe/İngilizce seçim sözlük açık ve kapalı BİREBİR aynı (ölçek harness'ının tüm soruları)
// ---------------------------------------------------------------------------

const ids = (text: string) => matchForeignConcepts(text).map((m) => m.concept.id);

describe("dil başına kavram tespiti", () => {
  it.each([
    // Almanca
    ["Wie lautet das WLAN-Passwort?", ["wifi", "credentials"]],
    ["Gibt es einen Parkplatz in der Nähe?", ["parking"]],
    ["Wo sind die Handtücher?", ["towels"]],
    ["Wann ist die Abreise?", ["checkout"]],
    ["Wo steht die Mülltonne?", ["trash"]],
    // Fransızca
    ["Quel est le mot de passe du wifi ?", ["credentials"]],
    ["Où faut-il jeter les ordures ?", ["trash"]],
    ["Est-ce qu'il y a une piscine ?", ["pool"]],
    ["La télécommande de la clim ne marche pas", ["ac", "tv"]],
    // İspanyolca
    ["¿Dónde están las toallas?", ["towels"]],
    ["¿Hay aparcamiento?", ["parking"]],
    ["¿A qué hora es la salida?", ["checkout"]],
    ["¿Cuál es la contraseña?", ["credentials"]],
    // Rusça
    ["Где можно припарковаться?", ["parking"]],
    ["Где полотенца?", ["towels"]],
    ["Какой пароль от вайфая?", ["wifi", "credentials"]],
    ["Во сколько выезд?", ["checkout"]],
    // Arapça
    ["أين المناشف؟", ["towels"]],
    ["هل يوجد موقف للسيارات؟", ["parking"]],
    ["كم كلمة السر للواي فاي؟", ["wifi", "credentials"]],
    ["هل يوجد مسبح؟", ["pool"]],
  ])("%s → %j", (text, expected) => {
    const got = ids(text);
    for (const e of expected) expect(got, text).toContain(e);
  });
});

describe("çekim biçimleri (yazı sistemine göre kural)", () => {
  it.each([
    ["полотенце", "towels"],
    ["полотенца", "towels"],
    ["полотенец", "towels"],
    ["припарковаться", "parking"], // Kiril: ≥5 harfli girdi İÇERME ile de eşleşir
    ["المناشف", "towels"], // Arapça: "ال" bitişik eki sökülür
    ["بالمسبح", "pool"],
    ["للمطار", "airport"],
    ["منشفة", "towels"], // te-merbuta → he katlaması
    ["serviettes", "towels"], // Latin: önek işaretli girdi
    ["toallas", "towels"],
    ["Handtücher", "towels"], // aksan katlaması
    ["Mülltonne", "trash"],
    ["MULLTONNE", "trash"],
    ["télécommande", "tv"],
    ["telecommande", "tv"], // aksansız yazım
    ["heißes Wasser", "hot_water"], // ß → ss
    ["ПАРОЛЬ", "credentials"], // büyük harf
    ["Wann kommt die Müllabfuhr?", "trash"], // `*` önek: Almanca bileşik isim
    // Mutasyon turu (09-24) — dördü de hayatta kalan bir mutantı yakalar:
    ["Sind Hunde erlaubt?", "pets"], // Latin kapalı ek kümesi: hund + e
    ["Les chiens sont acceptés ?", "pets"], // chien + s
    ["أين المنشفه؟", "towels"], // misafir te-merbutayı "ه" yazar; girdi "ة" — iki yön birleşmeli
    ["Gibt es heisses Wasser?", "hot_water"], // İsviçre/ASCII yazımı: ß yerine ss
    ["Wo ist die Strassenbahn?", "transit"],
    ["هل يمكنني إحضار كلبي؟", "pets"], // Arapça iyelik eki: önek eşleşmesi (tam eşitlik YETMEZ)
    ["أين مناشفكم؟", "towels"],
    // İnceleme 09-24: umlaut'suz Almanca klavye (ue/oe/ae) + tam-kelime girdilerin olağan çekimleri.
    ["Wo sind die Handtuecher?", "towels"],
    ["Wohin mit dem Muell?", "trash"],
    ["Ist der Kuehlschrank leer?", "fridge"],
    ["Wo ist der Schluessel?", "keys"],
    ["Свет погас", "power"],
    ["Куда выбросить отходы?", "trash"],
    ["Далеко до моря?", "beach"],
    ["Есть кафе рядом?", "restaurant"],
    ["أين البواب؟", "doorman"],
    ["كيف أشغل الفرن؟", "stove"],
    ["كم يبعد البحر؟", "beach"],
    ["أين أجد سيارة أجرة؟", "taxi"],
    ["Wie hoch ist die Parkplatzgebühr?", "parking"],
  ])("%s → %s", (text, concept) => {
    expect(ids(text)).toContain(concept);
  });
});

describe("🚨 ölçülmüş çarpışma tuzakları ASLA eşleşmez", () => {
  it.each([
    // Latin uzunluk-önek kuralı REDDEDİLDİ: bu üçü onunla çarpışıyordu.
    ["department store", "checkout"],
    ["we are stranded", "beach"],
    ["hospitality", "emergency"],
    // Girdisi bilerek ÇIKARILAN kelimeler.
    ["four people", "stove"],
    ["QR chat", "pets"],
    ["cafe nearby", "coffee"],
    ["à partir de 15h", "checkout"],
    ["стиральная машина", "parking"],
    ["пробки на дороге", "power"],
    ["Are there blackout drapes?", "towels"],
    // Çok kelimeli girdi ARDIŞIK belirteç ister ("kein wasser").
    ["Kein Problem, das Wasser ist warm genug", "water_cut"],
    // İnceleme 09-24: önek/içerme kuralının ölçülmüş çarpışmaları (tam-kelime işaretiyle kapandı).
    ["Поезд отходит в 10", "trash"],
    ["Светлая комната", "power"],
    ["Кафельный пол", "restaurant"],
    ["Где купить морепродукты?", "beach"],
    ["أين البوابة؟", "doorman"],
    ["مطعم فرنسي قريب", "stove"],
    ["رحلة إلى البحرين", "beach"],
    // Türkçe (sözlük TÜM sorgularda koşar).
    ["Paradan kesinti var mı?", "transit"],
    ["Parke zemin mi?", "parking"],
  ])("%s ↛ %s", (text, concept) => {
    expect(ids(text)).not.toContain(concept);
  });

  it("KONTROL (tuzaklar vakumlu değil): aynı cümlelerin GERÇEK kavramı yine bulunur", () => {
    expect(ids("Wie lautet das Passwort?")).toEqual(["credentials"]); // "lautet" ≠ gürültü
    expect(ids("стиральная машина")).toContain("laundry");
  });

  it("Türkçe/İngilizce yaygın sorulara yabancı sözlük YENİ kavram eklemez (en çok aynı kavramı tekrar bulur)", () => {
    // "wi fi" girdisi `normalizeForRetrieval` birleşik yazım kuralıyla "wifi"ye iner → Türkçe
    // "Wi-Fi şifresi" de wifi kavramını iki yoldan bulur; kavram kimliğine göre birleştiği için zararsız.
    for (const q of [
      "Giriş saati kaçta?",
      "Havlu var mı?",
      "Otopark ücretli mi?",
      "Wi-Fi şifresi nedir?",
      "Where can I park?",
      "Is there a hair dryer?",
      "Can I have the code?",
      "Çöpü nereye atıyoruz?",
      "Salı günü gelebilir miyiz?",
      "Klima çalışmıyor",
    ]) {
      const own = new Set(matchConcepts(contentStems(q)).map((m) => m.concept.id));
      for (const id of ids(q)) expect(own.has(id), `${q}: ${id}`).toBe(true);
    }
  });
});

describe("veri pinleri", () => {
  const conceptIds = new Set(CONCEPTS.map((c) => c.id));
  const entries = Object.entries(FOREIGN_SURFACE_FORMS).flatMap(([k, v]) => v.map((e) => [k, e] as const));

  it("her anahtar mevcut bir kavramdır ve her girdi en az bir belirteç üretir", () => {
    for (const [k, e] of entries) {
      expect(conceptIds.has(k), k).toBe(true);
      expect(foreignTokens(e.replace(/\*$/, "")).length, `${k}: ${e}`).toBeGreaterThan(0);
    }
    // Anti-vakumluk: sözlük gerçekten dolu ve beş dili kapsıyor.
    expect(entries.length).toBeGreaterThan(500);
    expect(entries.some(([, e]) => /\p{Script=Cyrillic}/u.test(e))).toBe(true);
    expect(entries.some(([, e]) => /\p{Script=Arabic}/u.test(e))).toBe(true);
  });

  it("tek belirteçli Latin girdi durak kelime değildir ve 2 harften uzundur", () => {
    for (const [k, e] of entries) {
      const toks = foreignTokens(e.replace(/\*$/, ""));
      if (toks.length !== 1 || !/^[a-z0-9]+$/.test(toks[0])) continue;
      expect(toks[0].length, `${k}: ${e}`).toBeGreaterThan(2);
      expect(isStopword(toks[0]), `${k}: ${e}`).toBe(false);
    }
  });

  it("`*` (önek eşleşmesi) yalnız TEK belirteçli LATİN girdide", () => {
    for (const [k, e] of entries.filter(([, e]) => e.endsWith("*"))) {
      const toks = foreignTokens(e.slice(0, -1));
      expect(toks.length, `${k}: ${e}`).toBe(1);
      expect(toks[0], `${k}: ${e}`).toMatch(/^[a-z]+$/);
    }
  });

  it("`=` (tam kelime) yalnız TEK belirteçli girdide; `*` ile birlikte kullanılmaz", () => {
    const exact = entries.filter(([, e]) => e.endsWith("="));
    expect(exact.length).toBeGreaterThan(5);
    for (const [k, e] of exact) expect(foreignTokens(e.slice(0, -1)).length, `${k}: ${e}`).toBe(1);
  });

  it("ölçülüp ÇIKARILAN girdiler geri gelmedi", () => {
    const all = new Set(entries.map(([, e]) => e.replace(/\*$/, "")));
    for (const banned of ["машина", "пробки", "four", "chat", "café", "partir", "laut", "parada", "drap"]) {
      expect(all.has(banned), banned).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Seçici davranışı — nötr Türkçe KB (küçük-KB eşiğinin ÜSTÜNDE, 16 kalem).
// ---------------------------------------------------------------------------
const T0 = Date.UTC(2026, 8, 1, 10, 0, 0);
const KB = [
  ["wifi", "wifi", "İnternet", "Kablosuz ağın adı LaleNet, şifresi yönlendiricinin altındaki etikette yazar."],
  ["parking", "parking", "Otopark", "Binanın arka tarafında ücretsiz açık otopark vardır; araç için ayrılmış yer yoktur."],
  ["towels", "cleaning", "Havlu ve çarşaf", "Yedek havlular yatak odasındaki dolabın üst rafındadır. Çarşaflar alt çekmecede."],
  ["trash", "trash", "Çöp", "Çöp konteyneri bina girişinin solundadır. Geri dönüşüm kutusu mavi renklidir."],
  ["dishwasher", "faq", "Bulaşık makinesi", "Bulaşık makinesi tabletleri evyenin altındaki dolaptadır. Eko program iki saat sürer."],
  ["pool", "rules", "Havuz", "Havuz 09:00 ile 20:00 arasında açıktır. Havuz havlusu resepsiyondan alınır."],
  ["checkin", "checkin", "Giriş", "Giriş saat 15:00'ten itibarendir. Anahtar kutusunun kodu giriş günü paylaşılır."],
  ["checkout", "checkout", "Çıkış", "Çıkış saat 11:00'e kadardır. Anahtarı kutuya bırakmanız yeterlidir."],
  ["ac", "faq", "Klima", "Klima kumandası televizyon ünitesinin çekmecesindedir. Soğutma için kar tanesi simgesini seçin."],
  ["tv", "faq", "Televizyon", "Televizyonda uydu kanalları ve Netflix vardır; kumanda sehpadadır."],
  ["airport", "location", "Havalimanı", "Havalimanına taksiyle yaklaşık 45 dakikadır. Havaş durağı meydandadır."],
  ["noise", "rules", "Sessiz saatler", "Gece 23:00'ten sonra yüksek sesle müzik dinlemek ve parti yapmak yasaktır."],
  ["heating", "faq", "Isıtma", "Kombi mutfaktadır; petekler oda termostatından ayarlanır."],
  ["elevator", "faq", "Asansör", "Asansör tüm katlara çıkar; bebek arabası için rampa vardır."],
  ["grocery", "local_tips", "Market", "En yakın market köşedeki bakkaldır; büyük süpermarket beş dakika yürüme mesafesindedir."],
  ["pharmacy", "local_tips", "Eczane", "Nöbetçi eczane listesi apartman girişindeki panodadır."],
].map(([id, category, title, content], i) => ({ id, category, title, content, updatedAt: new Date(T0 + i * 60_000) }))
  // + nötr dolgu: üretimde ≤30 kalemlik KB'de seçim yapılmaz; mekanik 30'u aşan KB'de sınanır (kb-padding.ts).
  .concat(neutralPadding(16));

function firstId(guestMessage: string, foreign = true) {
  __resetKbIndexCache();
  const r = selectKbForPrompt({ items: KB, guestMessage, mode: "hybrid", sources: foreign ? {} : { foreign: false } });
  return { fb: r.evidence?.fb, first: r.items[0]?.id, ids: [...new Set(r.items.map((i) => i.id))] };
}

describe("seçici — yabancı soru artık doğru kaleme DARALIR", () => {
  it.each([
    ["Где можно припарковаться?", "parking"],
    ["Где полотенца?", "towels"],
    ["أين المناشف؟", "towels"],
    ["هل يوجد موقف للسيارات؟", "parking"],
    ["Wo sind die Handtücher?", "towels"],
    ["¿Dónde están las toallas?", "towels"],
  ])("%s → %s önde, geri çekilme YOK", (q, gold) => {
    expect(firstId(q)).toMatchObject({ fb: "none", first: gold });
  });

  it("🚨 Fransızca çöp sorusu bulaşık makinesine değil ÇÖP kalemine gider (eski yanlış dar seçim)", () => {
    const r = firstId("Où faut-il jeter les ordures ?");
    expect(r).toMatchObject({ fb: "none", first: "trash" });
  });

  it("KONTROL: sözlük kapalıyken aynı Rusça soru eşleşme bulamaz (kazanç sözlükten)", () => {
    expect(firstId("Где можно припарковаться?", false).fb).not.toBe("none");
  });
});

describe("🚨 Türkçe/İngilizce seçim sözlük AÇIK ve KAPALI birebir aynı", () => {
  it("ölçek harness'ının TÜM soruları (30/100/300 kalem) + elle seçilmiş Türkçe sorular", () => {
    let compared = 0;
    for (const n of [30, 100, 300]) {
      const syn = makeSyntheticKb(n);
      const items = syn.items;
      const questions = [
        ...syn.questions.map((q) => q.text),
        "Paradan kesinti var mı?",
        "Parke zemin mi?",
        "Salı günü gelebilir miyiz?",
        "Kod nedir?",
      ];
      __resetKbIndexCache();
      for (const q of questions) {
        // İndeks önbelleği sözlükten bağımsızdır (küme parmak izi); iki koşu aynı indeksi paylaşır.
        const on = selectKbForPrompt({ items, guestMessage: q, mode: "hybrid" });
        const off = selectKbForPrompt({ items, guestMessage: q, mode: "hybrid", sources: { foreign: false } });
        expect(on.items.map((i) => i.id), `${n}: ${q}`).toEqual(off.items.map((i) => i.id));
        expect(on.evidence?.fb, `${n}: ${q}`).toBe(off.evidence?.fb);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(300);
  });
});
