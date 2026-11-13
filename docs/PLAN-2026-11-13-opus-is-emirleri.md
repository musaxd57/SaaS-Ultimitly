# Uzun vadeli plan — iş emirleri (kurucu 11-13: "kodları Opus 5.5 yazsın, sen kontrol et; şimdiden tamamını belli et")

> Bu belge, işi YAZAN ajanın (Opus 5.5) ve işi DENETLEYEN oturumun (Fable) ortak sözleşmesidir. Bir iş emri bu belgeyi ve içinde adı geçen
> dosyaları okuyarak, başka açıklama almadan yürütülebilmelidir. Durum 13 Kasım 2026: `origin` = `40dc29b9`, CI 1799 yeşil.

## 0. Roller ve değişmeyen kurallar

**Opus 5.5 yazar** (kod, test, belge). **Fable denetler:** farkı satır satır okur, hedefli testleri ve mutasyonu koşar, tam kapıyı
(`npm run build` + `npm test`) koşar, push eder, CI'a bakar. Opus push ETMEZ, tam kapıyı KOŞMAZ, mutasyon koşucusunu çalıştırmaz.

Her iş emrinde Opus:
1. Önce okur: `CLAUDE.md`, iş emrinde adı geçen `docs/claude/*.md` dosyası ve tasarım belgesi. Kural orada bağlayıcıdır.
2. Çalışma yeri: `…/scratchpad/wt-dev` (dal `dev/gates`). Başka çalışma ağacına ve ana depoya yazmaz.
3. Koşabileceği testler: `npx vitest run -c vitest.devonly.config.ts <birim / görünüm dosyaları>` ve
   `npx vitest run --config vitest.eval.config.ts <eval dosyası>`. Veritabanlı (integration) testi YAZAR ama koşmaz — Fable koşar
   (tam takım koşarken ikinci bir vitest test veritabanını siler).
4. K2: kırmızı-önce (testi önce yaz, eski kodda kırmızı olduğunu göster) · aşırı uygulama kontrolü · mutasyon ÖNERİSİ
   (`$S/handoff/IE-<n>-mutasyon.json`, biçim `scripts/mutation-run.mjs` başlığında; her çapa dosyada tam bir kez geçer).
5. Commit: `git -c user.email=noreply@anthropic.com -c user.name=Claude commit -q -F -` + heredoc; ASCII başlık, backtick yok, model adı yok;
   son satırlar `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` ve oturum bağlantısı (CLAUDE.md "Git").
   `vitest.devonly.config.ts` ASLA commit edilmez.
6. Teslim notu: `$S/handoff/IE-<n>.md` — ne değişti (dosya:satır), hangi test koştu ve sonucu, koşamadıkları, emin olmadığı yerler,
   kurucuya sorulması gerekenler. Emin olmadığı şeyi "yaptım" diye yazmaz.

Hiçbir iş emrinin delemeyeceği kurallar (ayrıntı `CLAUDE.md`):
- Müşteriye / misafire GÖRÜNEN YAZIYI ya da misafire gideni değiştiren davranışı kurucu onayı olmadan değiştirme. Onay bu belgede "✅ onaylı"
  yazmıyorsa yoktur; öneriyi önce / sonra örneğiyle teslim notuna yaz, kodu anahtarın (varsayılan KAPALI) arkasına koy ya da hiç yazma.
- Misafire giden her metin ev sahibinin ağzından (üçüncü şahıs yasak) — belgedeki örnekler dahil.
- Mühürlü / kör / kabul setleri (`evals/sealed/**`, adı blind · holdout · kabul · acceptance · sealed · kör · "-kor" geçen dosyalar), `.env*`
  AÇILMAZ. Gerçek işletme adı, kişisel bilgi, sır depoya YAZILMAZ.
- Şema değişikliği (migration) yalnız "✅ migration onaylı" iş emrinde. Para / e-posta / kimlik akışında davranış değişikliği yalnız onayla.
- Test atlama, yeniden deneme, gevşetilmiş sınır, taban büyütme YOK. Testi geçirmek için kısa yol YOK.
- Ücretli model çağrısı (OpenAI / Anthropic API) yalnız "✅ ücret onaylı" iş emrinde.

`$S` = `/tmp/claude-0/-home-user-SaaS-Ultimitly/4b3a6b83-dfb6-5a82-b43d-8777d09e2d05/scratchpad`

## 1. Sıra (bağımlılıklarıyla)

