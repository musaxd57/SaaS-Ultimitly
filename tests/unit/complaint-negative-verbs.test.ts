import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType } from "@/lib/ai/fallback";
import { passesAutoReplySafetyGate } from "@/lib/automation";
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
  // ── İNCELEME TURU 3 (09-10): CİHAZ ve FİİL AYRI CÜMLECİKTE — ŞİKÂYETİN OLAĞAN BİÇİMİ ──
  // Cümlecik şartı ölçüldü ve 44 gerçekçi bildirimin 30'unu düşürüyordu; kapı etkisi GERÇEKTİ
  // (`passesAutoReplySafetyGate` "Klimayı açtık, bozuldu."ya OTO-GÖNDERİM izni veriyordu).
  // Türkçede cihaz NESNE olarak ilk cümlecikte, fiil ikincide durur.
  ["Klimayı açtık, bozuldu.", "complaint", "complaint"],
  ["Buzdolabını kontrol ettim, tamamen bozulmuş.", "complaint", "complaint"],
  ["Kombiye baktım, arızalı görünüyor.", "complaint", "complaint"],
  ["Makineyi çalıştırdık, bozuldu.", "complaint", "complaint"],
  ["Televizyonu açmaya çalıştık, bozuldu.", "complaint", "complaint"],
  ["Ütüyü kullanmak istedik, bozulmuş.", "complaint", "complaint"],
  ["Fırını denedik, arızalı.", "complaint", "complaint"],
  ["Asansöre bindik, bozuldu.", "complaint", "complaint"],
  ["Mikrodalgayı denedim, bozulmuş.", "complaint", "complaint"],
  ["Bulaşık makinesini çalıştırdım, arızalı.", "complaint", "complaint"],
  ["Klima dün akşam çalışıyordu, bugün bozuldu.", "complaint", "complaint"],
  ["Şofbeni açtık, arızalandı.", "complaint", "complaint"],
  // ── ÜNSÜZ YUMUŞAMASI (inceleme turu 4, 09-11): k→ğ, t→d, p→b. Yumuşamış biçim ARTIK
  // cihaz adıyla BAŞLAMAZ; önceki tur yalnız "kilid"i eklemişti ve kalan beş gövdede gerçek
  // bildirimler kaçıp OTO-GÖNDERİM izni alıyordu (kapı bloğu aşağıda ayrıca pinler).
  ["Kilidi çevirdim, bozuldu.", "complaint", "complaint"],
  ["Ocağı açtık, bozuldu.", "complaint", "complaint"],
  ["Musluğu açtık, bozuldu.", "complaint", "complaint"],
  ["Bulaşığı açtık, bozuldu.", "complaint", "complaint"],
  ["Peteği açtık, bozuldu.", "complaint", "complaint"],
  ["Işığı açtık, bozuldu.", "complaint", "complaint"],
  ["Dolabı açtık, arızalı.", "complaint", "complaint"],
  // Cihazın PARÇASI da cihazdır ("motor"): özne yuvasında duran parça adı bildirimi susturmasın.
  ["Bulaşık makinesinin motoru bozuldu", "complaint", "complaint"],
  // EKSİZ YÜKLEM: "var" çekim eki taşımaz ama fiil yerindedir.
  ["Buzdolabı var ya, bozulmuş.", "complaint", "complaint"],
  // Şimdiki zaman KİŞİ eki (‑yoruz/‑yorum): fiil görünümü bunları da kapsamalı.
  ["Musluğu kapatamıyoruz, bozuldu.", "complaint", "complaint"],
  ["Klimayı kapatamıyorum, bozulmuş.", "complaint", "complaint"],
  // 3. kişi iyelikli cihaz adı TEK KAYNAK olduğunda (mesajda başka cihaz adı YOK):
  // "makinesi" = makine+si · "makinesini" = makine+si+ni. Bu iki satır olmadan çekim
  // tablosunun 3. kişi dalı ÖLÜ kalıyordu (mutasyon turu: dalı silen mutant hayatta kaldı).
  ["Kahve makinesi bozulmuş.", "complaint", "complaint"],
  ["Kahve makinesini denedim, bozuldu.", "complaint", "complaint"],
  // 🚨 Özne kuralı YALNIZ fiilin HEMEN SOLUNDAKİ belirtece bakar: cihaz-dışı bir sözcüğün
  // mesajın başka yerinde geçmesi gerçek şikâyeti SUSTURMAZ (aşırı uygulama pini).
  ["Uçuşumuz gecikti, bir de klima bozuldu.", "complaint", "complaint"],
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
  // ── İNCELEME TURU 2 (09-10, ölçümlü ajan): CİHAZ ADI ALTDİZİ ÇARPIŞMALARI ──
  // `foldTurkishAscii` iki tarafa da uygulandığı için cihaz adı BAŞKA kelimenin İÇİNDE
  // yakalanıyordu: değişiklik→ışık(isik) · düşün/düşük/düştü→duş(dus) · telefon→fön(fon) ·
  // sürpriz→priz · kutu/unutuldu→ütü(utu) · kombine→kombi · kapıcı→kapı · Ocak(ay)→ocak.
  ["Planımız bozuldu, rezervasyonda değişiklik yapabilir miyiz?", null],
  ["Telefonum bozuldu, wifi şifresini tekrar yazar mısınız?", "wifi"],
  ["Hava bozuldu ama daireniz tam bir sürpriz oldu, çok memnunuz.", null],
  ["Uçuşumuz bozuldu, Ocak ayında gelemeyeceğiz.", null],
  ["Havalar bozuldu, dışarı çıkmayı düşünmüyoruz.", null],
  ["Fiyat bozuldu mu, düşük sezonda indirim var mı?", null],
  ["Programımız bozuldu, bir şey unutuldu mu diye bakar mısınız?", null],
  ["Planımız bozuldu, kapıcıya anahtarı bırakabilir miyiz?", null],
  ["Rezervasyon bozuldu, telefonla ulaşabilir misiniz?", null],
  ["Moralim bozuldu ama evle ilgisi yok, tv izliyoruz.", null],
  // ── ÖZNE YUVASI (turu 3'te allowlist, turu 4'te VARSAYILAN RET) ──
  // 🚨 11 kelimelik allowlist SINIFI KAPATMIYORDU: 30 gerçekçi mesaj ölçüldü, 24'ü hâlâ
  // yanlış complaint oluyordu (taksimiz · bavulumuz · tatilimiz · uyku düzenimiz · çayın tadı ·
  // şarj aletimiz · cildim · canımız…). Kural tersine çevrildi: fiilin solunda bir ÖZNE varsa ve
  // CİHAZ DEĞİLSE bildirim sayılmaz; özne yokluğu ancak sol komşunun çekimli FİİL/ULAÇ olmasıyla
  // (ya da fiilin cümle başında olmasıyla) anlaşılır. Aşağıdaki satırların HER BİRİNDE mesajda
  // gerçek bir cihaz adı vardır (yoksa satır hiçbir şey ölçmez).
  ["Klima harika. Ama planımız bozuldu, erken çıkıyoruz.", null],                       // plan
  ["Ev çok güzel, tv büyük, mutfak eksiksiz. Bu arada midem bozuldu, yakında eczane var mı?", null], // mide
  ["Işıklandırma çok hoş. Planımız bozuldu, bir gece iptal edeceğiz.", null],           // plan
  ["Klima harika ama havalar bozuldu, denize giremedik.", null],                        // hava
  // Özne listede YOKTU ve eski tasarım bunların HEPSİNİ complaint yapıyordu (ölçüldü):
  ["Klima süper. Taksimiz bozuldu, biraz geç geleceğiz.", null],
  ["Televizyon kocaman, teşekkürler. Bavulumuz bozuldu, tamirci önerir misiniz?", null],
  ["Fırın harika, ama tatilimiz bozuldu; yine de teşekkürler.", null],
  ["Ütü buldum teşekkürler, uyku düzenimiz bozuldu sadece.", null],
  ["Mikrodalga var mı? Yemeğin tadı bozuldu çünkü.", null],
  ["Klimanın yanında priz var mı? Şarj aletimiz arızalı galiba.", null],
  ["Klima mükemmel. Ama yol boyunca canımız bozuldu.", null],
  ["Duş jeli bırakmışsınız, cildim bozuldu biraz ama teşekkürler.", null],
  ["Buzdolabındaki sütün tadı bozuldu, yenisini alabilir miyiz?", null],
  ["Klima harika ama internet bozuldu, modem kutusu nerede bilmiyorum.", null],
  ["Lamba çok hoş, valizimizin tekerleği bozuldu, kargo var mı?", null],
  ["Televizyonda maç var mı? Bizim kumandamız evde arızalandı da alışkanlık.", null],
  // 🚨 ZARF KURALI DEVRE DIŞI BIRAKMAZ: tek bir "tamamen/galiba/dün" sol komşuyu değiştirip
  // kuralı sessizce etkisizleştiriyordu (17 varyantın 16'sı ölçüldü) → zarflar ATLANIR.
  ["Klima harika. Ama planımız tamamen bozuldu.", null],
  ["Klima harika. Ama planımız galiba bozuldu.", null],
  ["Ev güzel, tv büyük. Midem dün gece bozuldu.", null],
  ["Klima çalışıyor, uçuşumuz bir anda bozuldu.", null],
  ["Klima iyi. Telefonum dün bozuldu.", null],
  // 🚨 "fön" cihaz listesinden ÇIKARILDI: ASCII katlamada "fon" olup beş gerçek sözcüğü cihaz
  // sayıyordu; "fön makinesi" zaten "makine" ile yakalanıyor.
  ["Fonumuz bozuldu, ödemeyi geciktirebilir miyiz?", null],
  ["Klima mükemmel, sadece programımız bozuldu.", null],                                // program
  ["Klima çalışıyor ama rezervasyonumuz bozuldu.", null],                               // rezervasyon
  ["Klima dahil fiyat bozuldu mu, indirim var mı?", null],                              // fiyat
  // 🚨 "kombine" DİLBİLGİSEL olarak kombi+n+e (2. tekil iyelik + yönelme) — çekim kapısı bunu
  // ELEYEMEZ, çünkü gerçekten geçerli bir çekim. Karar özne kuralına kalır ("bilet").
  ["Kombine biletimiz bozuldu.", null],                                                 // bilet
  ["Klima harika, ama telefonum bozuldu; wifi şifresi neydi?", "wifi"],                 // telefon
  ["Anahtar teslim saati bozuldu mu, 15:00 hâlâ geçerli mi?", null],                    // saat
  ["Ocak ayı planımız bozuldu", null],                                                  // plan (cihaz: "Ocak" ayı)
  // "uçuş" girdisini yukarıdaki "Uçuşumuz bozuldu, Ocak ayında gelemeyeceğiz." satırı pinler
  // (cihaz adı "Ocak" mesajda geçiyor).
  // ── İNCELEME TURU 3: TÜRETME ≠ ÇEKİM — cihaz adıyla BAŞLAYAN başka SÖZCÜKLER ──
  // Kelime başı şartı bunları geçiriyordu; ayrım cihaz adından SONRAKİ ekte
  // (çekim eki dizisi mi, yeni sözcük kuran türetme eki mi).
  ["Kapıcı bozuldu", null],                       // kapı + cı (türetme)
  ["Kapitalizm bozuldu", null],                   // kapı(ASCII "kapi") + talizm
  ["Makineli tüfek sesinden uykumuz bozuldu", null], // makine + li
  ["Ocakbaşı restoranda midem bozuldu", null],    // ocak + başı
  ["Fonksiyon tuşları derken planımız bozuldu", null], // fön(ASCII "fon") + ksiyon
  ["Fondöten şişem bozuldu", null],               // fön + döten (türetme değil, çekim değil)
  ["Uçuşu düşünürken planımız bozuldu", null],    // düşün… → "dus" çarpışması
  // 🚨 ÇEKİM KAPISINI YALNIZ BAŞINA SINAYAN SATIR (inceleme turu 4): yukarıdakilerin çoğunda
  // özne yuvası da tutuyor, yani çekim kapısı silinse bile satır yeşil kalırdı. Burada sol komşu
  // çekimli bir FİİL ("aradık") — özne yuvası AÇIK; kararı tek başına çekim kapısı veriyor.
  ["Kapıcıyı aradık, bozuldu.", null],
  ["Kapitalizmi tartıştık, bozuldu.", null],
  ["Ocakbaşını denedik, bozuldu.", null],
  ["Fonksiyonları inceledik, bozuldu.", null],
  // ── OLUMSUZ / KOŞUL BİÇİMLERİ: gövde kalıpları bunları da yakalıyordu ──
  // Övgü (arıza YOK diyor) ve SSS sorusu (henüz olmamış) şikâyet DEĞİLDİR.
  ["Klima arızalanmadı, gayet iyi çalışıyor.", null],
  ["Kapı sıkışmıyor, rahatça açılıyor.", null],
  ["Musluk damlatmıyor, gayet iyi.", null],
  ["Tuvalet tıkanıklığı yok, her şey yolunda.", null],
  ["Tuvalet tıkanırsa ne yapmalıyız?", null],
  ["Lavabo tıkanmasın diye ne yapmalıyız?", null],
  ["Su gelmiyorsa ne yapmamız gerekiyor?", null],
  ["Kombi yanmıyorsa ne yapalım?", null],
  ["Buzdolabı arızalanırsa kimi arayalım?", null],
  // Ünlü sonrası kaynaştırmalı koşul — CİHAZ kuralının guard'ını ULAŞILIR kılan biçim
  ["Klima arızalıysa kimi arayalım?", null],
  ["Kombi bozulduysa ne yapmalıyız?", null],
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

  it("EN paritesi: elektrik / kesinti / kapı / su / tıkanma / sızıntı / ısı", () => {
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
      // İnceleme 09-10: "no heat" çıplak olduğu için SİLİNMİŞTİ ("no heated pool" yakalıyordu);
      // silinince bu iki gerçek şikâyet YANLIŞ NEGATİF kaldı → çapalı biçimler eklendi.
      "There is no heat in the flat.",
      "No heat since yesterday, it is freezing.",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });

  it("ODA ÇAPASI: 'salonda/mutfakta/banyoda/yatak odasında elektrik-ısıtma yok' da şikâyet (çapa dairede/evde/odada ile sınırlıydı)", () => {
    for (const m of [
      "Salonda elektrik yok.",
      "Mutfakta elektrik yok.",
      "Banyoda elektrik yok.",
      "Salonda ısıtma yok.",
      "Yatak odası ısınmıyor.",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });

  it("PROBLEM_NEGATIONS belirtme hâli: 'Hiçbir sorunu yaşamadık' da olumsuzlanmış sayılır", () => {
    expect(classifyFallback("Hiçbir sorun yaşamadık.").intent).not.toBe("complaint");
    expect(classifyFallback("Hiçbir sorunu yaşamadık.").intent).not.toBe("complaint");
    expect(classifyFallback("Hiçbir problemi yaşamadık.").intent).not.toBe("complaint");
    // Kontrol: gerçek şikâyet hâlâ complaint.
    expect(classifyFallback("Klimada sorun var.").intent).toBe("complaint");
  });

  it("KOŞUL GUARD'I EŞLEŞMEYE BAĞLI, CÜMLEYE DEĞİL: koşul kipini FİİL taşır", () => {
    // 🚨 İNCELEME TURU 3 (ölçüldü): guard CÜMLECİK kapsamlıyken 24 gerçek bildirimin 17'sini
    // düşürüyordu — "eğer" bildirimin ARDINDAN gelince tüm cümleciği koşul sayıyordu. Koşul
    // kipini cümle değil FİİL taşır: "gelmiyor" bildirim, "gelmiyorSA" koşuldur.
    expect(classifyFallback("Su gelmiyor eğer akşama kadar düzelmezse otele geçeceğiz").intent).toBe("complaint");
    expect(classifyFallback("Elektrikler gitti eğer tamirci gelmezse bu gece kalamayız").intent).toBe("complaint");
    expect(classifyFallback("Kombi yanmıyor ısınmazsa donacağız").intent).toBe("complaint");
    expect(classifyFallback("Tuvalet tıkandı eğer pompa varsa deneyeceğiz").intent).toBe("complaint");
    expect(classifyFallback("Klima bozuldu eğer tamir edilmezse uyuyamayız").intent).toBe("complaint");
    // Karşı yön: ek FİİLE bitişikse SSS sorusudur, şikâyet değil.
    expect(classifyFallback("Su gelmiyorsa ne yapmamız gerekiyor?").intent).not.toBe("complaint");
    expect(classifyFallback("Klima arızalıysa kimi arayalım?").intent).not.toBe("complaint");
    // Aynı mesajda OLMUŞ bir bildirim varsa şikâyet KALIR.
    expect(classifyFallback("Klima çalışmıyor, bozulursa ne olur?").intent).toBe("complaint");
    expect(classifyFallback("Su gelmiyor, kesilirse haber verir misiniz?").intent).toBe("complaint");
    expect(classifyFallback("Masa var ama su gelmiyor.").intent).toBe("complaint");
    // Guard HER GEÇİŞİ ayrı okur: ilk geçiş koşul, ikincisi bildirim ise şikâyettir.
    expect(classifyFallback("Su gelmiyorsa ne yapalım? Bu arada su gelmiyor.").intent).toBe("complaint");
    // Satır sonu da ayırıcıdır (metin normalize edilirken boşluğa iner):
    expect(classifyFallback("Tuvalet tıkandı\nTıkanırsa ne yapmalıyız").intent).toBe("complaint");
    expect(classifyFallback("Klima harika\nPlanımız bozuldu").intent).not.toBe("complaint");
    // 1. şahıs koşul ("-sam/-sem") guard'a GİRMEZ — gerçek şikâyet niyeti korunur.
    expect(classifyFallback("İade alamazsam şikayet edeceğim.").intent).toBe("complaint");
    // 🚨 BİLİNEN SINIR: guard YALNIZ 09-10 kalıplarına uygulanır. ESKİ ağdaki "çalışmıyo" gibi
    // kalıplar koşul kipinde de complaint kalır. Guard'ı eski ağa da uygulamak DENENDİ ve
    // ÖLÇÜLDÜ: "Böyle giderse bir yıldız veririm" (gerçek yorum tehdidi) `general`e düşüyordu →
    // eski ağ DOKUNULMADAN bırakıldı (çalışan ürün bozulmaz).
    expect(classifyFallback("Klima çalışmıyorsa kimi arayalım?").intent).toBe("complaint");
    expect(classifyFallback("Böyle giderse bir yıldız veririm").intent).toBe("complaint");
    // 🚨 BİLİNEN SINIR (kabul, pinli): ayrı yazılan "ise" koşulu eke bakan guard'a görünmez.
    expect(classifyFallback("Eğer su gelmiyor ise ne yapalım?").intent).toBe("complaint");
  });

  it("FİİL de kelime BAŞINDA aranır: bitişik yazımda ayrıştırma YAPILMAZ (iki yönlü)", () => {
    // Türkçede ek SAĞA eklenir; arıza fiili bir belirtecin ORTASINDA ancak boşluk unutulunca
    // görünür. Altdizi araması bunu "çözüyormuş" gibi görünürdü ama BİTİŞİK YAZILAN ÖZNEYİ
    // yutardı: aşağıda özne yuvası SOLDAKİ belirtece ("açtık" = fiil) bakar ve geçer, ama asıl
    // özne bileşiğin İÇİNDEDİR ("günümüz"/"keyfimiz") ve cihaz değildir.
    expect(classifyFallback("Klimayı açtık, günümüzbozuldu.").intent).not.toBe("complaint");
    expect(classifyFallback("Klima harika ama planımızbozuldu.").intent).not.toBe("complaint");
    // 🚨 BEDELİ AÇIK (bilinen sınır, pinli): aynı kural gerçek bitişik şikâyeti de kaçırır.
    // Model yolu ikinci savunmadır; ağın sessizce ÖZNESİZ karar vermesi daha kötüdür.
    expect(classifyFallback("klimabozuldu").intent).not.toBe("complaint");
    // Kontrol: doğru yazımda aynı cümle şikâyettir (kural yazım hatasını cezalandırıyor, konuyu değil).
    expect(classifyFallback("Klimayı açtık, bozuldu.").intent).toBe("complaint");
  });

  it("BİLİNEN SINIRLAR (iki yönlü pinli): soru biçimi ve misafirin KENDİ cihazı", () => {
    // 🚨 SORU BİÇİMİ: "bozuldu mu?" bir bildirim değil, ama ağ sözdizimi bilmez → complaint
    // kalır. Yön GÜVENLİ (aşırı eskalasyon: host görür, oto-yanıt gitmez) ama sınır YAZILI olsun.
    expect(classifyFallback("Klima bozuldu mu diye merak ettim, henüz denemedik.").intent).toBe("complaint");
    // Karşı yön: koşul kipi ("bozulur mu") zaten şikâyet DEĞİL.
    expect(classifyFallback("Klima bozulur mu sizce?").intent).not.toBe("complaint");
    // 🚨 MİSAFİRİN KENDİ CİHAZI ayırt EDİLEMEZ: "makinemiz/cihazımız" ile "klimamız" AYNI eki
    // taşır. Dilbilgisel bir sinyal yok; çözüm modelde (tam bağlam) — ağ güvenli yönde hata yapar.
    expect(classifyFallback("Saç kurutma makinemiz bozuldu, sizde var mı?").intent).toBe("complaint");
    expect(classifyFallback("Klimamız bozuldu.").intent).toBe("complaint");
  });

  it("ASCII katlaması: gerçek ASCII girdi korunur; çarpışmaları eleyen ÇEKİM doğrulamasıdır", () => {
    // Koruma yönü: ASCII klavyeyle yazılmış gerçek şikâyet hâlâ yakalanır.
    expect(classifyFallback("klimamiz bozuldu").intent).toBe("complaint");
    expect(classifyFallback("kombimiz arizalandi").intent).toBe("complaint");
    // Eleme yönü ÇEKİMDEN gelir (ASCII bacağı açık): düşünürken→"unurken", fondöten→"doten".
    expect(classifyFallback("Sürpriz bir hediye bırakmışsınız, fondöten şişem bozuldu.").intent).not.toBe("complaint");
    expect(classifyFallback("Düşünürken kahvemiz soğudu, fonksiyon tuşu bozuldu mu bilmiyorum.").intent).not.toBe("complaint");
    // 🚨 BİLİNEN SINIR (kabul, pinli): ASCII'ye inince GEÇERLİ bir çekim üreten çarpışma elenemez.
    // "düşümüz" → "dus"+"umuz" = DUŞ + iyelik. "ASCII bacağını yalnız Türkçe harfsiz belirteçte
    // dene" kapısı DENENDİ ve uygulanamaz çıktı: `matchCandidates`in `stripCombining` adayı
    // (görünmez işaret saldırı sınıfı için) metni zaten diakritiksiz hâlde de sunuyor.
    expect(classifyFallback("Tatil düşümüz bozuldu.").intent).toBe("complaint");
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

describe("OTO-YANIT KAPISI — sınıflandırmanın GERÇEK bedeli", () => {
  // 🚨 Bu blok niye var: cümlecik şartı `classifyFallback`ta masum bir daraltma gibi
  // görünüyordu, ama `complaint` ∈ NEVER_AUTO_REPLY_INTENTS olduğu için doğrudan
  // OTO-GÖNDERİM İZNİNE dönüşüyordu. Model "amenity / low / 0.9" dese bile kapı
  // bildirimi bloklamalı; SSS sorusunda ise oto-yanıt kapının ASIL İŞİDİR.
  const BENIGN = { source: "openai", intent: "amenity", riskLevel: "low", confidence: 0.9, riskType: null };

  it("cihaz ve fiil ayrı cümlecikteki BİLDİRİM oto-gönderilmez", () => {
    for (const m of [
      "Klimayı açtık, bozuldu.",
      "Buzdolabını kontrol ettim, tamamen bozulmuş.",
      "Kombiye baktım, arızalı görünüyor.",
      "Su gelmiyor eğer akşama kadar düzelmezse otele geçeceğiz",
      // Ünsüz yumuşaması (inceleme turu 4): bu üçü ÖLÇÜLDÜ, oto-gönderim izni alıyorlardı.
      "Musluğu açtık, bozuldu.",
      "Mutfaktaki ocağı denedim, bozulmuş.",
      "Ocağı yakamadık, arızalı.",
    ]) {
      expect(passesAutoReplySafetyGate(BENIGN, m), m).toBe(false);
    }
  });

  it("KOŞUL kipindeki SSS sorusu oto-yanıt ALABİLİR (ürünün asıl işi)", () => {
    for (const m of [
      "Su gelmiyorsa ne yapmamız gerekiyor?",
      "Klima arızalıysa kimi arayalım?",
      "Tuvalet tıkanırsa ne yapmalıyız?",
    ]) {
      expect(passesAutoReplySafetyGate(BENIGN, m), m).toBe(true);
    }
  });

  it("özne yuvası cihaz DEĞİLSE oto-yanıt kapanmaz (misafirin kendi eşyası / plan / hava)", () => {
    for (const m of [
      "Klima süper. Taksimiz bozuldu, biraz geç geleceğiz.",
      "Fırın harika, ama tatilimiz bozuldu; yine de teşekkürler.",
      "Klima harika. Ama planımız tamamen bozuldu.",
    ]) {
      expect(passesAutoReplySafetyGate(BENIGN, m), m).toBe(true);
    }
  });

  it("öznesi cihaz olmayan 'bozuldu' oto-yanıtı kapatmaz", () => {
    expect(passesAutoReplySafetyGate(BENIGN, "Klima harika ama havalar bozuldu, denize giremedik.")).toBe(true);
    // ⚠️ Kontrol: "…erken çıkıyoruz" hâlâ BLOKLANIR ama sebebi cihaz kuralı DEĞİL,
    // `early_departure` niyetidir (o da NEVER_AUTO_REPLY). İki sebep karışmasın.
    expect(passesAutoReplySafetyGate(BENIGN, "Klima harika. Ama planımız bozuldu, erken çıkıyoruz.")).toBe(false);
    expect(classifyFallback("Klima harika. Ama planımız bozuldu, erken çıkıyoruz.").intent).toBe("early_departure");
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
