# Mühürlü final eval seti — protokol (09-24)

## Neden

Dış inceleme (09-24) haklı: konaklama değişikliği eval'inin iki bölümü de artık **kör değil**.

* `dev`: ilk kör batarya. Deterministik yedeğin doğruluk düzeltmeleri bu bölüme bakılarak yapıldı.
* `holdout`: ikinci kör batarya. Ayarlamada kullanılmadı ama 09-24 denetimlerinde defalarca ölçüldü
  (ör. üçüncü taraf dışlamasının istek TP/FP sayıları). Ölçüp sonuca göre kod değiştirmek, seti
  dolaylı olarak ayarlamaya katmak demektir.

Bu iki bölüm gelişme göstergesi olarak kalır. **Açma kararı** (bekçi, anlama katmanı, `enforce`)
yalnız üçüncü, mühürlü bir setle verilir.

## Set

* Dosya: `evals/sealed/stay-change-final.json` (şema `evals/stay-change.json` ile aynı, bölüm `final`).
* Yazar: **kör ajan.** Depodaki hiçbir dosyayı (kod, istem, eval setleri, belgeler) okumadan, yalnız kendi
  bilgisiyle yazdı. Geliştiriciye içerik değil, yalnız sayılar, boyut ve SHA-256 raporlandı; ajanın taslak
  kopyaları okunmadan silindi. **Dürüst sınır:** oturum başında CLAUDE.md (genel kurallar, ör. konaklama değişikliği
  politikasının özeti) ajanın bağlamına otomatik yüklendi — kodu görmedi ama kuralları biliyordu.
* İlk mühür (09-24): 180 istek (none 63 · early 26 · late 26 · extend 22 · availability 22 · date_change 21) +
  180 cevap (grant 45 · deferral 36 · neutral 36 · claim 22 · refusal 22 · offer 19); diller tr/en ağırlıklı,
  de/fr/es/ru/ar ~%6'şar. SHA-256 `SEALS.json`da.
* Mühür: `evals/sealed/SEALS.json` dosyanın SHA-256'sını, tarihini, yazarını ve durumunu tutar.

## Kurallar (mekanik pinli: `tests/unit/sealed-eval-access.test.ts`)

1. **Açılmaz, basılmaz, okunmaz.** Dosyanın içeriği hiçbir teste, betiğe, ajana ya da sohbete verilmez.
   İstisna tek: eval harness'ı `tests/eval/stay-change.eval.test.ts`, final koşusunda.
2. **Harness yalnız `EVAL_SEALED_FINAL=1` + gerçek model koşusunda okur** (`RUN_REAL_EVAL=1` + anahtar).
   Anahtarsız ya da kısmi koşu hata verir: mühür yarım koşuyla yakılmaz. O koşuda `dev`/`holdout` yüklenmez.
3. **Bütünlük:** dosyanın SHA-256'sı `SEALS.json` ile eşleşmeli. Tek bir karakter değişirse normal test
   takımı kırmızıya döner. Kasıtlı değişiklik mühür kaydını da değiştirmek zorundadır ve incelemede görünür.
4. **Erişim:** dosya adı depoda yalnız izinli dosyalarda geçer (harness, bu belge, mühür kaydı, erişim pini,
   CLAUDE.md, anlam katmanı tasarım belgesi). Yeni bir okuyucu eklenirse pin kırmızıya döner.

## Final koşusu

1. **Dondur:** model (`OPENAI_MODEL` ve bekçi / anlama katmanı modeli), istemler ve politika kodu tek bir
   commit'te sabitlenir. Koşunun SHA'sı rapora yazılır.
2. **Koş (bir kez):**
   `EVAL_SEALED_FINAL=1 RUN_REAL_EVAL=1 NODE_USE_ENV_PROXY=1 npm run eval -- tests/eval/stay-change.eval.test.ts`
   (anahtar kabukta; kredi gerekir). Rapor `docs/olcum/stay-change-FINAL-eval-<tarih>.md` olarak yazılır.
3. **Karar:** açma sırası `docs/ANLAM-KATMANI-2026-09-24.md` §5 ile, bu rapora bakılarak, kurucu onayıyla.
4. **Yak:** koşudan sonra `SEALS.json` durumu `burned` olur, koşunun SHA'sı ve rapor adı eklenir. Set bundan
   sonra "görüldü" sayılır. Sonraki karar için yeni kör set yazılır ve yeni mühür alınır.

Koşu GEÇERSİZ çıkarsa (düşen çağrı) set yanmış sayılmaz; aynı dondurulmuş SHA ile yeniden koşulur.
Sonuca bakıp kodu değiştirip aynı seti yeniden koşmak ise yasaktır: o durumda set yanmıştır.

## Set B — gerçek misafir mesajları (anonim, yalnız yerel) — 09-24

Dış inceleme haklı: A seti sentetik ve yazarı bir dil modeli; tam bağımsız değil. Kurucu: "host hesabımdaki
mesajları kesinlikle bozmadan, hiçbir değişiklik yapmadan salt okuma ile kullanalım". Final koşusu A + B birlikte.

