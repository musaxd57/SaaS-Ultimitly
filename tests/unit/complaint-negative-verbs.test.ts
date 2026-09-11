import { describe, it, expect } from "vitest";
import { classifyFallback, detectRiskType, matchesIntentKeywords } from "@/lib/ai/fallback";
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

/**
 * [mesaj, intent, riskType] — satır başına TEK beklenen değer (gevşek `toContain` yok).
 *
 * ⚠️ ÜÇÜNCÜ KOLON ÇOĞU SATIRDA TÜRETİLMİŞTİR (ölçüldü, inceleme turu 6): `detectRiskType`ın son
 * satırı `if (classifyFallback(m).isComplaint) return "complaint"` — yani `complaint` bekleyen
 * satırlarda kolon bağımsız bilgi TAŞIMAZ. Gerçek bilgi yalnız `safety_emergency` bekleyen
 * satırlarda: orada SAFETY ağının complaint fallback'inden ÖNCE çalıştığı pinlenir.
 */
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
  ["Dolap bozuldu.", "complaint", "complaint"],
  // Cihazın PARÇASI da cihazdır ("motor"): özne yuvasında duran parça adı bildirimi susturmasın.
  ["Bulaşık makinesinin motoru bozuldu", "complaint", "complaint"],
  // EKSİZ YÜKLEM: "var" çekim eki taşımaz ama fiil yerindedir.
  ["Buzdolabı var ya, bozulmuş.", "complaint", "complaint"],
  // ── İNCELEME TURU 5 (09-11): ÖZNE YUVASININ ÜÇ KÖR NOKTASI — hepsi GERÇEK bildirimdi,
  // 4. tur onları DÜŞÜRÜYORDU ve kapı OTO-GÖNDERİM izni veriyordu (ölçüldü, 15 satır).
  // (a) İYELİK ZİNCİRİ: Türkçede KISMİ arızanın olağan biçimi; özne yuvasında cihazın PARÇASI durur.
  ["Klimanın fanı bozuldu, çok ses yapıyor.", "complaint", "complaint"],
  ["Mutfaktaki fırının kapağı bozulmuş.", "complaint", "complaint"],
  ["Kapı kilidinin dili bozulmuş.", "complaint", "complaint"],
  ["Bulaşık makinesinin kapağı bozuldu, kilitlenmiyor.", "complaint", "complaint"],
  // BELİRTİSİZ isim tamlaması (tamlayan eki YOK): "klima kumandası" — zincirin ikinci dalı.
  ["Klima kumandası bozuldu.", "complaint", "complaint"],
  ["Buzdolabı kapağı bozulmuş.", "complaint", "complaint"],
  // (b) ZARF ÖBEĞİ: tek kelimelik liste "bu sabah"ı kaçırıyordu; zaman/sayı BİÇİMDEN tanınır.
  ["Kombi bu sabah bozuldu.", "complaint", "complaint"],
  ["Kombi iki gündür bozuldu.", "complaint", "complaint"],
  ["Kombi saat üçte bozuldu.", "complaint", "complaint"],
  ["Kombi öğleden sonra bozuldu.", "complaint", "complaint"],
  // (c) NİCELEYİCİ ÖZNE
  ["Prizlerin ikisi bozuldu, telefonu şarj edemiyoruz.", "complaint", "complaint"],
  ["Klimaların hepsi bozuldu.", "complaint", "complaint"],
  // (d) ULAÇ: 3. turun düzelttiği cümle şeklinin ta kendisi, başka eklerle.
  ["Klimayı açınca, bozuldu.", "complaint", "complaint"],
  ["Klimayı çalıştırınca, bozuldu.", "complaint", "complaint"],
  ["Klimayı kullandıktan sonra, bozuldu.", "complaint", "complaint"],
  ["Klimayı açtığında, bozuldu.", "complaint", "complaint"],
  ["Klimayı açmadan bozuldu.", "complaint", "complaint"],
  // Zarf/eşseslilik pinleri CONTRACT tarafında olmalı: TRAP satırı zarf-atlamayı ÖLÇEMEZ
  // (atlama aramayı sola taşır = complaint yönü; `null` beklentisi o yönü göremez).
  ["Klima var, galiba bozuldu.", "complaint", "complaint"],
  ["Klima var, dün bozuldu.", "complaint", "complaint"],
  ["Klima var, tamamen bozuldu.", "complaint", "complaint"],
  // ── İNCELEME TURU 6 (09-11): ÜÇ AYRI KAÇAK, üçü de OTO-GÖNDERİM izni açıyordu ──
  // (a) İZAFET/TAMLAMA: kalıplar 1. turdan beri ÇIPLAK YALIN HÂLDE donmuştu; Türkçede tesis adı
  // neredeyse hep tamlamadır ve yumuşama + 3. tekil iyelik alır. Aynı cihaz "bozuldu" ile
  // complaint, "akmıyor/yanmıyor/tıkandı" ile general oluyordu (ölçülen asimetri).
  ["Mutfak musluğu akmıyor.", "complaint", "complaint"],
  ["Mutfak ocağı yanmıyor.", "complaint", "complaint"],
  ["Banyo lavabosu tıkandı.", "complaint", "complaint"],
  ["Tuvalet sifonu çekmiyor.", "complaint", "complaint"],
  ["Oda peteği ısınmıyor.", "complaint", "complaint"],
  ["Musluklar akmıyor.", "complaint", "complaint"],
  ["Daire kapısı açılmıyor.", "complaint", "safety_emergency"],
  // (b) "ve" BAĞLACI: Türkçenin en sık bağlacı özne sanılıyordu — "ama/ancak/fakat" listede,
  // "ve" değildi. Bağlaç bir ÖZNEYİ gizleyemez, yön güvenli.
  ["Klimayı açtık ve bozuldu.", "complaint", "complaint"],
  ["Klimayı açtık, nedense bozuldu.", "complaint", "complaint"],
  // (c) KESME İŞARETİ cihaz adını ekinden koparıyordu; kesmesiz aynı cümle complaint'ti.
  ["Klima'mız bozuldu.", "complaint", "complaint"],
  ["TV'miz bozuldu.", "complaint", "complaint"],
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
  ["Işıklar çok hoş. Planımız bozuldu, bir gece iptal edeceğiz.", null],           // plan
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
  ["Buzdolabı süper ama sütün tadı bozuldu, yenisini alabilir miyiz?", null],
  // 🚨 Zincirin KABUL dalı TAMLAYANIN CİHAZ OLMASINI ister: 3. tekil iyelik TEK BAŞINA yetmez.
  ["Klima çalışıyor ama valiz tekerleği bozuldu.", null],
  ["Klima harika, bavul sapı bozuldu.", null],
  // İYELİK ZİNCİRİNİN KARŞI YÖNÜ: tamlayan CİHAZ DEĞİLSE zincir REDDEDER (kabul etmez).
  ["Lamba çok hoş, valizimizin tekerleği bozuldu, kargo var mı?", null],
  ["Klima çok iyi soğutuyor, ama çocuğumuzun keyfi bozuldu, parkı sorabilir miyim?", null],
  // 🚨 Zincir FİİL testinden ÖNCE bakılmalı: "sıhhati" biçimsel olarak "-ti" fiil ekine benzer.
  ["Klima mükemmel. Babamın sıhhati bozuldu, bir gün erken çıkabiliriz.", "early_departure"],
  // MASTAR (-mak/-mek) fiil yuvası SAYILMAZ: "yemek"/"ekmek" gerçek isimlerdir.
  ["Fırın gayet iyi. Dışarıdan getirdiğimiz yemek bozuldu, çöpü nereye atalım?", null],
  ["Mikrodalga var mı? Dün aldığımız ekmek bozuldu da.", null],
  // ZARF çekimi İYELİK ALMAZ: "günümüz/gecemiz" ÖZNEdir, zarf değil.
  ["Asansör var mı diye sormuştum, günümüz bozuldu ama sorun değil.", null],
  ["Klima harika ama internet bozuldu, modem kutusu nerede bilmiyorum.", null],
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
  // ⚠️ "Fonksiyon tuşları…" / "Fondöten şişem…" satırları SİLİNDİ: `fön` 4. turda cihaz
  // listesinden çıktığı için o çarpışma sınıfı artık VAR OLAMAZ (ölçüldü: çekim kapısı açılsa
  // ve fön geri konsa bile general) — satır hiçbir kapıyı sınamıyordu.
  ["Uçuşu düşünürken planımız bozuldu", null],    // düşün… → "dus" çarpışması
  // 🚨 ÇEKİM KAPISINI YALNIZ BAŞINA SINAYAN SATIR (inceleme turu 4): yukarıdakilerin çoğunda
  // özne yuvası da tutuyor, yani çekim kapısı silinse bile satır yeşil kalırdı. Burada sol komşu
  // çekimli bir FİİL ("aradık") — özne yuvası AÇIK; kararı tek başına çekim kapısı veriyor.
  ["Kapıcıyı aradık, bozuldu.", null],
  ["Kapitalizmi tartıştık, bozuldu.", null],
  ["Ocakbaşını denedik, bozuldu.", null],
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

  it("t/d EŞSESLİLİĞİ kapağının HER girdisi pinli (fiyat · moral · saat · bilet · tat/tad · cilt/cild)", () => {
    // 🚨 Önceki tur "her girdi kendi testiyle pinli" diyordu; ölçüldü: 8'in 4'ü pinsizdi
    // (fiyat · bilet · cilt · tat silinse dosya yeşil kalıyordu). Her satırda mesajda gerçek
    // bir cihaz adı var, yoksa satır hiçbir şey ölçmez.
    for (const m of [
      "Klima dahil fiyatı bozuldu mu, indirim var mı?",   // fiyat
      "Klima harika ama moralim bozuldu.",                 // moral
      // 🚨 ÖLÇÜLMÜŞ AYIRT EDİCİ BİÇİMLER (inceleme turu 6): önceki satırlar girdileri
      // PİNLEMİYORDU — "saati" TIME_WORDS zarfı olarak atlanıyor, "biletimiz"/"tat"/"cilt"
      // zaten VERB_LIKE'a girmiyor, "çayın tadı" kararı zincir veriyor. Girdi silinince
      // DÜŞEN biçimler bunlar (1./2. tekil iyelik ya da 3. tekil iyelik, tamlayansız):
      "Klima var, saatim bozuldu.",                        // saat
      "Klima iyi, bileti bozuldu.",                        // bilet
      "Klima iyiydi, kahve tadı bozuldu.",                 // tat/tad
      "Klima var, tatı bozuldu.",                          // tat
      "Klima var, ciltim bozuldu.",                        // cilt
      "Duş jeli bırakmışsınız, cildim bozuldu biraz.",     // cild
    ]) {
      expect(classifyFallback(m).intent, m).not.toBe("complaint");
    }
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

  it("🚨 GÖRÜNMEZ KARAKTER 'sorun/problem' ağını DELİYORDU (tek U+00AD → oto-gönderim izni)", () => {
    const SH = "\u00AD"; // SOFT HYPHEN — çoğu klavyede tek tuş, hiçbir yerde GÖRÜNMEZ
    expect(classifyFallback("Dairede bir sorun var.").intent).toBe("complaint");
    expect(classifyFallback(`Dairede bir so${SH}run var.`).intent).toBe("complaint");
    expect(classifyFallback(`There is a pro${SH}blem in the flat.`).intent).toBe("complaint");
    expect(classifyFallback("Dairede bir so\u200Brun var.").intent).toBe("complaint"); // ZWSP
    // Kontrol: diğer üç bacak zaten dayanıklıydı (bu tur yalnız dördüncüyü kapattı).
    expect(classifyFallback(`Su ge${SH}lmiyor.`).intent).toBe("complaint");
    expect(classifyFallback(`Klima bo${SH}zuldu.`).intent).toBe("complaint");
    // 🚨 HAM okuma YERİNDE ve GÖZLEMLENEBİLİR: normalizasyon olumsuzlama kontrolüne
    // UYGULANMAZ (CLAUDE.md katlama kuralı) → boşlukla bozulmuş bir olumsuzlamaya GÜVENİLMEZ.
    // Bu satır o bilinçli asimetriyi kilitler: normalize okuma TEK BAŞINA kalsaydı "Sorun  yok"
    // olumsuzlanır ve şikâyet DÜŞERDİ; bugün aşırı eskalasyon (güvenli yön) oluyor.
    expect(classifyFallback("Sorun  yok, teşekkürler.").intent).toBe("complaint");
    // Normal yazımda olumsuzlama ÇALIŞIR (yeni okuma bir şeyi bozmadı):
    expect(classifyFallback("Hiçbir sorun yaşamadık.").intent).not.toBe("complaint");
    expect(classifyFallback("Sorun yok, her şey için teşekkürler!").intent).not.toBe("complaint");
  });

  it("🚨 BİLİNEN SINIR (ölçüldü, düzeltmesi REDDEDİLDİ): olumsuzlama ÖNEKİ gerçek şikâyeti yutuyor", () => {
    // Üçü de gerçek şikâyet ama bir OLUMSUZ kalıbın ÖNEKİ oldukları için `general` kalıyor.
    // Girdileri TAM olumsuz biçime daraltmak DENENDİ: "…ama SORUN DEĞİL." gibi ÇOK YAYGIN
    // nezaket kapanışları complaint'e döndü (tuzak satırı düştü) → kazanç nadir, bedel yaygın.
    expect(classifyFallback("Sorun olmaz demiştiniz ama oldu.").intent).not.toBe("complaint");
    expect(classifyFallback("Sorunsuz bir tatil olmadı.").intent).not.toBe("complaint");
    // KORUNAN yaygın kalıp (bu yüzden reddedildi):
    expect(classifyFallback("Asansör var mı diye sormuştum, günümüz bozuldu ama sorun değil.").intent).not.toBe("complaint");
  });

  it("'şu' özne yuvasında atlanır; 'su' artık CİHAZ (7. turda düzeltildi — beklenti TERS ÇEVRİLDİ)", () => {
    // 🚨 6. TURUN PİNİ YANLIŞ YÖNÜ KODLUYORDU. O tur `"su"`yu `SUBJECT_SLOT_FILLERS`tan
    // çıkarıp "SU gerçek bir tesis adıdır" yazmıştı, ama `su` cihaz listesinde OLMADIĞI için
    // özne yuvasında "cihaz-DIŞI özne" sayılıp bildirimi REDDETTİRİYORDU — yani gerekçe
    // kodda TERSİNE çalışıyordu ve 6 gerçek bildirim oto-gönderim izni alıyordu (ölçüldü).
    // 7. tur gerekçeyi kodda DOĞRU yaptı: `su`/`suy` artık `BREAKDOWN_DEVICES` üyesi.
    expect(classifyFallback("Klimayı açtık, şu bozuldu.").intent).toBe("complaint");
    expect(classifyFallback("Klimayı kapattık, su bozuldu.").intent).toBe("complaint");
    // KARŞI YÖN: suyla ilgili gerçek bildirimi olumsuz-fiil bacağı zaten taşıyor.
    expect(classifyFallback("Su gelmiyor.").intent).toBe("complaint");
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

// ---------------------------------------------------------------------------
// YEDİNCİ İNCELEME TURU (09-11) — CİHAZ LİSTESİ BOŞLUKLARI (ÖLÇÜLDÜ)
//
// `BREAKDOWN_DEVICES` bir LİSTEDİR, dilbilgisi değil: listede olmayan her cihaz adı
// arıza fiiliyle birlikte gelse bile `general` kalır ve kapı OTO-GÖNDERİM İZNİ verir.
// Ölçüm (09-11, iki parti): 14 gerçekçi bildirimin 14'ü kaçıyordu, 13'ü oto-gönderim
// izni alıyordu; ikinci partide 16 bildirimin 12'si kaçıyordu.
//
// 🚨 Liste büyütmek BEDAVA DEĞİLDİR: her kelime, kelime-BAŞI + ÇEKİM eşleşmesiyle
// (üç katlama: std · tr · ASCII) cihaz-olmayan sözcükleri de yakalayabilir. Bu turda
// "batarya" ÖLÇÜLÜP REDDEDİLDİ — "Telefonumun bataryası bozuldu" ve "Powerbank
// bataryamız bozuldu" (misafirin KENDİ eşyası) complaint oluyordu, 2/2 yanlış pozitif.
// Geri EKLEME.
// ---------------------------------------------------------------------------
describe("cihaz listesi boşlukları (7. tur, ölçülmüş): 19 ek cihaz adı", () => {
  const BENIGN = { source: "openai", intent: "amenity", riskLevel: "low", confidence: 0.9, riskType: null };

  // 1. parti — ajan önerisiyle gelen sekiz cihaz; hepsi ÖLÇÜLDÜ (14/14 kaçak).
  const REPORTS_A = [
    "Davlumbaz bozuldu, mutfakta duman kaldı.",
    "Davlumbazı çalıştırdık, bozulmuş.",
    "Aspiratör bozuldu, banyoda nem birikiyor.",
    "Aspiratörü açtım, arızalı.",
    "Jaluzi bozuldu, kapanmıyor.",
    "Panjur bozuldu, sabah güneş çok geliyor.",
    "Panjuru indirmeye çalıştık, arızalandı.",
    "Diyafon bozuldu, kapıyı açamıyoruz.",
    "Diyafonu denedik, arızalı.",
    "Termostat bozuldu, sıcaklık ayarlanmıyor.",
    "Termostatı ayarlamaya çalıştım, bozulmuş.",
    "Vantilatör bozuldu, hiç dönmüyor.",
    "Duşakabin bozuldu, kapağı çıktı.",
    "Duşakabini kapatamadık, arızalı.",
  ];

  // 2. parti — aynı protokolle taranan ek adlar (12/16 kaçıyordu; dördü BAŞKA bir
  // bacaktan zaten complaint'ti ve bu ASİMETRİNİN kendisi kusurdu: "Çaydanlık bozuldu,
  // ısıtmıyor" complaint ama "Çaydanlığı fişe taktık, bozulmuş" general).
  const REPORTS_B = [
    "Elektrik süpürgesi bozuldu, çekmiyor.",
    "Süpürgeyi denedim, arızalı.",
    "Pencere bozuldu, kapanmıyor.",
    "Salondaki pencereyi kapatmaya çalıştık, arızalandı.",
    "Çaydanlığı fişe taktık, bozulmuş.",
    "Havalandırma bozuldu, banyoda koku var.",
    "Boyler bozuldu, sıcak su yok.",
    "Kepenk bozuldu, açılmıyor.",
    "Kepengi indirmek istedik, arızalı.",
    "Rezervuar bozuldu, sürekli su akıyor.",
    "İnterkom bozuldu, kapıyı açamıyoruz.",
    "Avize bozuldu, salonda ışık yok.",
    "Perde bozuldu, rayından çıktı.",
  ];

  it("gerçek arıza bildirimleri complaint (1. parti)", () => {
    for (const m of REPORTS_A) expect(classifyFallback(m).intent, m).toBe("complaint");
  });

  it("gerçek arıza bildirimleri complaint (2. parti)", () => {
    for (const m of REPORTS_B) expect(classifyFallback(m).intent, m).toBe("complaint");
  });

  it("🚨 GERÇEK BEDEL: bu bildirimlerin hiçbiri OTO-GÖNDERİLMEZ", () => {
    // Ölçüm (kod değişikliğinden ÖNCE): 14 bildirimin 13'ü `passesAutoReplySafetyGate`
    // kapısından GEÇİYORDU. Sınıflandırma tablosu tek başına bedeli göstermez.
    for (const m of [...REPORTS_A, ...REPORTS_B]) {
      expect(passesAutoReplySafetyGate(BENIGN, m), m).toBe(false);
    }
  });

  it("ÜNSÜZ YUMUŞAMASI gövdeleri: çaydanlık→çaydanlığ, kepenk→kepeng", () => {
    // Yumuşamış biçim artık cihaz adıyla BAŞLAMAZ; gövde ayrı yazılmazsa bildirim kaçar.
    // (Yalın biçimler kontrol olarak da burada: gövde satırı silinse bu ikisi yeşil kalır,
    // yani asıl pin yumuşamış biçimlerdir.)
    expect(classifyFallback("Çaydanlığı fişe taktık, bozulmuş.").intent).toBe("complaint");
    expect(classifyFallback("Kepengi indirmek istedik, arızalı.").intent).toBe("complaint");
    expect(classifyFallback("Çaydanlık bozuldu, ısıtmıyor.").intent).toBe("complaint");
    expect(classifyFallback("Kepenk bozuldu, açılmıyor.").intent).toBe("complaint");
  });

  it("TUZAKLAR: aynı sözcükler SSS/övgü/koşul bağlamında complaint DEĞİL", () => {
    for (const m of [
      "Davlumbaz filtresi ne sıklıkla temizleniyor?",
      "Aspiratör sesli mi, geceleri rahatsız eder mi?",
      "Jaluzi var mı yoksa perde mi?",
      "Diyafon hangi katta?",
      "Termostat kaç dereceye ayarlı?",
      "Duşakabin temiz miydi diye soruyorum, evet gayet temizdi.",
      "Süpürge var mı dairede?",
      "Pencereden deniz görünüyor mu?",
      "Çaydanlıkta çay var mıydı, bakamadık.",
      "Havalandırma nasıl çalışıyor, anlatabilir misiniz?",
      "Boyler kaç litre?",
      "Kepenkler otomatik mi?",
      "Rezervuar gömme mi?",
      "İnterkom hangi numarada?",
      "Avizeler çok şık, tebrikler.",
      "Perdeler karartma mı?",
      "Perde rengini çok beğendik.",
      // KOŞUL kipi — oto-yanıtın ASIL İŞİ (guard `CONDITIONAL_TAIL` bunu taşır)
      "Davlumbaz bozulursa kimi arayalım?",
      // OLUMSUZ tam biçim — övgü
      "Termostat arızalanmadı, gayet iyi çalışıyor.",
      "Panjurumuz yoktu ama sorun değil.",
    ]) {
      expect(classifyFallback(m).intent, m).not.toBe("complaint");
    }
  });

  it("🚨 'batarya' ÖLÇÜLÜP REDDEDİLDİ (geri ekleme): misafirin KENDİ eşyası", () => {
    // Türkçede "batarya" hem banyo armatürü hem telefon pilidir. Listeye eklendiğinde
    // ÖLÇÜLDÜ: aşağıdaki ikisi de `complaint` oluyordu (2/2 yanlış pozitif). Özne
    // yuvasının iyelik ZİNCİRİ bunu KURTARMAZ — "bataryası" belirtecin KENDİSİ cihaz
    // sayıldığı için zincir dalına hiç ulaşılmaz.
    expect(classifyFallback("Telefonumun bataryası bozuldu, şarj aleti var mı?").intent).not.toBe("complaint");
    expect(classifyFallback("Powerbank bataryamız bozuldu, sizde var mı?").intent).not.toBe("complaint");
    // Bedeli dürüstçe pinle: banyo armatürü bildirimi bu yüzden KAÇIYOR (bilinen sınır).
    expect(classifyFallback("Banyo bataryası bozuldu, su fışkırıyor.").intent).not.toBe("complaint");
  });

  it("🚨 TÜKETİM maddesi cihaz DEĞİLDİR ('çay' listeye girmez)", () => {
    // Mutasyon turunda `"çay"` eklemek HİÇBİR testi düşürmedi = sınıf PİNSİZDİ. Misafirin
    // kendi tükettiği şeyin bozulması host bildirimi değildir; "çay" ayrıca "çaydanlık"ın
    // ÖNEKİ olduğu için listeye sızması kolaydır. Karşı yön aşağıda: DEMLİK bir cihazdır
    // ama bugün listede YOK ve bu satır o boşluğu dürüstçe kaydeder (bilinen sınır).
    expect(classifyFallback("Çayımız bozuldu, buzdolabında unutmuşuz.").intent).not.toBe("complaint");
    expect(classifyFallback("Getirdiğimiz çay bozulmuş.").intent).not.toBe("complaint");
    expect(classifyFallback("Çay demliği bozuldu.").intent).not.toBe("complaint");
  });

  it("'router' `modem` ile PARİTE kurar — wifi kararını delmez", () => {
    // `modem` 1. turdan beri listedeydi, `router` değildi: aynı cihazın iki adı farklı
    // sınıf üretiyordu. 🚨 "İnternet gelmiyor" / "wifi çekmiyor" BİLİNÇLİ olarak `wifi`
    // intent'idir (CLAUDE.md) — o karar DEĞİŞMEDİ, aşağıdaki iki satır onu pinler.
    expect(classifyFallback("Modem bozuldu, internet yok.").intent).toBe("complaint");
    expect(classifyFallback("Router bozuldu, internet yok.").intent).toBe("complaint");
    expect(classifyFallback("İnternet gelmiyor.").intent).toBe("wifi");
    expect(classifyFallback("Wifi çekmiyor.").intent).toBe("wifi");
  });
});

// ---------------------------------------------------------------------------
// YEDİNCİ TUR İNCELEMESİ (09-11, ölçümlü ajan) — İKİSİ 6. TURUN GERİLEMESİ
// ---------------------------------------------------------------------------
describe("7. tur incelemesi: homoglif · 'su' · izafet soru guard'ı", () => {
  const BENIGN = { source: "openai", intent: "amenity", riskLevel: "low", confidence: 0.9, riskType: null };

  it("🚨 HOMOGLİF bypass'ı KAPANDI — 6. tur düzeltmesi YARIMDI", () => {
    // 6. tur üçüncü okumayı YALNIZ `normalizeForMatch` üzerinden aldı; `deconfuse` adayını
    // atladı → tek bir Kiril "о" (U+043E) aynı oto-gönderim iznini yeniden açıyordu.
    expect(classifyFallback("Dairede bir sоrun var.").intent).toBe("complaint");
    expect(classifyFallback("There is a prоblem in the flat.").intent).toBe("complaint");
    expect(passesAutoReplySafetyGate(BENIGN, "Dairede bir sоrun var.")).toBe(false);
    // 🚨 KARŞI YÖN — ELEME TARAFI BOZULMADI: `stripCombining` adayı ALINMADI, çünkü
    // "yaşamadık"ı MELEZ "yasamadık" yapıp olumsuzlamayı kaçırıyor ve ÖVGÜ complaint'e dönüyordu.
    for (const m of [
      "Sorun yok, teşekkürler.", "Hiçbir sorun yaşamadık.", "Sorunsuz bir tatildi.",
      "No problem at all!", "Pas de problème.", "Sorun değil.", "Hiçbir sorunu yaşamadık.",
      "Hiçbir sorunla karşılaşmadık.",
    ]) {
      expect(classifyFallback(m).intent, m).not.toBe("complaint");
    }
    // "Sorun  yok" (çift boşluk) BİLEREK complaint kalır — normalizasyon ELEMEYE uygulanmaz.
    expect(classifyFallback("Sorun  yok, teşekkürler.").intent).toBe("complaint");
  });

  it("🚨 'su' CİHAZ oldu — 6. turun 6 gerçek bildirimi düşüren gerilemesi kapandı", () => {
    // 6. tur `"su"`yu filler'dan çıkarırken gerekçe "SU gerçek bir tesis adıdır" demişti ama
    // `su` cihaz listesinde OLMADIĞI için özne yuvasında "cihaz-DIŞI özne" sayılıp bildirimi
    // REDDETTİRİYORDU. Altısı da oto-gönderim izni alıyordu.
    for (const m of [
      "Şofbeni açtık, su bozuldu.", "Musluğu açtık, su bozuldu.", "Duşta su bozuldu.",
      "Kombi çalışıyor ama su bozuldu.", "Termosifonu denedik, su bozuldu.",
      "Klimayı kapattık, su bozuldu.", "Su bozuldu.",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
      expect(passesAutoReplySafetyGate(BENIGN, m), m).toBe(false);
    }
    // ÇEKİM KAPISI türetmeleri eliyor (ölçüldü): bunların hiçbiri cihaz değil.
    for (const m of [
      "Sunum için projeksiyon var mı?", "Suratımız asıldı, tatilimiz bozuldu.",
      "Suçlu değilsiniz, uçuşumuz bozuldu.", "Sucuk aldık ama bozuldu.",
    ]) {
      expect(classifyFallback(m).intent, m).not.toBe("complaint");
    }
  });

  it("🚨 İZAFET kalıpları ÇAPASIZDI — soru eki guard'ı 9 bilgi sorusunu kurtarır", () => {
    // 6. turun izafet bloğu tesis adına çapalı DEĞİL; herhangi bir iyelik öbeğinde eşleşiyordu.
    for (const m of [
      "Havuzun suyu akmıyor mu, şelale gibi mi?",
      "Denizin suyu gelmiyor mu kıyıya, dalga var mı?",
      "Sitedeki havuzun ışığı yanmıyor mu geceleri yüzmek için?",
      "Sokak lambası yanmıyor mu gece, karanlık mı oluyor?",
      "Çeşmenin suyu akmıyor mu kışın?",
      "Otoparkın kapısı açılmıyor mu uzaktan kumandayla?",
      "Termalin suyu gelmiyor mu bu mevsimde?",
      "Bahçenin musluğu akmıyor mu yazın?",
      "Kamp ocağı yanmıyor mu rüzgarda?",
    ]) {
      expect(classifyFallback(m).intent, m).not.toBe("complaint");
    }
  });

  it("KARŞI YÖN: aynı kalıpların GERÇEK bildirim biçimi complaint KALIR", () => {
    for (const m of [
      "Mutfak musluğu akmıyor.", "Banyo lavabosu tıkandı.", "Mutfak ocağı yanmıyor.",
      "Oda peteği ısınmıyor.", "Tuvalet sifonu çekmiyor.", "Salonun ışığı yanmıyor.",
      "Balkon kapısı açılmıyor.", "Dairenin suyu gelmiyor.", "Banyonun suyu akmıyor.",
      // Soru İŞARETİ var ama soru EKİ yok → guard tetiklenmez (ayrım ekte, cümlede değil).
      "Mutfak musluğu akmıyor, ne yapmalıyız?",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });

  it("'suy' KAYNAŞTIRMA gövdesi CANLI ('suyumuz' yalın 'su' ile eşleşmez)", () => {
    // Mutasyon turunda `"suy"`u silmek hiçbir testi düşürmemişti = girdi PİNSİZDİ.
    // "su"+"yumuz" geçerli bir çekim dizisi DEĞİL → gövde ayrı yazılmazsa bildirim kaçar.
    expect(classifyFallback("Suyumuz bozuldu.").intent).toBe("complaint");
    expect(classifyFallback("Suyumuzu açtık, bozulmuş.").intent).toBe("complaint");
  });

  it("🚨 SORU EKİ guard'ı YALNIZ izafet alt kümesinde — eski ağa uygulanırsa gerçek şikâyet düşer", () => {
    // Mutasyonla ölçüldü: guard'ı TÜM `NEGATIVE_VERB_COMPLAINTS`e açmak hiçbir testi
    // düşürmüyordu = daraltma kararı PİNSİZDİ. Bu beş mesaj soru EKİ taşır ama AÇIKÇA
    // şikâyettir; guard genişletilirse beşi de `general` olur ve oto-gönderim izni çıkar.
    for (const m of [
      "Sıcak su gelmiyor mu acaba, duş alamadık.",
      "Elektrikler gitti mi ne oldu, hiçbir şey çalışmıyor.",
      "Klima çalışmıyor mu, biz mi yanlış yapıyoruz?",
      "Kapı açılmıyor mu böyle, anahtarı çeviremiyoruz.",
      "Su akmıyor mu sizde de, komşuya soralım mı?",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });

  it("🚨 SORU EKİ'nde HARF SINIRI şart — 'mutfakta/mumla' soru eki DEĞİLDİR", () => {
    // Lookahead olmadan `^r?\s*m[ıiuü]` bu üç bildirimi de susturuyordu (ölçüldü).
    for (const m of [
      "Banyo lavabosu tıkandı mutfakta da su birikiyor.",
      "Oda peteği ısınmıyor mutfak da soğuk.",
      "Salonun ışığı yanmıyor mumla oturuyoruz.",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });

  it("'duşu akmıyo' ÖLÜ girdiydi — silindi, davranış AYNI (eşdeğer mutant kanıtı)", () => {
    // Mevcut "su akmıyo" ASCII katlamada "su akmiyo" olur ve "dusu akmiyor" içinde altdizidir.
    expect(classifyFallback("Duşu akmıyor.").intent).toBe("complaint");
    expect(classifyFallback("Banyodaki duşu akmıyor.").intent).toBe("complaint");
  });

  it("KESME varyantları: ʼ ve ′ kapsanır; ´ BİLİNEN SINIR (NFKC onu yok ediyor)", () => {
    expect(classifyFallback("Klimaʼmız bozuldu.").intent).toBe("complaint");
    expect(classifyFallback("Klima′mız bozuldu.").intent).toBe("complaint");
    expect(classifyFallback("Klima'mız bozuldu.").intent).toBe("complaint");
    expect(classifyFallback("Klima’mız bozuldu.").intent).toBe("complaint");
    // 🚨 `´` = U+00B4; NFKC onu BOŞLUK + U+0301 yapar, yani `deviceTokens`e hiç ulaşmaz.
    // Listede durması "kapsanıyor" yanılsamasıydı → çıkarıldı, sınır burada pinli.
    expect(classifyFallback("Klima´mız bozuldu.").intent).not.toBe("complaint");
  });

  it("'malesef' özne yuvasında atlanır (6. turda PİNSİZ eklenmişti)", () => {
    expect(classifyFallback("Klimayı açtık, malesef bozuldu.").intent).toBe("complaint");
    expect(classifyFallback("Klimayı açtık, nedense bozuldu.").intent).toBe("complaint");
  });
});

describe("7. tur: 'sorun/problem' KOŞUL ailesi (ölçülen en büyük yanlış pozitif sınıfı)", () => {
  it("koşullu SSS soruları artık complaint DEĞİL (oto-yanıtın asıl işi)", () => {
    for (const m of [
      "Bir sorun olursa sizi arayabilir miyiz?",
      "Bir sorun çıkarsa hangi numarayı arayalım?",
      "Sorun yaşarsak size yazalım mı?",
      "Bir sorunla karşılaşırsak ne yapmalıyız?",
      "Herhangi bir sorunda size ulaşabilir miyiz?",
      "Sorun durumunda acil numaranız var mı?",
      // 🚨 İngilizce: `foldTurkishLowerTr` cümle başındaki "I"yı "ı" yapar → "ı"lı İKİZ ŞART.
      "If there is a problem, who should we contact?",
      "In case of any problem, is there an emergency number?",
    ]) {
      expect(classifyFallback(m).intent, m).not.toBe("complaint");
    }
  });

  it("KARŞI YÖN: bu bacağa TEK BAŞINA bağlı gerçek şikâyetler KORUNDU", () => {
    for (const m of [
      "Dairede bir sorun var.", "Sorunumuz devam ediyor.", "Bir sorun yaşıyoruz.",
      "Sorun çözülmedi.", "Aynı sorun tekrar etti.",
      "There is a problem in the flat.", "We are having a problem with the heating.",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });

  it("🚨 ALINTI FRENİ: 'diye' varsa koşul elemesi HİÇ uygulanmaz (fail-closed)", () => {
    // Fren olmadan ÖLÇÜLDÜ: 7 karışık mesajın 2'si `general`e düşüyordu — koşul bir SORU
    // değil, yazma GEREKÇESİdir ve ardından GERÇEK bildirim gelir.
    for (const m of [
      "Sorun olursa diye söylüyorum, klima çalışmıyor.",
      "Sorun çıkarsa diye yazıyorum, kombi bozuldu.",
      "Sorun olursa diye yazıyorum, perde rayından çıkmış.",
      "Sorun yaşarsak diye sormuştum ama şu an gerçekten yaşıyoruz.",
      "Sorun çıkarsa diye not ediyorum: asansör çalışmıyor.",
    ]) {
      expect(classifyFallback(m).intent, m).toBe("complaint");
    }
  });

  it("🚨 ALINTI işareti BOŞLUKLU — 'diyet' içindeki 'diye' freni TETİKLEMEZ", () => {
    // Mutasyonla ölçüldü: çıplak `"diye"` hiçbir testi düşürmüyordu = boşluk kararı PİNSİZDİ.
    // "diyet" gerçek bir sözcüktür; freni tetiklerse koşul elemesi sessizce ölür.
    expect(classifyFallback("Sorun olursa diyet menüsü var mı?").intent).not.toBe("complaint");
    expect(classifyFallback("Bir sorun olursa diyetimizi bozmadan yemek bulabilir miyiz?").intent).not.toBe("complaint");
  });

  it("İZİN sorusu ailesi (08-01) DOKUNULMADAN çalışıyor", () => {
    expect(classifyFallback("Arkadaşım uğrayacak, sorun olur mu?").intent).not.toBe("complaint");
    expect(classifyFallback("Geç check-in sorun olmaz değil mi?").intent).not.toBe("complaint");
  });
});

describe("matchesIntentKeywords('complaint') ≠ isComplaint (latent tuzak, pinli)", () => {
  // 🚨 `matchesIntentKeywords` adı ne diyorsa onu yapar: YALNIZ `KEYWORDS.complaint` ağına bakar.
  // `complaint` niyetinin üç kaynağı daha var (problem-kelimesi · olumsuz fiil · cihaz kuralı) ve
  // hiçbiri kelime ağında değil. Bugün "complaint" ile çağıran YOK; bu pin, ilk çağıranın sessizce
  // DAR bir cevap almasını önlemek için ayrımı GÖRÜNÜR kılar (fonksiyon DEĞİŞTİRİLMEDİ).
  const DIVERGENT = [
    "Klimada sorun var.",            // hasUnnegatedProblemWord
    "Sıcak su gelmiyor, duş soğuk.", // hasNegativeVerbComplaint
    "Klimayı açtık, bozuldu.",       // hasDeviceBreakdown
  ];

  it("üç kaynak da complaint üretir ama kelime ağına GÖRÜNMEZ", () => {
    for (const m of DIVERGENT) {
      expect(classifyFallback(m).isComplaint, m).toBe(true);
      expect(matchesIntentKeywords(m, "complaint"), m).toBe(false);
    }
  });

  it("kelime ağındaki gerçek şikâyette İKİSİ de true (ayrım kaynaktan, ağın bozukluğundan değil)", () => {
    expect(classifyFallback("Çok kötü bir deneyim, şikayet edeceğim.").isComplaint).toBe(true);
    expect(matchesIntentKeywords("Çok kötü bir deneyim, şikayet edeceğim.", "complaint")).toBe(true);
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
