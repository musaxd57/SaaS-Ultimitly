# Faz 3 taslağı (10-16) — konu bazlı "bilgim yok" (H9) + belirtiyle ilgili tarif (H2): misafire giden kısa karşılık örnekleri

> Durum: TASARIM + SORU. Kod yazılmadı (misafire giden metni değiştirir → önce senin onayın, anahtar KAPALI doğar).
> Kaynak: kurucu kararları 10-16 (H1 / H2 / H9 örnekleri) + mevcut kurallar (K10 devir cümlesi misafire gitmez · "bilgim yok" misafire asla ·
> "ev sahibinizin kararıdır" misafire gitmez).

## 1. Senin kuralın (10-16, aynen özet)

- Cevabı yalnız bir ifade geçti diye bütünüyle tutma; anlamına ve konusuna bak.
- "Çöpler arka konteynere bırakılıyor. Başka talimatım yok." → çöp cevabı gider; gereksiz son cümle düşebilir.
- "Televizyon için ayrı bir talimatım yok." → TV konusu AÇIK kalır; bağımsız çöp cevabı engellenmez.
- "Başka ayar yapmanıza gerek yok." → "bilgim yok" DEĞİLDİR (olumlu yönerge).
- "Çözüm bilgisi yok" gibi bir ifade misafire KESİNLİKLE gitmez (ev sahibinde kalabilir).
- Televizyona çözüm bulunamazsa konu sessizce kaybolmaz; arıza açık kalır, bağımsız çöp sorusu cevaplanabilir.

## 2. Önerilen davranış (cümle / konu düzeyi)

1. Cevap cümlelere bölünür. Yalnız "bilgi / talimat yok" diyen cümle (konusuyla birlikte) **ayıklanır** — misafire gitmez.
2. Kalan cümleler misafirin BAŞKA bir sorusunu cevaplıyorsa (konu eşleşmesi: çöp ↔ çöp kalemi) kalan cevap gider.
3. Ayıklanan cümlenin konusu (TV) **ev sahibinde açık kalır**: konuşma öğesi "açık", arıza ise görev / bildirim kuralı (H1) — misafire
   "ilettim" türü bir DEVİR cümlesi GİTMEZ (K10).
4. Geriye hiçbir cevap kalmazsa bugünkü gibi hiçbir şey gitmez, taslak sende kalır.
5. "…gerek yok", "…yeterli", "…yapmanıza gerek kalmaz" olumlu yönergedir, ayıklanmaz.

## 3. Örnekler — ÖNCE / SONRA (misafire giden metin)

| Misafir | Bilgi tabanı | Model taslağı | ÖNCE (bugün) | SONRA (öneri) |
|---|---|---|---|---|
| "Televizyon siyah ekran, çöpleri nereye atıyoruz?" | çöp: "Çöpler binanın arkasındaki konteynere." · TV: yok | "Çöpleri binanın arkasındaki konteynere bırakabilirsiniz. Televizyonla ilgili bir bilgim yok." | Tamamı tutulur ("bilgim yok", `ai/absence.ts`) → misafire HİÇBİR ŞEY gitmez (kanal: taslak sende · QR: sana devredilir), çöp sorusu da cevapsız | "Çöpleri binanın arkasındaki konteynere bırakabilirsiniz." gider · TV ev sahibinde açık arıza |
| "Çöpler nereye?" | çöp kalemi var | "Çöpler arka konteynere bırakılıyor. Başka talimatım yok." | (bugün istisna nedeniyle gider, ikinci cümleyle) | "Çöpler arka konteynere bırakılıyor." gider (gereksiz cümle düşer) |
| "Klimayı nasıl kapatırım?" | klima kalemi | "Kumandadaki ON/OFF tuşuna basmanız yeterli, başka ayar yapmanıza gerek yok." | gider | gider (olumlu yönerge, ayıklanmaz) |
| "Televizyon siyah ekran" | TV: yalnız SES ayarı ("ses için VOL tuşları") | "Ses için VOL tuşlarını kullanabilirsiniz." | `AI_FIX_SUPPORT_GATE_ENABLED` kapalı (bugün canlı): gider (ilgisiz) | gitmez — arıza bildirilen cihaza yöneltilen adım TARİF ister, ses ayarı görüntü arızasının tarifi değil (bu kısım H2 anahtarında ZATEN var; açılınca olur) · TV arızası açık |
| "Soğutmayı nasıl açarım?" | klima: "Soğutma için MODE ile kar tanesi simgesini seçin." | aynı talimat | gider | gider (kullanım SORUSU + kullanım bilgisi) |
| "Prizden duman çıkıyor / yanık kokusu var" | priz / sigorta kalemi | herhangi bir kullanım adımı | güvenlik akışı | güvenlik akışı AYNEN (normal kullanım adımı gitmez) |