**Kim ne görür:** mesajları yalnız KURUCU görür, kendi makinesinde. Geliştirici (Claude) ve ajanlar içeriği
hiç görmez; depoya yalnız mühür (SHA-256 + sayılar) ve final raporunun toplam sayıları girer.

1. **Dışa aktarım (salt okuma):** `npx tsx scripts/eval-real-export.ts --email <giriş e-postası>`.
   Veritabanı adresi gizli sorulur (ekrana ve komut geçmişine yazılmaz).
   * **Yalnız kendi kuruluşunuz:** e-posta bir SAHİP (owner) hesabı olmalı; okumadan önce kuruluşun adı ve mesaj
     sayısı gösterilir, "EVET" yazılmadan hiçbir mesaj okunmaz (KVKK amaçla sınırlılık; `--org` seçeneği yok).
   * Her okuma ayrı bir işlemde: ilk komut `SET TRANSACTION READ ONLY` → PostgreSQL her yazmayı reddeder; tüm SET
     komutlarından SONRA `SHOW transaction_read_only` "on" değilse hiçbir veri okunmaz. İzinli ham komutlar ve
     SQL gövdeleri mekanik olarak pinli (yalnız SELECT). Sorgu süresi 60 sn ile sınırlı.
   * Dosyaya yalnız anonimleştirilmiş mesaj metni + mülkün standart giriş/çıkış saati girer. Ad ve adresler YALNIZ
     bellekte, maskeleme için okunur. Kimlik, tarih, konuşma ve rezervasyon bilgisi dosyaya girmez; öğe kimliği
     "r-0001" gibi sıra numarasıdır (canlı veriye geri bağlanamaz).
   * Aday dosyası varsa üzerine YAZILMAZ (yeniden üretmek etiketleri geçersiz kılar; bilerek: `--force`).
   * **Anonimleştirme** (`src/lib/eval-real/anonymize.ts`): misafir / ev sahibi / ekip adları (Türkçe büyük/küçük
     harf ve kesmesiz ekler dahil; "Can/Deniz/Kaya" gibi yaygın sözcük adlar yalnız ad konumunda), mülk ve işletme
     adları, adresler, telefon (Arap-Hint rakamları dahil), e-posta, bağlantı, IBAN, plaka, kod, 4+ haneli ve 3+
     parçalı sayılar, geçmiş yıllı tarihler (doğum tarihi) maskelenir. Saat, yakın tarih, süre ve küçük sayılar
     kalır ("11 gibi", "13h30", "11Uhr", "2 nights", "14 - 16 Ekim", "2 kişi"). Sistemin yer tutucu adları
     ("Misafir", "Rezervasyon <kod>") ad sayılmaz. Serbest metindeki tanınmayan adlar yakalanamaz → son kapı insan
     (↓ "x").
   * **Katmanlı örnek** (tohumlu, tekrarlanabilir): GENİŞ aday katmanı (saat / tarih / konaklama sözcüğü geçen her
     mesaj, 7 dil) + geri kalandan rastgele. Aday süzgeci ürünün dedektörü DEĞİLDİR ve ondan bağımsızdır (pin):
     ürünün kelime ağıyla seçmek, kaçırdığı dolaylı istekleri sete hiç sokmazdı. Varsayılan 180 + 120. Katman
     boyutları dosyaya yazılır (oranlar yeniden ağırlıklanabilir).
   * Çıktı yalnız git'in yok saydığı `evals/private/` altına (ya da depo dışına) yazılır; aksi hâlde betik durur.
