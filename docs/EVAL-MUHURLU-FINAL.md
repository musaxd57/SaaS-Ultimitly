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

## Sınırlar

* Set sentetiktir. Gerçek trafik ölçüsü `kbEvidenceJson.sc` gölge kanıtıdır (canlıda, açmadan önce).
* Kör yazar bir dil modelidir. Geliştiricinin sistemini görmedi ama aynı model ailesinin yazım alışkanlıklarını
  taşıyabilir. Gerçek misafir mesajları (anonim, kurucunun elle yazdığı) sonraki setin en iyi kaynağıdır.
