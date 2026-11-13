# Fable 5.2 ile istem denetimi — bulgular, kodda doğrulama, sıradaki adım (2026-11-13)

> Kurucu 11-12 gece: "Fable 5.2'ye prompt kontrolleri yaptır; AI'ı etkileyen görece saçma şeyleri yazsın, AI promptlarını sertçe yorumlasın …
> hâlâ kelime ve ek bazlı çalışıyoruz, LLM'lerin anladığı gibi anlamalıyız … üst sınır 80 dolar."
> Bu belge o denetimin sonucudur. **Ürün kodu ve istemler DEĞİŞMEDİ** — misafire gideni değiştiren her düzeltme ölçüm + kurucu onayı ister.
> Ham çıktılar: `docs/olcum/fable-denetim-2026-11-13/` (`bulgular.json` 94 bulgu · `curutme-turu.json` · `hedef-tasarim.md` ·
> `kesik-mercek-ozetleri.md` · `kullanim.json`). Üst çerçeve: `docs/TASARIM-2026-11-12-anlamsal-karar-mimarisi.md`.

## 1. Ne koştu, ne tuttu, ne eksik kaldı

- **Koşu:** GitHub iş akışı (`claude-work.yml`, istek 4), model `claude-fable-5-2`. Denetçiye cevap istemi, anlama / bekçi / hakem /
  okuyucu / sıralayıcı istemleri (25 dosya) + iki karar belgesi + açılış kipinde **derlenmiş** istem (modelin gerçekten gördüğü metin)
  verildi. **Kapıların kodu verilmedi** — denetçi "kod şunu yapar" dediği yerde belgelere dayanıyor; bu yüzden bulgular kodda ayrıca
  doğrulandı (§3).
- **Tutar:** 50,78 ABD doları (istem denetimi 49,38 · ham model kolu 1,32 · biçim denemesi 0,08); 77 çağrı, hata yok. Tavan 55'ti.
- **Çıkan:** dört mercek (kaynak kullanımı · kelime kuralları · tuhaflıklar · yargıç istemleri) 94 bulgu yazdı: 15 P0, 57 P1, 22 P2.
  Denetçinin kendi çürütme turu 72 bulguya baktı: 34 "doğru", 38 "kısmen". Ayrıca tam bir hedef tasarım + yeni istem taslağı yazdı.
- **Eksik kalan (dürüstçe):**
  - Dört merceğin (çelişki · yapı · dil · derlenmiş istem yürüyüşü) bulgu listeleri **çıktı sınırına takılıp kesildi**; yalnız genel
    hükümleri var (`kesik-mercek-ozetleri.md`). Ana tespitleri öteki merceklerde de geçiyor, ama ayrıntılı listeleri yok.
  - Kurucu özeti (`REPORT.md`) yazılamadı (iş tavanı doldu) — bu belge onun yerine geçiyor.
  - Paranın yaklaşık yarısı önbelleğe yazmaya gitti: 1,6 milyon belirteç, yani ortak külliyat (yaklaşık 230 bin belirteç) bir kez
    değil yedi kez yazılmış. Koşucu külliyatı tek sistem bloğunda tutuyor; neden yeniden yazıldığı (çıktı şeması değişen çağrılar
    büyük olasılıkla ayrı önbellek açıyor) bir sonraki ücretli istekten önce incelenip düzeltilecek. Aynı düzeltmede mercek başına
    çıktı tavanı da yükseltilecek (dört merceği kesen buydu).

## 2. Denetimin ana hükmü (dört cümle)

1. **Cevap istemi tek bir tasarım değil, üst üste yamalanmış bir olay günlüğü**: taban metin yaklaşık 46.000 karakter + 12 bayraklı
   katman + 24 örnek; aynı kural 3–5 yerde yazılı ve yerlerin en az biri ötekiyle çelişiyor.
2. **Dürüst çıkışların hepsi yasak**: "hiçbir soruyu atlama" + "bilgim yok deme" + "yönlendirme" + "çekinceli konuşma"; izinli tek
   çıkış (düşük güven) turun tamamını tutuyor. Çok soruluk mesajda bildiğini kurtarmanın tek yolu bilmediğini uydurmak.