## 4. Senin seçmen gereken: TV için misafire kısa karşılık gitsin mi?

K10 kuralın gereği bugün "ev sahibinize ilettim / not aldım" türü cümle misafire GİTMEZ. Bu yüzden 1. satırda misafir yalnız çöp cevabını
görür, TV hakkında hiçbir şey okumaz (konu sende açık). Seçenekler:

- **(A) Sessiz (bugünkü K10 ile uyumlu):** yalnız çöp cevabı. Risk: misafir TV'nin görmezden gelindiğini düşünebilir.
- **(B) Bilgi vermeyen kısa karşılık:** "Televizyonla ilgili yazdığınızı gördüm." (devir / söz / "bilgim yok" İÇERMEZ). K10'a dar bir istisna.
- **(C) Bilgi tabanında o belirti için güvenli bir ilk adım YAZILIYSA** (ör. "görüntü yoksa kaynak tuşuyla HDMI 1'i seçin") yalnız o adım; yoksa A.

Önerim: **C, yoksa A** (K10'u gevşetmeden; B için ayrı onayın gerekir). Hangisi?

## 6. İLK DİLİM KODDA (10-16 akşam, kurucu "açık işlerden devam et"; anahtar `AI_TOPIC_ABSENCE_ENABLED` KAPALI)

- Kapsam: **kanal oto-yanıtı, öğe kipi** (konuşma öğeleri açık + tur öğeye bölündü). QR'da YOK (QR'ın öğe modeli yok; ayıklanan konunun ev
  sahibinde açık kalması ayrı kablolama ister) — bugünkü gibi bütün cevap devredilir.
- Kural `src/lib/conversation-items/topic-absence.ts`: "bilgim yok" cümlesi ayıklanır; konusu bırakılan bir cihaza (tutulan arıza) ya da
  cevaplanabilir bir isteğe eşlenmeli (aynı sözlük: `relation.topicsWithSymptomsOf`), eşlenen istek beyandan düşer → ev sahibinde AÇIK kalır.
  Eşlenmeyen yokluk cümlesi, boş kalan cevap, cevaplanan istek kalmaması ya da kalan cümlenin düşen konuya değinmesi → bugünkü gibi TUTULUR.
  Kalan metin bütün kapılardan yeniden geçer (bırakılan cihaza değinme, çıktı vetosu, dil …). Haiku 10-16 sıkılaştırması: kalan HER cümle
  kalan cevaplanmış bir isteğin konusuna değinmeli (konusuz adım cümlesi → tutulur). Opus 10-16: beyanda kalan her istek kalan metinde
  karşılanmalı (kapsama), kalan metin belirsizlik söylememeli, kodun selam satırı muaf, ayıklama satır satır; kanıt izi `ta`.
  Bilgi (kurucu tablosu §3 satır 2): "Başka bir bilgim yok." konusuz → bütün cevap bugünkü gibi tutulur. Düşen cevaplanabilir istek, modelin cevaplamadığı istekle
  aynı yoldan açık iş olarak kalır (e-posta yalnız ev sahibine bırakılan hassas öğelerde — bugünkü kısmi cevap kuralı).
- §4 seçimi verilmediği için TV'ye misafire hiçbir cümle EKLENMEZ (= A, K10 ile uyumlu). B / C seçilirse ayrı dilim.
- Testler: `tests/unit/topic-absence.test.ts` (kurucu örnekleri), `tests/integration/conversation-items-auto-reply.test.ts` (anahtar açık /
  kapalı uçtan uca, belirsiz konu, kalan metinde uydurma adım).

## 5. Uygulama planı (onaydan sonra)

- Anahtar `AI_TOPIC_ABSENCE_ENABLED` (kapalı doğar); `ai/absence.ts` cümle düzeyi ayıklama + konu eşleşmesi (anlama katmanının konu listesi);
  ayıklanan konu → konuşma öğesi açık.
- Ölçüm: kayıtlı cevaplarda (ücretsiz) kaç cevap "tamamı tutulur" → "kısmen gider"e döner; kör setle güvenlik ölçüleri 0 kalmalı.

---

# Arıza önceliğini yapay zekâ belirlesin (kurucu kararı 10-16) — tasarım taslağı