| # | İş emri | Kurucu cevabı gerekir mi | Ücret |
|---|---|---|---|
| İE-1 | UX denetimi kaydı (belge) | hayır | yok |
| İE-2 | UX: metin değiştirmeyen ikinci görsel dilim | kısmen (UX-4) | yok |
| İE-3 | Zaman yolculuğu: +200 ve +420 gün taraması, bulunan bombalar | hayır | yok |
| İE-4 | UX: onay gelen metin / davranış düzeltmeleri | EVET (UX-1…UX-12) | yok |
| İE-5 | Anlamsal mimari 1: kaynak sunumu (kimlikli, tarihli kayıt) | AM-1, AM-4 | ölçüm için kredi |
| İE-6 | Anlamsal mimari 2: anlama şeması alanları | AM-1 | kredi |
| İE-7 | Anlamsal mimari 3: yeni cevap istemi + yapısal şema, GÖLGEDE | AM-1, AM-2, AM-3 | kredi |
| İE-8 | Anlamsal mimari 4–5: yargıçlar, kelime kapıları yedeğe | AM-6, AM-7 + İE-7 ölçümü | kredi |
| İE-9 | Kör (kabul) koşuları + ham kolun gpt-5.1 koşusu | OpenAI kredisi | ≈ birkaç dolar |
| İE-10 | Migration turu (S1 · S6 · S7 · S8 · 3c) | EVET (tek açık onay) | yok |
| İE-11 | Fable denetiminin dar istem bulguları | EVET (madde madde) | kredi |
| İE-12 | Claude çalışma paketi: rapor için bütçe ayırma | hayır | yok |
| İE-13 | Railway açılış provası (belge + env denetimi) | açılış tarihi | yok |