3. **İstem, kapıların yasakladığı cümleleri öğretiyor**: "Mesajınız kaydedildi; …" ve "bu konu … kararıdır" kalıpları yaklaşık 34 yerde
   ve 24 örneğin 14'ünde "yazılabilecek tek şey" diye geçiyor; aynı cümleler çıktı vetosu ve üçüncü şahıs kapısında kesin tutuluyor.
4. **Kararlar metinle ve tek bir güven sayısıyla veriliyor, şemayla değil**: `confidence` beş ayrı şeyi taşıyor (kaynak yok · teşekkür ·
   saat çelişkisi · belirsizlik · komut enjeksiyonu) ve gönderim şalteri olarak kullanılıyor.

Kurucunun asıl derdi olan "doğru varlık · sorulan özellik · gerçek değer · koşul · istisna" ilkesi canlı taban metinde yok; yalnız
kapalı duran katmanda var.

## 3. Kodda doğrulama (P0'ların tamamı + doğrulanmış P1'ler = 40 bulgu)

Üç Sonnet ajanı her bulguyu kodda ve açılış yapılandırmasında izledi (alıntı gerçekten orada mı · açılışta etkin mi · iddia edilen
çakışma gerçek mi · kurucu kararı mı). Sonuç: **15 aynen doğrulandı · 18 kısmen · 3 zaten kurucu kararı · 4'ünde denetçi yanıldı**
(açılışta açık / kapalı bayrağı ters varsaymış).

### 3.1 Misafire YANLIŞ bilgi gidebilenler

| # | Bulgu | Nerede | Doğrulama |
|---|---|---|---|
| 1 | **Çıkışsız tuzak.** Kaynağı olmayan soru için model ya uyduruyor ya turun tamamını yakıyor; düzelten katman açılışta kapalı | `prompts.ts` 128, 151–157, 215, 414; eşik `automation.ts` (güven < 0,75 → tur tutulur) | Doğrulandı. Ölçümdeki 9 yanlış gönderimin kaynağı bu; belgelerimizde de "genel karar kurucuda" diye açık duruyor |
| 2 | **Güven tablosu yakın-ıskayı gönderim eşiğinin üstüne koyuyor**: "bilgi kısmen mevcut" = 0,7–0,9 | `prompts.ts` 391 | Kısmen: çelişki gerçek, uydurmaya katkısı ayrıca ölçülmedi |
| 3 | **ÖRNEK 11 bilgi tabanında olmayan arıza adımını "doğru cevap" diye öğretiyor** (modemi kapatıp açma; kaynak diye yalnız Wi-Fi kaydı gösteriliyor) | `prompts.ts` 634 | Doğrulandı. Kurucu notu ("bozuklar için bilgi tabanında yazmayan öneri verilmez") ile çelişiyor. Kanal yolunda kısmi kemer var; **QR yolunda yok** (arıza adımı kapısı kapalı) |
| 4 | **Cevap uzunluğu sorunun kelime sayısına bağlı**: mesaj dört kelime ya da azsa "1–2 cümle" | `prompts.ts` 2012, 2032–2033 | Doğrulandı. Kısa "Giriş nasıl?" sorusunda adımlar kırpılabilir; açılışta bütün sohbetleri etkiler |
| 5 | **Soru işareti ve satır sayımı kesin olgu diye bildiriliyor** ("misafir N ayrı soru yazmış") | `prompts.ts` 850–889, 2031 | Doğrulandı. Çok satırlı tek şikâyet N soru sayılır; etkisi hafif |

### 3.2 DOĞRU cevabı tutturanlar (gereksiz tutma)