## Bugün (kodda doğrulandı, `src/lib/tasks/detect.ts`)
- Öncelik SÖZCÜK AĞINDAN: yalnız güvenlik acili (gaz / yangın / mahsur kalma / yaralanma sözcükleri) `urgent` + 2 saat; bütün arızalar
  `standard` + 24 saat; eksik sarf `standard` 24 sa; temizlik 12 sa. "Hiç su yok, tuvaleti kullanamıyoruz" ile "musluk hafif damlatıyor"
  AYNI önceliği alır. Ev sahibi görevin önceliğini panelden değiştirebilir.

## Öneri (anahtar `AI_FAULT_PRIORITY_ENABLED`, KAPALI doğar)
- Anlama katmanı (zaten çalışan model çağrısı; YENİ çağrı yok) her istek öğesi için üç alan daha döndürür:
  · `report`: gerçekleşen arıza / varsayım ("olursa ne yapalım") / soru / geçmişte kalmış
  · `impact`: küçük aksaklık / temel hizmet kullanılamıyor (su, elektrik, ısınma, tuvalet, kilit, internet-iş) / bilinmiyor
  · `hazard`: tehlike işareti var mı (mahsur kalma, duman, elektrik / gaz kokusu)
- KOD karar verir (model değil): `hazard` → bugünkü güvenlik akışı (acil, değişmez; modelin "normal" demesi açık tehlike sözcüğünü
  BASTIRAMAZ) · `impact = temel hizmet yok` → yüksek öncelik (ör. 4 saat) · `küçük` → normal (24 saat) · `bilinmiyor` / model düştü → bugünkü
  sözcük kuralı + "öncelik belirsiz" işareti (ev sahibi incelemesi) · `report ≠ gerçekleşen` → görev açılmaz (D4 kuralı zaten).
- Öncelik misafire SÖZ değildir: misafire giden metin değişmez (teknisyen / saat / müdahale sözü verilmez).
- Ev sahibinin değiştirdiği öncelik kayıt edilir; değerlendirme setine ADAY olur, tek düzeltme kimsenin kuralını kendiliğinden değiştirmez.
- Ev sahibi önceliği elle değiştirdiyse yapay zekâ bir daha yazmaz. Aynı cihaz için DAHA YÜKSEK öncelikli yeni bildirim gelirse açık görev
  YÜKSELTİLİR (asla düşürülmez) — bugün aynı gün aynı cihazın tekrar bildirimi açık görevin önceliğine dokunmuyor ("klima çalışmıyor" sonrası
  "çocuklar donuyor, ısıtma hiç yok" yükseltmesi kaybolur; Codex doğrulaması C12).
- Öncelik değeri için migration YOK (`Task.priority` zaten acil / standart / düşük); "kaynak: yapay zekâ / ev sahibi" + "öncelik belirsiz"
  işareti için küçük migration (yeni boş kolonlar) — Faz 2 manifestine eklenir.
- Ayrıntı alternatifi (Codex doğrulama ajanı): beş değerli tek alan `güvenlik / konaklamayı engelliyor / konaklamayı zorlaştırıyor / küçük /
  belirsiz` → acil 2 sa · yüksek 4–6 sa · normal 24 sa · düşük 48 sa · belirsiz = normal + "ev sahibi doğrulasın". Önerim bu tek alan (üç alandan
  daha az kalibrasyon riski).

## Örnekler (senin tablon → önerilen sonuç)
| Mesaj | report / impact / hazard | Görev |
|---|---|---|
| "Kapı kilitlenmiyor, dışarı çıkamıyoruz." | gerçekleşen / temel (kilit) / mahsur kalma? → model "olası" der | güvenlik akışı (acil 2 sa) — mahsur kalma ihtimali ayrıca ev sahibine bildirilir |
| "Mutfak musluğu hafif damlatıyor." | gerçekleşen / küçük / yok | normal bakım (24 sa) |
| "Dairede hiç su yok, tuvaleti de kullanamıyoruz." | gerçekleşen / temel / yok | yüksek (4 sa) — bugün normal 24 sa |
| "Yangın söndürücü nerede?" | soru / — / yok | görev yok; kayıtlı konum cevaplanır |
| "Çocuğun ateşi var, yarın gelemiyoruz." | — (konaklama talebi) | görev yok; talep işlenir, eczane tarifi verilmez |

**Sorular:** (1) "Yüksek" için 4 saat uygun mu (bugün yalnız acil 2 sa / normal 24 sa var)? (2) Öncelik belirsizse ev sahibine ayrı bir
"incelemen gerekiyor" işareti mi, yoksa yalnız normal görev mi? Ölçüm ücretli model çağrısı ister (anlama katmanı çıktısı değişir) → senin
onayınla, kör setle.