Cevap gerektirmeyenler (İE-1, İE-3, İE-12, İE-2'nin onaysız kısmı) hemen yürür. Ötekiler kurucu cevabıyla açılır; cevap gelmeden kodu yazılmaz.

## 2. İş emirleri

### İE-1 — UX denetimi kaydı (yalnız belge)
Girdi: `$S/cw5/claude-work-out/ux/REPORT.md`, `ux/all-findings.json` (531 bulgu), doğrulama `$S/cw5/verify-A.md` … `verify-D.md`
(270 P0 + P1: ≈ 103 doğru · 78 kısmen · 49 yalnız görsel · 19 kurucu kararına çarpıyor · 12 deneme ortamının artığı · 2 yanlış).
Çıktı: `docs/INCELEME-2026-11-13-ux-denetimi.md` + `docs/olcum/ux-denetim-2026-11-13/` (rapor, dört doğrulama tablosu, bulgular).
- 🚨 Sansür: yasal sayfa bulgularındaki satıcı adı, vergi numarası, adres, telefon, e-posta depoya yazılmaz — "satıcı adı" vb. diye anılır
  (rapor ve `all-findings.json` kopyalanırken o alanlar değiştirilir; kopyadan sonra `grep` ile doğrula).
- Bölümler: yöntem ve sınırlar · sayılar · 33 P0'ın tek tek hükmü · gerçek kusurlar (kök sebebe göre) · deneme ortamının artıkları ·
  kurucu kararına çarpanlar (kararın dosya:satırı + bedeli) · 40dc29b9'da yapılan görsel düzeltmeler · kurucu soruları (§3, önce / sonra) ·
  önerilen sıra. `docs/claude/durum.md` ve `acik-isler.md`'ye birer satır.
- Denetçinin her bulgusu ajan tablosundaki hükümle yazılır; hüküm şüpheliyse kodda bak, bakamadıysan "doğrulanmadı" de.

### İE-2 — UX: metin değiştirmeyen ikinci görsel dilim
Kapsam (yazı değişmez; her biri görünüm testiyle): yıkıcı düğmelerle komşu düğme arasına boşluk (konuşmada Sil ↔ geri, dairede
Mülkü sil ↔ Geri; onay pencereleri zaten var) · telefondaki menüde kaydırma ipucu · takvimde masaüstünde boş ay için mevcut boş durum
metninin gösterilmesi (aynı metin) · tıklanabilir kartlarda görsel ipucu (ok) · önce / sonra ölçümü: `scripts/claude-work/screenshots.ts`
ile yerel gezi, sayfa başına 40 px altı hedef sayısı tablosu (`$S/probe/ux-local-run-2` "önce").
UX-4 onaylanırsa: telefonda konuşma ayrıntısında yanıt kutusu + Gönder ekranın altına sabitlenir (`conversation-thread.tsx`; masaüstü
yerleşimi `docs/claude/acik-isler.md` "Panel yerleşimi (lg)" pinli — yalnız `lg` altı dal değişir; iPhone benzetiminde ekran görüntüsü).

### İE-3 — Zaman yolculuğu taraması
`node scripts/time-travel.mjs 200` ve `420` (Fable koşar; her biri ≈ 40 dk, vitest yuvasını tutar). Opus kırmızıları ayırır: ağ / sertifika
artığı mı, gerçek bomba mı. Gerçek bomba = sabit tarihli fikstür + saati okuyan ürün yolu → `tests/helpers/stay-dates.ts` ile bağıl tarih,
`tests/unit/stay-fixture-dates.test.ts` pinine yeni sınıf. ÜRÜN kodunda tarihe bağlı gerçek hata çıkarsa düzeltme ayrı iş emri (kurucuya yazılır).

### İE-4 — UX: onaya bağlı metin / davranış düzeltmeleri
§3'teki UX-1…UX-12'den yalnız "evet" denenler; her biri kendi commit'i, önce / sonra örneği teslim notunda. Kimlik akışına dokunanlar
(UX-3) için ilk denemeler kurucuyla birlikte.

### İE-5…İE-8 — Anlamsal karar mimarisi
Tek kaynak: `docs/TASARIM-2026-11-12-anlamsal-karar-mimarisi.md` §5 (hedef), §6.2b (sıra), §6.3 (güvenlik yedekleri), §7 (ölçüm);
Fable'ın taslağı `docs/olcum/fable-denetim-2026-11-13/hedef-tasarim.md`. İlke: anlam kararı modelde, kanıt + sınır kodda; **yama değil
gölgede yeni hat** (eski hat gönderir, yeni hat yalnız kaydedilir ve ölçülür).
- İE-5 kaynak sunumu: modele giden bilgi satırı kimlikli (N1…), tarihli, başlık önekli; blok başlığı yansız. Anahtar varsayılan KAPALI;
  deterministik, model çağrısı eklemez. Tek boğaz `selectKbForPrompt` (`docs/claude/retrieval.md`). Ölçüm: geliştirme setleri, açılış kipi
  (`EVAL_PROFILE=launch`), iki kol.
- İE-6 anlama şeması: istek başına varlık / özellik / koşul / edim / hassaslık alanları (yalnız kaydedilir; karar girdisi olmaz).
- İE-7 yeni cevap istemi + yapısal şema GÖLGEDE: istek başına karar + not kimliği + birebir alıntı + cümle; mekanik denetim
  `tests/eval/raw-arm.ts` kurallarının ürün karşılığı (alıntı notta, sayı alıntıda). Misafire HİÇBİR ŞEY gitmez; gölge kaydı + ölçer.
- İE-8 yargıçlar ve kelime kapılarının yedeğe çekilmesi: her kapı önce "yalnız kaydet"; bilgisizlik kuralı en son. Açma ölçütü: kör sette
  yanlış gönderim eski hattan fazla değil, gereksiz tutma az. Açma kararı kurucunun.
Her dilimde: anahtar kapalıyken çıktının bayt bayt eski hâl olduğu testle pinlenir.

### İE-9 — Kör koşular + gpt-5.1 ham kolu (✅ ücret: OpenAI kredisi gelince)
Komutlar `docs/INCELEME-2026-11-12-istem-denetimi.md` §6.4 ve `$S/probe/run-arm.sh`; açılış kipinde. Mühürlü seti YALNIZ ölçer okur; Opus
ve Fable içeriğini açmaz, toplam sayılar raporlanır. Sonra `SEALS.json` "burned" + erişim pini. Ham kol: aynı yansız istemle gpt-5.1
(≈ 0,5 dolar) → "model mi, hat mı" ayrımı.

### İE-10 — Migration turu (yalnız kurucu "evet" derse)
Tasarım `docs/TASARIM-2026-11-11-kurucu-kararlari-s1-s8-3b-3d.md` §13. Yalnız yeni tablo / nullable kolon / index; dolu tabloya zorunlu
alan, `@unique`, drop YOK. Migration `prisma migrate diff … --script` ile üretilir, taze veritabanında sıfır sapma doğrulanır.

### İE-11 — Fable denetiminin dar istem bulguları
`docs/INCELEME-2026-11-13-fable-istem-denetimi.md` §6'daki maddeler; her biri misafire gideni değiştirir → madde madde onay + ölçüm.

### İE-12 — Claude çalışma paketi: rapor bütçesi
`scripts/claude-work/run.ts`: istek 4'te bütçe bittiği için kurucu raporu üretilmedi. Rapor ve yeniden tasarım adımları için ayrılmış pay
(`taskBudgetUsd` içinde ayrı anahtar ya da `call`a `reserveUsd`): isteğe bağlı adımlar kalan bütçe payın altına inince atlanır ve adıyla
günlüğe yazılır. Saf karar fonksiyonu + birim testi. Ücretli koşu YOK.

### İE-13 — Railway açılış provası
`docs/RAILWAY-ACILIS-2026-10-15.md` ile koddaki bayrakların eşliği (pin var), migration 93–95 sırası, açılış kipinin 16 anahtarı, yedek adımı.
Yalnız belge ve salt-okuma denetim; canlıya dokunulmaz.

## 3. Kurucuya sorular (kısa; her birinde önerim)

**UX (denetimden; hiçbiri sorulmadan değişmez)**
- **UX-1 QR'da sessizlik.** Model cevap vermeyince misafir ekranı hiçbir şey göstermiyor; misafir aynı soruyu yeniden yazıyor. K10 kararınız
  ("hiçbir şey gitmesin") cümleyi yasaklıyor. Önerim: cümle YOK, balonun altında yalnız küçük "Gönderildi" işareti. Evet / hayır?
- **UX-2 Ev sahibi QR yanıt kutusundaki uyarı.** Bugün: "Kapı kodu, Wi-Fi şifresi ve kişisel/hassas bilgileri buraya yazmayın…". 10-11
  kararınız QR'da Wi-Fi verilmesine izin veriyor. Önerim: "Kapı kodu ve kişisel/hassas bilgileri buraya yazmayın…". Evet / hayır?
- **UX-3 Kayıt ve plan düğmeleri pasifken sebep söylemiyor.** Önerim: düğme hep basılabilir; onay kutusu boşsa tarayıcının kendi uyarısı
  kutuyu gösterir (yeni yazı yok). Evet / hayır?
- **UX-4 Telefonda konuşma ekranında Gönder aşağıda kalıyor.** Önerim: yanıt kutusu + Gönder telefonda ekranın altına sabit. Evet / hayır?
- **UX-5 Tanıtım turu.** "API bağlama anlatımı / token'ı yapıştır" başlığı ve örnek cevap "…I'll confirm with the host" (üçüncü şahıs + çelişki).
  Önerim: başlık "Kurulum nasıl yapılır?"; örnek cevap ev sahibinin ağzından, tek anlamlı. Metni ben mi önereyim, siz mi yazarsınız?
- **UX-6 Yasal sayfalar.** Güvenlik sayfasında "avukat incelemesindedir" notu yayında; cayma hakkı iki maddede çelişkili okunuyor; satıcı
  bilgilerinde Gmail adresi ve "MERSİS/Vergi" etiketi. Bunlar hukuk / işletme kararı — hangilerine dokunalım?
- **UX-7 Bağlantılar sayfası.** Hospitable'ın ne olduğu yazmıyor; aynı şeye dört ad. Önerim: tek cümle açıklama + her yerde "bağlantı anahtarı".
- **UX-8 Deneme süresi.** Kalan gün yazıyor, bitiş TARİHİ yazmıyor. Önerim: "… (12 Aralık'ta biter)" eklensin. Evet / hayır?
- **UX-9 Çıkış yapmış misafire "giriş gününüzde tekrar okutun" gidiyor.** Önerim: girişten önce / çıkıştan sonra iki ayrı metin. Evet / hayır?
- **UX-10 Girişler sayfasında eksik satırlarının yanında eylem yok** (11-05 kararıyla salt-okuma). Bugünkü hâli kalsın mı, tek dokunuşluk
  eylemler ("Birini ata", "Giriş bilgisini gönder") eklensin mi?
- **UX-11 Telefonda 44 px.** Bugünkü ölçümüz 40 px (yerel ezmeler düzeltildi). Tüm üründe 44 px'e çıkalım mı? Önerim: şimdilik hayır.
- **UX-12 Raporlar.** Üç konuşmayla "Mükemmel" etiketi çıkabiliyor. Önerim: 20 konuşmanın altında etiket gösterilmesin. Evet / hayır?

**Anlamsal mimari (ayrıntı ve örnekler tasarım belgesi §10):** AM-1 sıra · AM-2 koşullu bilgi (önerim: bilinen kısım koşuluyla gider) ·
AM-3 "ev sahibimiz" de tutulsun mu · AM-4 kaynak sunumu ölçümle · AM-6 doğrulayıcının maliyeti · AM-7 üç kararın bedeli ölçülsün mü.

**Kaynak / onay:** (K-1) OpenAI kredisi — kör koşular ve gpt-5.1 ham kolu bunu bekliyor · (K-2) migration turuna tek açık onay ·
(K-3) Fable bütçesinde 12,77 dolar kaldı (67,23 / 80) — kalanla bir şey denetletelim mi · (K-4) Railway açılış tarihi.

## 4. Denetim (Fable) — her teslimde
Farkı oku → teslim notundaki iddiaları kodda doğrula → hedefli testler → `scripts/mutation-run.mjs` (M0 yeşil olmalı) → dilim sonunda
Opus'a AYRI bir "en sert inceleme" (yazan ajan değil) → `wt-next` ileri sar → derleme + `npm test` (rapor satırı yeşil) → push → CI.
Kırmızıda önce sebep (bellek · kota · gerçek test), sonra düzeltme. Kurucuya yalnız sonuç ve ondan beklenen yazılır.