| # | Bulgu | Nerede | Doğrulama |
|---|---|---|---|
| 6 | **Öğretilen cümle = yasaklı cümle.** Devir cümlesi ve "… kararıdır" kalıbı istemde ezberletiliyor; kapılar tutuyor | `prompts.ts` 136, 449, 489, 556 + örnekler ↔ `output-veto.ts`, `host-voice-guard.ts` | Doğrulandı. Kurucu kararları (09-30 devir cümlesi gitmez · 10-01 "kararıdır" gitmez · 11-06 ev sahibinin ağzı) doğru; **istem tersini öğretiyor**. Açık katman 1527'de "bildirim cümlelerini EKLEME" diyor — istem açılışta kendi içinde çelişiyor |
| 7 | **"Bu bilgi kayıtlarımda yok" bir yerde emrediliyor, iki yerde yasak** | `prompts.ts` 128 ↔ 154–155, 456–458 | Kısmen: tek soruda tutma kurucu kuralı gereği; zarar çok soruluk turda — yanındaki doğru cevap da gitmiyor |
| 8 | **Saat çelişkisi bloğu konuya bakmadan her cevabın güvenini düşürtüyor** | `prompts.ts` 1816–1835 | Doğrulandı. Kod kapısı zaten yalnız çelişkili alana değen cevabı tutuyor; istem ilgisiz Wi-Fi cevabını da tutturuyor. Yalnız saatleri çelişen dairelerde |
| 9 | **Üçüncü şahıs / üçüncü taraf kalıbı yanlış tutuyor** | `host-voice-guard.ts` 36–55, 95–113 | Doğrulandı. "the owner bakes fresh simit" (fırının sahibi) ev sahibinden üçüncü şahısla söz etmek sayılıyor; "Eczane 200 metre ileride, sorun olmaz." cümlesindeki "sorun" iletişim fiili sanılıp üçüncü tarafa yönlendirme sayılıyor. Düzeltecek okuyucu açılışta kapalı |
| 10 | **Konaklama değişikliği üç modele üç farklı tanımla soruluyor** | `understand.ts` 102 · `guard.ts` 61 · `prompts.ts` 284–286 | Doğrulandı. Birleşim kuralı yüzünden üç tanımın her farkı tutuşa dönüyor |
| 11 | **Spam bölümü "EN ÖNEMLİ" diye başlıyor ama öncelik listesinde dördüncü**; "nasılsınız" kapanış sayılıyor | `prompts.ts` 100, 519–534 | Doğrulandı (belgelerimizde de kayıtlı; nezaket katmanı kapalı) |
| 12 | **Tam beş istek "model hepsini görmedi" sayılıyor** | `understanding-schema.ts` 460 | Kısmen: bilerek güvenli yön; o tur öğe kipinden çıkıyor |

### 3.3 Kurucu kararı olduğu için kusur sayılmayanlar (bedeli ölçülmeli)

| Bulgu | Karar | Denetçinin yazdığı bedel |
|---|---|---|
| Tehlike bildiren misafire hiçbir metin gitmiyor (gaz kokusu dahil) | 10-11 "112'yi arayın yazmasın" + 09-30 "hiçbir şey gitmesin"; ev sahibine acil uyarı gider | Ev sahibi uyarıyı görene kadar misafir sessizlikle karşılaşır |
| Cevaplanmayan soru hakkında misafire tek kelime yazılmıyor | 09-25 / 09-26 bekleme sözü ve "kaydedildi" gitmez | İki soru sorup birine cevap alan misafir ötekini yeniden sorar |
| Sigorta / gaz / kombi gibi cihazlarda çözüm adımı verilmiyor | Sabah Kararları 17 + 18 | — |

Bu üçü değişmedi ve değişmesi önerilmiyor; öneri yalnız **ölçmek** (tasarım belgesi §10 AM-7).

### 3.4 Denetçinin yanıldıkları

- **Ücret söylemek yasak** (kelime-06, tuhaf-07): açılışta ücret kuralı katmanı AÇIK; o satır "onaylı bilgi tabanındaki sabit hizmet
  ücretini koşullarıyla söyle" diye değişiyor. Denetçi tabanı ölçmüş, açılış katmanını değil.
- **Cevap parçaları bloğu** (kaynak-13, kaynak-14): açılışta yok (anahtar kapalı). Anahtar açılmadan önce geçerli olacak bulgular.
- **Karar yazıcısı "onayladık" diyemiyor** (kelime-22) ve **hakemde dolu alıntı "hayır"ı "evet" yapıyor** (yargic-04): ikisi de kapalı
  bileşenlerde; açılmadan önce düzeltilecekler listesine alındı.

## 4. Denetçinin hedef tasarımı (özet; tam metin `hedef-tasarim.md`)

- **Karar şemada verilir, metin yalnız kaynağı olan istek için yazılır, yargıç kanıt gösterir, kod yalnız kesin şeyleri doğrular.**
- Kaynaklar modele kimlikli, tarihli, kapsamlı belgeler olarak sunulur (bilgi notu · mülk alanı · ev sahibinin kendi mesajı · kayıtlı
  teklif · otomatik mesaj); "seçilmiş alt küme" olduğu belgenin niteliği olarak yazılır, emir olarak değil.