2. **Kör etiketleme:** `npx tsx scripts/eval-real-label.ts`. Veritabanına bağlanmaz. Her mesaj tek tek gösterilir;
   model ya da kelime ağı tahmini ve öğenin katmanı GÖSTERİLMEZ. Etiketler eval şemasıyla aynı (0 yok · 1 ek gece ·
   2 erken giriş · 3 geç çıkış · 4 tarih değişikliği · 5 müsaitlik) + "x" (kişisel bilgi kalmış → sete girmez) +
   "s" (emin değilim → sete girmez). Kural metni aracın başında (`LABEL_RUBRIC`): bilgi sorusu ("erken giriş
   ücretli mi?") = 0; erken gelip bavul bırakmak ya da "oda erken hazır olur mu" = 2; çıkıştan sonra eşya bırakmak
   = 3. Her cevaptan sonra kaydeder; yarıda bırakılıp devam edilebilir. Etiket dosyası aday dosyasının SHA-256'sına
   BAĞLIDIR: aday dosyası yeniden üretilirse eski etiketler reddedilir (sessizce yanlış mesajlara oturmaz).
3. **Mühür:** `npx tsx scripts/eval-real-label.ts --finalize` → `evals/private/stay-change-real.json` + SHA-256.
   Sette öğe katmanı (aday / rastgele) KALIR: sonuçlar katman katman raporlanır ve evren boyutlarıyla yeniden
   ağırlıklanabilir (etiketleme bittiği için körlüğü bozmaz).
   SHA `SEALS.json`a `"stay-change-real.json": { sha256, sealedAt, author: "kurucu (kör etiket)", items,
   state: "sealed", location: "local-only" }` olarak eklenir. Dosyanın kendisi depoya ASLA girmez (pin:
   `local-only` kaydının dosyası depoda olamaz; `evals/private/` takip edilemez).
4. **Final koşusu:** A ile birlikte, bir kez:
   `EVAL_SEALED_FINAL=1 EVAL_REAL_SET=evals/private/stay-change-real.json RUN_REAL_EVAL=1 npm run eval -- tests/eval/stay-change.eval.test.ts`.
   Harness gerçek seti yalnız bu koşuda ve SHA mühürle eşleşirse okur; raporda bölüm `real/<katman>`, metin YOK.
   A seti de koşudan önce SHA + `sealed` durumuyla doğrulanır; mühürlü koşuda `EVAL_STAY_LIMIT` reddedilir (yarım
   koşu seti boşa yakmasın). Koşu bitince iki setin durumu elle `burned` yapılır.
5. **Sonra:** yanmış gerçek set silinir (`evals/private/`). Sonraki karar için yeni örnek (yeni tohum) çekilir.

**KVKK / platform notları (kurucu onayıyla):**
* Amaç yalnız kalite ölçümü; üretim verisi otomatik eğitime GİRMEZ (CLAUDE.md). Veri en aza indirilir (yalnız
  mesaj metni + standart saat), anonimleştirilir, kurucunun makinesinde kalır.
* Final koşusunda metinler OpenAI'ye gider. OpenAI canlıda aynı mesajları zaten işleyen alt-işleyendir; yeni bir
  alıcı eklenmez. Başka hiçbir servise (Claude dahil) gönderilmez.
* Silme paritesi: canlı veriye geri bağ yok; bir misafir silme isterse ya da set yandığında yerel dosya bütünüyle
  silinir.
* Mesajların bir kısmı Airbnb kaynaklıdır (Hospitable üzerinden). Ev sahibinin kendi hizmet kalitesini ölçmek için
  yerel ve anonim kullanım olarak kurucu onaylar; avukat paketine not düşülür (değişmez 14: platform verisi
  politikası ayrı).

## Tüm geçmiş mesajların taraması — yalnız sayı (09-24)

Kurucu: "admin hesabından önceden çektiğimiz her mesajla kontrol edebilir miyiz — salt okuma". Set B örnektir ve
DOĞRULUK ölçer (kör etiket + model). Bu tarama ise TÜM geçmişe bakar, etiket ve model yoktur, kredi gerekmez;
yalnız "ne sıklıkta, hangi koşulda" sorusunu cevaplar.

`npx tsx scripts/eval-real-stats.ts --email <giriş e-postası>` (isteğe bağlı `--max 50000`, `--force`).

* Aynı salt-okuma kapısı: dışa aktarım betiğinin pinli `readOnly` yardımcısı (ilk komut `SET TRANSACTION READ ONLY`,
  `SHOW transaction_read_only` doğrulaması, 60 sn sınır); bu betikte yalnız SELECT (mekanik pin
  `tests/unit/eval-real.test.ts`). Yalnız kuruluş SAHİBİ; okumadan önce "EVET".
* Çıktı YALNIZ SAYI (`src/lib/eval-real/replay-stats.ts`, saf): taranan misafir mesajı; kelime ağının konaklama
  değişikliği saydığı mesajlar tür tür (ALT SINIR — kelime ağı yedektir, dolaylı dili kaçırır); yalnız erken giriş
  isteklerinden varış günü sorulanlar, aynı gün devir olanlar, o devrin temizlik görevi olanlar, misafir sorduğunda
  daire hazır olanlar, standart girişe kadar hazır olanlar (temizlikten sonra yeniden değerlendirmenin payı) ve
  soruların yerel saat dağılımı. Metin, ad, kimlik, tarih ekrana da dosyaya da girmez (pin).
* Hazırlık ve tarih kuralı ürünle AYNI (`early-checkin/readiness.ts`, `calendarDateOf`). Geçmişe bakışın sınırı:
  görevin bugünkü "bitti" kaydı o ana göre değerlendirilir; sonradan yeniden açılıp kapanan görev ayırt edilmez.
* Dosya git'in yok saydığı `evals/private/replay-stats.json`e yazılır; sayılar paylaşılabilir, depoya kurucu
  isterse elle girer.

## Sınırlar

* A seti sentetiktir; B seti gerçektir ama tek işletmenin (kurucunun) misafirleridir. Gerçek trafik ölçüsü ayrıca
  `kbEvidenceJson.sc` / `.ir` kanıtıdır (canlıda).
* Kör yazar bir dil modelidir. Geliştiricinin sistemini görmedi ama aynı model ailesinin yazım alışkanlıklarını
  taşıyabilir — B seti bu yüzden eklendi.
* B setinin etiketlerini tek kişi (kurucu) verir: etiketleyici tutarlılığı ölçülmez. İkinci bir etiketleyici
  (ekipten biri) aynı seti bağımsız etiketlerse uyum oranı raporlanabilir (ayrı iş).