- Anlama şeması: misafirin kendi sözü (birebir kesit) + varlık / özellik / koşul + edim (bilgi soruyor / izin istiyor / iş istiyor /
  sorun bildiriyor) + hassaslık gözlemleri. 26 etiketli niyet listesi yalnız panel etiketi olur.
- Cevap şeması: istek başına **önce sorulan, sonra kanıt (belge kimliği + birebir alıntı), sonra karar, en son metin.** `confidence` yok.
- İki yargıç: destek yargıcı (olumlu hükmünde de alıntı göstermek zorunda) ve tek çağrılık taslak okuyucu (cümle tipleri).
- Yeni sistem istemi taslağı: yaklaşık 200 satır, tek parça, bayraksız; tek biçim örneği + üç sınır örneği. Kurucu kararları bilerek
  korunmuş (bilgisizlik / devir / bekleme sözü misafire gitmez · ev sahibinin ağzı · iç kaynak anlatılmaz · yönlendirme yok · platform
  dışı ödeme yok · tehlikede metin yok).
- Geçiş: ölçüm zemini → kaynak sunumu → anlama şeması → yeni cevap hattı **gölgede** → yargıçlar → kelime kapıları yedeğe. Kabul ölçütü:
  "kaçak artmadan gereksiz tutma azalıyorsa".

Benim tasarımımla (envanter + D0–D8) aynı yere varıyor; fark ve birleştirme tasarım belgesinin §6.2b'sinde.

## 5. Ham model kolu (aynı koşunun ikinci işi)

Aynı geliştirme senaryolarında, ürünün kapıları olmadan ve yaklaşık yirmi satırlık yansız istemle Fable 5.2'nin kendi kararı:
62 ihtiyacın 62'si doğru (34 cevap · 28 "kaynak yok / ev sahibinin kararı"), 0 yanlış gönderim, 0 gereksiz tutma. Ürün aynı sette 24
doğru · 10 gereksiz tutma · 9 yanlış. Ayrıntı ve dürüst sınırlar (model farkı ayrılmadı; geliştirme seti): tasarım belgesi §8,
rapor `docs/olcum/raw-arm-2026-11-13-fable-5.2.md`.

## 6. Sıradaki adım (öneri; hiçbiri uygulanmadı)

1. **Belirleyici ölçüm:** aynı ham istemi ürünün kendi modeliyle (gpt-5.1) koşmak. Yaklaşık yarım dolar; OpenAI kredisi gerekir. Sonuç
   iki yoldan birini seçer: gpt-5.1 de temizse sorun hattadır (istem + kapılar) ve yeni kısa hat doğrudan kazandırır; uyduruyorsa
   dayanak beyanı + bağımsız doğrulayıcı asıl iştir.
2. **Yeni cevap hattı gölgede** (denetçinin istem taslağı + yapısal şema): bugünkü hat göndermeye devam eder, yeni hat yalnız kaydedilir;
   dört hücre (kaçak · kapı kurtardı · gereksiz tutma — kapı · gereksiz tutma — model) ölçülür. Açma kararı kurucuda.
3. **Bugünkü istemde, ölçümle birlikte ele alınacak dar düzeltmeler** (yeni hat gelene kadar): ÖRNEK 11'deki kaynaksız arıza adımı ·
   güven tablosundaki "kısmen mevcut = 0,7–0,9" bandı · kelime sayısına bağlı uzunluk ipucu · saat çelişkisi bloğunun "her cevabı
   düşür" cümlesi · "misafir standart teslim bildirimini alır" (09-30'dan beri yanlış) cümlesi. Hepsi misafire gideni değiştirir →
   önce / sonra örneği ve ölçümle sorulur.
4. **Kapı yanlış pozitifleri** (üçüncü şahıs kalıbında "the owner" / "sorun"): kapıyı gevşeten değişiklik → ücretsiz tekrar oynatma
   ölçümüyle (`tests/eval/host-voice-replay.ts`) birlikte.
5. **Koşucu düzeltmesi** (bir sonraki ücretli istekten önce): önbelleğin yeniden yazılmasının sebebi + mercek başına çıktı tavanı;
   kesilen dört mercek istenirse yeniden koşulur (düzeltmeden sonra tahmini 8–10 ABD doları — tahmin, ölçüm değil).
