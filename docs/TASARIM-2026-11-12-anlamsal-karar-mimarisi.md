# Anlamsal karar mimarisi — envanter, hedef, geçiş planı, ölçüm (2026-11-12 gece)

> **Bu belge ne:** kurucunun 11-12 gece hedefi ("hâlâ kelime ve ek bazlı çalışıyoruz; LLM'lerin anladığı gibi anlamalıyız — bir misafir
> bu mesajı Claude'a ya da ChatGPT'ye yazsaydı alacağı cevabın anlayışında; bilgilerin kullanımında da aynı; Anthropic / OpenAI bu işi
> nasıl yapardıysa") ve Codex'in önerisi (kelime / kök kararlarının envanteri → anlam modele, kesin kural koda → ham model ↔ ürün
> karşılaştırması → geçiş planı + küçük bir örnek dilimin önce / sonra sonucu) için **tasarım + ölçüm**. Ürün kodu DEĞİŞMEDİ. Misafire
> gideni değiştiren her adım: anahtar arkasında, ölçümle, kurucu onayıyla (§10 sorular).
> Kaynaklar: beş Sonnet envanteri + Opus doğrulaması (33 iddia: 29 doğrulandı, 4 kısmen, 0 yanlış) · Fable 5.2 denetimi (istek 4) ·
> `docs/INCELEME-2026-11-12-istem-denetimi.md` (bugünkü ölçümler) · `docs/TASARIM-2026-11-12-dayanak-ve-yetki-mimarisi.md` (D0–D6 — bu belge onun
> üst çerçevesi; çelişkide yenisi geçerli sayılmaz, kurucuya sorulur).

## 1. Kısa cevap

1. **Bugün:** açılış yapılandırmasında misafire gideni etkileyen **17 anlam kararı saf kelime / kök eşleşmesiyle** veriliyor (§2). Bir
   kısmı modeli hiç çalıştırmadan (önce), çoğu modelin cevabından sonra (geçersiz kılarak) çalışıyor.
2. **Bedeli iki yönde de ölçülmüş** (geliştirme seti, 62 ihtiyaç): bugünkü hat **24 doğru · 10 gereksiz tutma · 9 yanlış gönderim**. Kelime
   kapıları yanlışı durdurmuyor (9 yanlış geçti) ve doğruyu tutuyor (10 doğru cevap gitmedi).
3. **Hedef:** anlam (konu, niyet, soruların ilişkisi, kaynak sorulanı destekliyor mu, koşul bu durumu kapsıyor mu) **modelde**; kanıt ve
   sınır (kaynak bu dairenin mi, sürümü güncel mi, alıntı kaynakta birebir mi, sayı alıntıda mı, bu karar için açık yetki var mı, işlem
   tekrar edilebilir mi) **kodda**. Benzerlik puanı, kelime örtüşmesi ve modelin "eminim"i kanıt değildir.
4. **Yol:** sekiz dilim (§6); her biri tek bir kelime kuralının yerine yapısal bir model beyanı + kodun mekanik denetimini koyar; önce
   gölge ölçüm, sonra kör kabul, sonra anahtar. Güvenlik yedekleri toplu kalkmaz (§6.3).
5. **Örnek dilim (kaynak desteği kararı) önce / sonra:** §8.

## 2. Envanter — bugün hangi anlam kararı kelimeyle veriliyor

Yöntem: alan başına bir Sonnet ajanı (anlama · ihtiyaç defteri · retrieval · parça + bağlama · okuyucu + çıktı kapıları) → Opus her iddiayı
kodda satır satır izledi (misafir cümleleri çalıştırılmadı; kod yolu izlendi). Açılış yapılandırması `docs/RAILWAY-ACILIS-2026-10-15.md`
§1'e göre: anlama modeli, öğe kipi, şikâyet takibi (ilişki kipi), anlamsal getirme + yeniden sıralayıcı, konaklama koruması, "ev
sahibinizin kararıdır" tutması AÇIK; cevap sonrası okuyucular (bilgim yok hakemi, kıdemli okuyucu, yönlendirme hakemi) ve cevap parçaları
kipi KAPALI. Sonuç: **açılışta cevap çıktıktan sonraki anlam kararlarının tamamı kelime kapılarında.**

Sınıflar: **A** anlam kararı → modele taşınmalı · **B** kesin kural → kodda kalır · **C** güvenlik yedeği → tek tek değerlendirilir ·
**D** aday bulma (getirme) → kelime kalabilir, karar veremez. Konum: **Ö** modelden önce · **S** modelden sonra (geçersiz kılar / tutar).

### 2.1 Açılışta ETKİN olanlar (misafire gideni bugün belirleyenler)

| # | Karar | Nerede | Bugün nasıl | Konum | Sınıf | Yerine geçecek model beyanı | Kodda kalacak kesin denetim |
|---|---|---|---|---|---|---|---|
| 1 | Şikâyet / iade → konuşma "Sorunlu", e-posta gider, yapay zekâ durur | `automation.ts` `sendDueAlerts` | şikâyet / iade sözcük listesinde düz alt dize ("koku", "kirli", "iade") | Ö — model hiç çalışmaz | A (+C) | anlama: "şu an süren bir sorun bildiriyor mu", "para isteği: iade talebi / koşul sorusu / yok" | acil + erişim kaybı ağı kalır; "Sorunlu" geçişi tek sefer (idempotent) |
| 2 | Türüne bağlanamayan kelime etiketi → mesajdaki BÜTÜN istekler hassas | `conversation-items/core.ts` | risk ağı etiketi kendi türünde istek bulamazsa hepsine yazılır | S | A / C | istek başına "hassas mı + sebep (kapalı küme)" | etiket yalnız model koşmadığında yedek |
| 3 | Erişim sözcüğü modelin ilişki işaretini ezer | `conversation-items/relation.ts` | "kapı / anahtar / giriyor / çıkıyor…" kalıbı iki tarafta varsa istek şikâyete bağlı sayılır | S | A / C | istekte ve şikâyette "fiziksel erişimle ilgili mi" | ikisi de evet → bağımlı |
| 4 | Ev sahibinde bekleyen cihazın adı cevapta geçerse cevabın tamamı tutulur | `relation.ts` + kapı | cevap metninde konu sözlüğü kesişimi | S | C (A nitelikli) | cevap parçasında "değindiği bekleyen öğe kimlikleri" | kimlik bu konuşmanın bekleyen öğesi mi |
| 5 | İstem devir cümlesini öğretiyor, çıktı vetosu tutuyor | `prompts.ts` (32 satır) ↔ `output-veto.ts`, `host-voice.ts` | istem "Mesajınız kaydedildi; …" kapanışını örnekliyor, veto aynı cümleyi kalıpla yakalıyor | S | A (istem çelişkisi) | istemden çıkar; "bu istek ev sahibinde kalıyor" yapısal alanı | misafire söz / makbuz yokluğu kuralı |
| 6 | Üçüncü şahıs kapısı | `host-voice-guard.ts` | kalıp (çıplak "ev sahibi" ve "ev sahibimiz" de eşleşir) | S | A | okuyucu: "ev sahibinden üçüncü şahıs olarak söz ediyor mu + alıntı" | alıntı taslakta birebir |
| 7 | Evcil hayvan tur kemeri | kapı | turda ya da cevapta evcil hayvan sözcüğü + bilgi tabanı okuması | S | A (kararın kendisi B: kurucu) | okuyucu: "ev sahibindeki kararı sızdırıyor mu + alıntı" | yardımcı hayvan her zaman ev sahibinde |
| 8 | Bilgi tabanında "evcil hayvan ücretsiz ve koşulsuz" okuması | `conversation-items/pet-policy.ts` | kalemde herhangi bir RAKAM varsa "koşullu" sayılır ("…kabul edilir. Giriş 15:00" → koşullu) | Ö | A | dayanak sözleşmesi (§5 G): nottaki koşul + sorulan durumu kapsıyor mu + alıntı | alıntı kalemde birebir; belirsiz → ev sahibi |
| 9 | "Bilgim yok" itirafı | `ai/absence.ts` | yedi dilde kalıp | S | A | okuyucu alanı var (kapalı): "eksik bilgi itirafı + alıntı" | alıntı doğrulaması |
| 10 | Ev sahibine yönlendirme cümlesi silme / tutma | `ai/index.ts`, kapı | kalıp + kök örtüşmesi | S | A | okuyucu: "ev sahibine yönlendiriyor mu: kapanış / konu / güvenlik + alıntı" | silinen alıntı birebir; kalan boşsa tut |
| 11 | İç kaynak adı ("kayıtlarıma göre") | kapı | kalıp (okuyucu varsa birleşim) | S | A | okuyucu alanı var (kapalı) | — |
| 12 | Konu etiketi + "aynı konu mu" | `conversation-items/topic-label.ts`, `core.ts` | sözcük süzgeci + kök örtüşmesi | S | A | istekte "şu açık öğeyle aynı mı (kimlik)", "şunu geri çekiyor (kimlikler)" | kimlik bu konuşmanın açık öğesi, aynı işletme |
| 13 | "Ev sahibi cevapladı" | `core.ts`, `store.ts` | yalnız zaman sırası (içerik okunmaz) | S | A | ev sahibi mesajında "kapattığı öğe kimlikleri" | belirsizse kapatma |
| 14 | Konu örtüşmesi / belirsiz işaret → şikâyete bağlı | `relation.ts` | sözlük konusu | S (yalnız sıkılaştırır) | C | ilişki işareti (var) + "hangi cihaz" | işaret yok / belirsiz → tut |
| 15 | Kapanış ("teşekkürler") beyaz listesi | `automation.ts` | tam sözcük listesi; model çağrılmaz | Ö | A (dar) | anlama: "teşekkür / kapanış" + "gizli bir istek var mı" | hepsi kapanışsa sessizlik |
| 16 | Söz / eylem beyanı vetosu | `output-veto.ts` | kalıp (edilgen çatıyı bilerek almıyor) | S | A | cevapta "üstlendiği eylemler" alanı (var, kapalı) | boş olmayan beyan → tut |
| 17 | Kural ihlali ağı | `fallback.ts` | alt dize + "parti" tam sözcük | S | A | anlama: kural konusu + tutum (var, yalnız gölge) | — |

Ayrıca etkin ama model ağırlıklı: müsaitlik vetosu (iki model katmanı + kelime yedeği) · yeniden sıralayıcı (yalnız SIRA verir, "bu kayıt
soruyu destekliyor mu" hükmü vermez).

**Getirme (D sınıfı, açılışta etkin):** göreli eşik + 6.000 karakter bütçesi modelden kalem gizleyebilir · parça, kalemin koşul / liste
başlığını taşımaz (`KB_TABLE_HEADER` kapalı) · modele giden bilgi satırında kimlik, güncellenme tarihi, kaynak türü yok; blok başlığı
"GERÇEK BİLGİLER — sadece bunları kullan" (yakın konulu kaydı "cevap" gibi sunar).

**QR sohbeti:** QR kapısında öğe kipi yok; şikâyet / iade / erken ayrılış / insan talebi kelime vetosu orada bugün de tek başına karar
veriyor (`guest-chat-gate.ts`).

### 2.2 Bayrağı kapalı olanlar (cevap parçaları kipi açılırsa devreye girecekler)

Parça başına model yalnız dört alan beyan ediyor (kimlik, durum, metin, alıntı); varlık, koşul, olumluluk ve değer **kodda sözlükle
yeniden okunuyor**: olumsuzluk belirteç listesi ("Sorun yok, evcil hayvan kabul ediyoruz." → olumsuz okunur) · sayı sözcüğü listesi +
aksan sökme (Fransızca "très" → İspanyolca "tres" = 3) · tesis kökleri (10 tesis × 7 dil; "basen", "zwembad" yok) · isteğin konusu sözcük
listelerinden. Codex'in Spain / spa bulgusu bu ailenin bir üyesi: yeni istisna eklemek aileyi büyütür, kapatmaz (§6 D7).

### 2.3 Misafire gideni açılışta en çok etkileyen beşi

1. **`sendDueAlerts`** — "koku", "kirli", "kötü", "iade" alt dizesi tutarsa konuşma model hiç görmeden "Sorunlu" olur, yapay zekâ susar.
   Sınıflandırıcı çalıştırılarak doğrulandı: "Klimanın kokusu güzelmiş, hangi marka?" → şikâyet · "Anahtarı iade edeceğimiz yer
   neresi?" → iade talebi. İkisi de bugün ev sahibine "sorunlu konuşma" uyarısı olarak düşer ve cevaplanmaz.
2. **Türüne bağlanamayan etiket** — "Yarın erken çıkacağız, anahtarı nereye bırakalım? Bir de Wi-Fi şifresi neydi?": kelime ağı "erken
   çık" yüzünden "iptal" etiketi üretir (çalıştırıldı); model istekleri "anahtar teslimi" ve "Wi-Fi" diye çıkarınca etiket kendi türünü
   bulamaz ve mesajdaki bütün istekler hassas olur (kod yolu izlendi) — Wi-Fi sorusu da gitmez.
3. **İstem ↔ veto çelişkisi** — istem 32 satırda devir cümlesini öğretiyor ("Mesajınız kaydedildi; …"), çıktı vetosu aynı cümleyi
   tutuyor (kurucu kararı 09-30: devir cümlesi misafire gitmez). Model öğretileni yazıyor, kod tutuyor: gereksiz tutma.
4. **Üçüncü şahıs kapısı** — "ev sahibimiz" de tutuluyor; doğru mu yanlış mı kurucu sorusu olarak açık (11-06'dan beri listede).
5. **Evcil hayvan kemeri + rakam = koşul okuması** — evcil hayvan sorusu olan turda yanındaki doğru cevap da gitmiyor; bilgi tabanında
   "ücretsiz kabul edilir" yazsa bile kalemde başka bir rakam varsa "koşullu" sayılıyor.

## 3. Hedef ne demek — üç örnek

Güçlü bir modele doğrudan yazan misafir şunu alır: sorusu anlaşılır, eldeki bilgiyle cevaplanabilen kısmı cevaplanır, bilgi başka bir
şeyi anlatıyorsa o bilgi sorunun cevabıymış gibi kullanılmaz. Lixus'ta buna iki şey eklenir: cevap ev sahibinin ağzından çıkar ve
cevaplanamayan kısım misafire "bilgim yok" diye gitmez, ev sahibine kalır.

| Misafir | Notta yazan | Bugünkü hat (ölçülmüş) | Hedef |
|---|---|---|---|
| "Kahvaltı veriyor musunuz?" | yalnız "Restoran önerileri" kaydı | "Kahvaltı hizmeti sunmuyorum." gitti (kayıt yok; uydurma) | Kayıt ilgili ama "kahvaltı yok"u desteklemez → **kaynak yok**; bu istek ev sahibinde kalır, misafire bir şey gitmez |
| "Havuz hafta içi kaça kadar açık?" | "Havuz hafta sonu 23:00'e kadar açık" | (bu sınıf: taşınmış değer) | Nottaki koşul (hafta sonu) soruyu (hafta içi) kapsamıyor → **kaynak yok** (ya da kurucu isterse koşuluyla birlikte söylenir — §10 AM-2) |
| "En yakın eczane ne kadar uzakta?" | "En yakın market 150 metre" | "Deniz Lokantası … yaklaşık 150 metre" türünde taşıma gitti | Sorulan varlık (eczane) ≠ nottaki varlık (market) → **kaynak yok** |
| "Otopark var mı? Bir de çıkış saati kaç?" | ikisi de yazılı | (çok mesajlı turda) biri atlanabiliyor | İki istek ayrı ayrı çıkarılır, ikisi de kendi notundan cevaplanır: "Otoparkımız ücretsiz. Çıkış saatimiz 11:00." |

Bunların hiçbiri yeni bir sözcük listesiyle çözülmez: "restoran ≠ kahvaltı", "market ≠ eczane", "hafta sonu ≠ hafta içi" kuralları
yazılabilir, ama bir sonraki mesajda "fırın ≠ pastane" gelir. Karar, soruyu ve notu birlikte okuyan modelin; kodun işi o kararın
dayandığı parçayı **sınanabilir** hâle getirmek.

## 4. İlkeler

- **P1 — Anlam tek yerde çıkarılır.** Mesajın istekleri, her isteğin konusu / niyeti / hassaslığı / önceki öğelerle ilişkisi tek bir
  yapısal model çıktısıdır; aynı soru başka bir katmanda sözcükle yeniden sorulmaz.
- **P2 — Getirme aday bulur, hüküm vermez.** Kelime örtüşmesi ve benzerlik puanı yalnız "hangi kayıtlar modele gösterilsin" sorusunu
  cevaplar. Gösterilen kayıt kimlikli, tarihli ve bağlamıyla (hangi kalemin hangi başlığı altında) gelir.
- **P3 — Dayanak beyanı sınanabilir olmalı.** Model her cevap cümlesi için kaynağın kimliğini ve kaynaktan birebir alıntıyı verir;
  sorulan varlık ↔ kaynaktaki varlık, kaynaktaki koşul ve o koşulun soruyu kapsayıp kapsamadığını ayrı alanlarda beyan eder.
- **P4 — Modelin beyanı kanıt değildir.** Kod kimliği, alıntıyı ve sayıları mekanik olarak sınar; ikinci, bağımsız bir okuma aynı
  alanları yeniden doldurur; ikisi ayrışırsa cümle gitmez.
- **P5 — Yetki kodda.** "Bu cevabı vermeye ev sahibinin izni var mı" sorusunu model değil, kayıt cevaplar: açık bir politika kaydı, bir
  ev sahibi kararı ya da kurucunun kalıcı kuralı. Model yalnız "bu istek karar gerektiriyor mu" ve "kayıt bunu açıkça söylüyor mu"
  sorularını (alıntıyla) cevaplar.
- **P6 — Cevap onaylı cümlelerden kurulur.** Denetimden geçmeyen isteğin cümlesi düşer; öteki isteklerin cevabı gider (tur toptan
  tutulmaz). Selam ve dil kodla.
- **P7 — Her hata bir katmana yazılır.** Anlama mı kaçırdı, kayıt mı gelmedi, dayanak mı yanlış kuruldu, doğrulayıcı mı kaçırdı /
  gereksiz mi tuttu, politika mı tuttu. Doğru cevabın tutulması yanlış gönderim kadar hatadır ve aynı tabloda görünür.
- **P8 — Boğarak geçiş.** Kelime kuralları tek tek, ölçülerek değişir: önce gölgede (yan yana kayıt), sonra kör kabul, sonra anahtar.
  Güvenlik yedekleri toplu kalkmaz.

**Kodda kalanlar (model karar vermez):** işletme / daire sınırı · kaynağın sürümü (cevap, yazıldığı andaki kayda dayanır; kayıt
değiştiyse yeniden kurulur) · açık yetki · işlem geçerliliği (rezervasyon iptal mi, konaklama bitti mi, saat penceresi) · tekrar
edilebilirlik (aynı mesaj iki kez gitmez) · sır kapısı · uzunluk tavanı · acil durum ağı.

**Kanıt sayılmayanlar:** benzerlik (embedding) puanı · kelime örtüşmesi · modelin kendi güven puanı · modelin "destekliyor" demesi
(alıntısız) · yeniden sıralayıcının sırası.

## 5. Hedef mimari

Yeni bir sistem değil: bugünkü parçaların (anlama modeli, öğe defteri, getirme, cevap parçaları kipi, okuyucu) sözleşmeleri genişler,
sözlükler çekilir.

```
misafir mesajı (+ konuşma, + açık öğeler)
   │
   ▼  U  ANLAMA (tek yapısal çağrı)             — istekler; her istek: konu, niyet, hassas mı + sebep, hangi açık öğeyle aynı,
   │                                              neyi geri çekiyor, fiziksel erişim / süren sorun / acil işaretleri, alıntı
   ▼  R  GETİRME (aday bulma)                   — bu dairenin kayıtları; kimlik + sürüm + bağlam öneki; puan yalnız sıralar
   ▼  G  DAYANAK (istek başına karar)           — cevapla / kaynak yok / ev sahibinin kararı + kaynak kimliği + birebir alıntı
   │                                              + sorulan varlık ↔ kaynaktaki varlık + koşul + cümle
   ▼  K  KOD DENETİMİ (mekanik)                 — kimlik bu turda ve bu dairede mi · sürüm aynı mı · alıntı kaynakta birebir mi
   │                                              · cümledeki sayı / saat / tutar alıntıda mı · beyan "aynı değil / kapsamıyor" mu
   ▼  V  BAĞIMSIZ DOĞRULAYICI (ikinci okuma)    — yalnız istek + alıntı + cümleyi görür; aynı alanları doldurur; ayrışma → tut
   ▼  P  POLİTİKA (kodda)                       — bu tür istek için açık yetki var mı; yoksa ev sahibinde
   ▼  C  CEVAP                                  — onaylı cümlelerden; ev sahibinin ağzından; selam + dil kodla
   ▼  S  GÜVENLİK YEDEKLERİ                     — acil, kişi tehlikesi, komut enjeksiyonu, sır, uzunluk (birleşim; yalnız sıkılaştırır)
```

**U — anlama.** Bugün var (açılışta açık). Eksik alanlar: istek başına hassaslık + sebep, "şu açık öğeyle aynı" kimliği, geri çekilen
öğeler, fiziksel erişim, süren sorun, para isteğinin türü. Bunlar gelince 1, 2, 3, 12, 13, 15 ve 17 numaralı kelime kararlarının
yerine geçer. Model koşmadığında (arıza) kelime ağı YEDEK olarak kalır ve yalnız tutar.

**R — getirme.** Kelime + anlamsal + yeniden sıralayıcı aday bulmaya devam eder (D sınıfı). Değişenler: (a) her parça, ait olduğu
kalemin başlığını ve en yakın liste / tablo başlığını önek olarak taşır (önce modelsiz, deterministik; sonra istenirse dizinleme anında
modelle yazılan kısa bağlam cümlesi — Anthropic'in "contextual retrieval" çalışmasının yöntemi); (b) modele giden her kayıt kimlik,
güncellenme tarihi ve kaynak türü taşır; (c) blok başlığı yansızlaşır ("bu dairenin kayıtları; yakın konulu kayıt cevap değildir").

**G — dayanak.** Cevap parçaları kipinin sözleşmesi dört alandan şuna genişler:

```
{ istek: "R2",
  karar: "cevapla" | "kaynak_yok" | "ev_sahibinin_kararı",
  kaynak: "kb:17",                  alıntı: "<kaynaktan birebir>",
  sorulan_varlık: "eczane",         kaynaktaki_varlık: "market",   aynı_varlık: evet | hayır,
  sorulan_özellik: "uzaklık",
  kaynaktaki_koşul: "hafta sonu",   koşul_soruyu_kapsıyor: evet | hayır | bilinmiyor,
  cümle: "<misafire gidecek cümle; ev sahibinin ağzından>" }
```

**K — kod denetimi.** Sözlük yok; yalnız şunlar: kaynak kimliği bu turda modele gösterilen ve bu daireye ait bir kayıt mı · kaydın
sürümü cevap kurulduğundan beri değişmedi mi · alıntı o kayıtta birebir geçiyor mu (boşluk / tire / tırnak biçimi dışında) · cümledeki
her sayı, saat, tutar alıntıda var mı · beyan "aynı varlık değil" ya da "koşul kapsamıyor / bilinmiyor" ise cümle gitmez · karar
"cevapla" değilse cümle gitmez. Bu denetimin ölçüm ikizi yazıldı: `tests/eval/raw-arm.ts` (§7).

**V — bağımsız doğrulayıcı.** Bugünkü okuyucu yalnız evet / hayır alanları dolduruyor. Hedef: cevabı yazan modelin gerekçesini
görmeden, yalnız istek + alıntı + cümleyle aynı yapısal alanları (aynı varlık mı, koşul kapsıyor mu, cümle alıntının söylediğinden
fazlasını söylüyor mu) yeniden doldurur. Kodun göremediği yer burasıdır: sayı taşımayan yanlış değer ("ücretsiz" ↔ "ücretli"), yazıyla
sayı, alıntının cümleyi gerçekten desteklememesi.

**P — politika.** Tasarım belgesi `TASARIM-2026-11-12-dayanak-ve-yetki-mimarisi.md` (D1–D6) aynen: karar gerektiren türler (iade, indirim,
istisna, erken giriş onayı, evcil hayvan, ödeme) için açık yetki kaydı aranır; modelin "nottan izin çıkıyor" yorumu yetki sayılmaz.

## 6. Geçiş planı

### 6.1 Her dilimin yolu

1. Model alanı **gölgede** eklenir: üretilir ve kaydedilir, karar hâlâ bugünkü kuralın.
2. Geliştirme setinde ve gerçek geçmiş taramasında (`scripts/eval-real-stats.ts`, yalnız sayı) kural ↔ alan yan yana ölçülür: kural
   tuttu / alan tutmadı ve tersi; katman atfı (§7).
3. Kör kabul seti (bir kez açılır) açılış kipinde koşulur (`EVAL_PROFILE=launch`).
4. Anahtar açılır; kelime kuralı ya **yedek** olur (model koşmadığında, yalnız tutar) ya da kalkar. Açma kararı kurucuda.

### 6.2 Dilimler (önerilen sıra: ölçülmüş misafir etkisi büyük + riski küçük olan önce)

| Dilim | Ne değişir | Bugün → sonra (örnek) | Ölçüm | Not |
|---|---|---|---|---|
| **D0** | Ölçüm: ham model kolu + katman atfı + açılış kipi tabanı | — | bu tur yazıldı (§7, §8) | ürün davranışı değişmez |
| **D1** | İstem ↔ veto çelişkisi: devir cümlesi istemden çıkar; "bu istek ev sahibinde kalıyor" yapısal alan olur | Bugün model "Mesajınız kaydedildi; …" yazıyor, veto tutuyor → cevaplanabilir kısım da gitmiyor. Sonra: model yalnız cevaplanabilen kısmı yazar, kalan istek alanla işaretlenir | geliştirme + kör; gereksiz tutma ↓ beklenir, yanlış gönderim artmamalı | Fable denetiminin bulgularıyla birlikte ele alınır |
| **D2** | Türüne bağlanamayan etiket: istek başına hassaslık modelden | "Yarın erken çıkacağız, anahtarı nereye bırakalım? Wi-Fi şifresi neydi?" — bugün ikisi de tutulur. Sonra: iki istek de cevaplanabilir (iptal TALEBİ yok; anahtar teslimi ve Wi-Fi) | gerçek geçmiş taraması + set | kelime etiketi model yokken yedek |
| **D3** | `sendDueAlerts`: "Sorunlu" kararı anlama alanlarından; kelime ağı yalnız model koşmadığında | "Klimanın kokusu güzelmiş, hangi marka?" · "Anahtarı iade edeceğimiz yer neresi?" — bugün "koku" / "iade" → Sorunlu, yapay zekâ susar. Sonra: süren sorun yok, iade talebi yok → cevaplanır | gerçek geçmiş taraması (kaç konuşma yalnız kelimeyle Sorunlu oldu) | acil + erişim kaybı ağı aynen kalır |
| **D4** | Getirme bağlamı: parça öneki (kalem + bölüm başlığı), kayıt kimliği + tarih, yansız blok başlığı | "Hafta sonu" başlığı altındaki "23:00" satırı tek başına geliyorsa model onu her gün için okuyabiliyor. Sonra: satır başlığıyla gelir | getirme ölçeri + cevap ölçeri | deterministik; model çağrısı eklemez |
| **D5** | Dayanak sözleşmesi (G) + kod denetimi (K) cevap parçaları kipinde; varlık / koşul / olumluluk sözlükleri çekilir | "très bien" → bugün "tres" = 3 sayılıp tutulur; "Sorun yok, kabul ediyoruz" olumsuz okunur. Sonra: sayı yalnız rakamsa sınanır, olumluluk modelin beyanı + doğrulayıcı | geliştirme + kör (dayanak setleri) | Spain / spa ailesi burada kapanır |
| **D6** | Bağımsız doğrulayıcı (V): okuyucu aynı yapısal alanları doldurur; iki okuma | "Otopark ücretlidir" (not: ücretsiz) — sayı yok, kod göremez; doğrulayıcı tutar | kör; yanlış gönderim hedefi 0 | maliyet: cevap başına bir çağrı daha |
| **D7** | Cevap sonrası kalıplar (bilgim yok, yönlendirme, iç kaynak, üçüncü şahıs, bekleyen cihaz, evcil hayvan kemeri) → doğrulayıcı alanları + alıntı | Evcil hayvan sorusu olan turda yanındaki "Çıkış saatimiz 11:00." bugün gitmiyor. Sonra: yalnız evcil hayvan cümlesi düşer | kör | her kalıp ayrı ölçülür; yedekler §6.3 |
| **D8** | QR sohbetine öğe kipi + anlama | QR'da "iade" sözcüğü bugün tek başına devreder | QR ölçeri | QR ayrı kapı |

### 6.2b Fable'ın önerdiği sırayla birleştirme (11-13)

Fable 5.2 denetimi kendi hedef tasarımını ve geçiş sırasını yazdı (`docs/olcum/fable-denetim-2026-11-13/hedef-tasarim.md`; istemleri
gördü, kapı kodunu görmedi). İki plan aynı yere varıyor; ayrıştıkları tek yer **cevap isteminin nasıl değişeceği**:

- Benim D1'im bugünkü istemi yamalıyordu (devir cümlesini çıkar). Fable'ın teşhisi daha kökten: taban istem zaten "üst üste yamalanmış
  bir olay günlüğü" (yaklaşık 46.000 karakter + 12 bayraklı katman + 24 örnek; aynı kural 3–5 yerde ve en az biri ötekiyle çelişiyor);
  bir yama daha eklemek aynı hastalığı büyütür. Önerisi: **yeni, kısa, tek parça bir istem + yapısal cevap şeması, önce gölgede** (eski
  hat gönderir, yeni hat yalnız kaydedilir ve ölçülür). Taslağın tam metni o belgenin §2'sinde.
- §8'deki ham kol sonucu bu yönü destekliyor: yirmi satırlık istem + yapısal beyan, bu sette 62 / 62.

Bu yüzden D1 şöyle değişir: **yama değil, gölgede yeni hat.** Birleşik sıra:

| Sıra | Dilim | Bu belgede | Fable'da | Not |
|---|---|---|---|---|
| 0 | Ölçüm zemini: ham kol, aynı cetvel, açılış kipi | D0 (yapıldı) | Dilim 0 | eksik: ham kolun gpt-5.1 koşusu (AM-5) |
| 1 | Kaynak sunumu: kimlikli, tarihli, bağlamlı kayıt; yansız blok başlığı | D4 | Dilim 1 | deterministik; model çağrısı eklemez |
| 2 | Anlama şeması: istek başına varlık / özellik / koşul / edim / hassaslık bayrakları | U alanları (D2, D3'ün ön koşulu) | Dilim 2 | modelden ÖNCE çalışan iki kelime kararı (D2, D3) bununla kalkar |
| 3 | Yeni cevap istemi + yapısal şema, GÖLGEDE | D1 (yeniden tanımlandı) + D5 | Dilim 3 | `confidence` hiçbir kararın girdisi olmaz |
| 4 | Yargıçlar: destek yargıcı (alıntılı) + tek taslak okuyucu | D6, D7 | Dilim 4 | |
| 5 | Kelime kapıları yedeğe (her biri önce "yalnız kaydet") | D7, §6.3 | Dilim 5 | bilgisizlik kuralı en son |
| 6 | QR sohbeti aynı hatta | D8 | Dilim 3 içinde | QR'da "kaynak yok" açık iş açmalı |

Fable'ın kabul ölçütü (aynen alındı): bir dilim, **kaçak artmadan gereksiz tutma azalıyorsa** kabul edilir; yalnız kaçağa bakan kabul
yetmez. Dört hücre ayrı raporlanır: kaçak · kapı kurtardı (model hatası) · gereksiz tutma — kapı · gereksiz tutma — model.

Fable'ın kendi tasarımı için yazdığı ve katıldığım riskler: yargıç ile üretici aynı model ailesinden (ölçümde okuyucu aynı yanlış
parçayı üç koşunun birinde geçirdi) · öz-beyan yine öz-beyandır (kod alıntının varlığını kanıtlar, soruyu cevapladığını değil) · birebir
alıntı Türkçede kırılgan olabilir (ek / çeviri farkı doğru cevabı tutar) · kodun birleştirdiği cümleler doğal akmayabilir.

### 6.3 Güvenlik yedekleri — tek tek

| Yedek | Görevi | Öneri | Neden |
|---|---|---|---|
| Acil durum ağı (yangın, gaz, su baskını, kilitli kalma) | model koşmasa da ev sahibine haber | **kalır**; modelle birleşim (biri "acil" derse acil) | yanlış alarmın bedeli küçük, kaçırmanın bedeli büyük |
| Kişi tehlikesi öbekleri | aynı | kalır | aynı |
| Komut enjeksiyonu / bilgi tabanı talimat süzgeci | veri → talimat sızmasını kesmek | kalır; kalem yerine CÜMLE düşürme ölçülür | bugün bütün kalemi düşürüyor (bilgi kaybı) |
| Sır kapısı (kapı kodu, şifre) | sızıntı | kalır (kesin kural) | anlam değil veri sınıfı |
| Uzunluk tavanı, dil kodu, yer tutucu | biçim | kalır | kesin kural |
| Söz / eylem vetosu | yapılmamış işi "yaptım" dememek | modelin eylem beyanı + kalıp birleşimi; ölçülünce kalıp daraltılır | edilgen çatıda kalıp zaten kör |
| "Bilgim yok" kalıbı | kurucu kuralı: misafire gitmez | doğrulayıcı alanı esas, kalıp yedek | kalıp dürüst çok soruluk cevabı toptan tutuyor |
| Evcil hayvan kemeri, bekleyen cihaz kesişimi | ev sahibindeki kararı sızdırmamak | D5–D7 ölçüldükten sonra cümle düzeyine iner | bugün yanındaki doğru cevabı da tutuyor |
| QR kelime vetosu | QR'da öğe kipi yokken tek koruma | D8'e kadar kalır | yerine geçecek katman henüz yok |

## 7. Ölçüm — katman atfı

**Soru (Codex):** aynı girdide ham model kararı ↔ ürünün son kararı; hata hangi katmanda? Doğru cevabın tutulması da hata.

**Kollar (aynı senaryo, aynı notlar, aynı insan yazımı ihtiyaç listesi, aynı cetvel `tests/eval/need-scoring.ts`):**

| Kol | Ne | Nerede |
|---|---|---|
| Ürün | bugünkü hat, açılış kipinde (`EVAL_PROFILE=launch`) | `tests/eval/live-pipeline.eval.test.ts` |
| Ham | kapısız, kısa yansız istem; modelin kendi cevabı | `raw_baseline` (`scripts/claude-work/run.ts`) → `npx tsx tests/eval/raw-arm-report.ts <dizin> [etiket]` (çekirdek `raw-arm-score.ts`, pinler `raw-arm.eval.test.ts`) |
| Ham + mekanik | yalnız kodun sınayabildiği denetim (alıntı notta · sayı alıntıda) | aynı |
| Ham + mekanik + beyan | ek olarak modelin "aynı varlık / koşul kapsıyor" beyanı | aynı |

**Atıf kuralı (ihtiyaç başına):**

- Ham kol doğru, ürün tuttu → **kod gereksiz tuttu** (kapı / kemer / kalıp) — hangi kapı olduğu ürün ölçerinin izinde yazılı.
- Ham kol doğru, ürün yanlış gönderdi → **ürün istemi / hattı bozdu** (istem çelişkisi, bağlam kaybı).
- Ham kol yanlış, mekanik denetim düşürdü → **dayanak hatası, kod yakalıyor** (alıntı uydurma / sayı taşıma).
- Ham kol yanlış, yalnız beyan düşürdü → **dayanak hatası, model kendi beyanında yakalıyor** (varlık / koşul).
- Ham kol yanlış, hiçbiri düşürmedi → **doğrulayıcının işi** (D6) ya da model sınırı.
- Kayıt modele hiç gösterilmediyse → **getirme** (ürün ölçerinin "seçilen kayıtlar" izi).

**Dürüst sınır (bu tur):** ham kol Fable 5.2 ile koştu (OpenAI kredisi bitti). Bu, "güçlü bir model aynı notlarla ne yapar" tavanını
gösterir; **ürünün kendi modeliyle (gpt-5.1) aynı ham kol koşulmadan katman atfı tamamlanmış sayılmaz** — fark model farkı da olabilir.
Kredi gelince aynı istem ürün modeliyle koşulur (§10 AM-5). Ham kol notların tamamını görür; geliştirme setlerinde bilgi tabanı küçük
(9–10 kalem) ve ürün de küçük tabanı bütün verir, yani getirme katmanı bu ölçümde iki kolda da devre dışıdır.

## 8. Örnek dilim — "kaynak desteği kararı": önce / sonra

Set: `evals/grounding-dev.json` (43 senaryo, 62 ihtiyaç: 34 cevaplanmalı, 28 açık kalmalı; sınıflar Codex'in listesinden — konu yakın ama
cevap yok, yakın ama farklı varlık, ücret / mesafe / saat taşıma, çelişkili kayıt, çok soruluk mesaj, dört dil). Geliştirme setidir
(kör değil): yön gösterir, açma kararı vermez.

**Önce (ürün, gpt-5.1; `docs/INCELEME-2026-11-12-istem-denetimi.md` §6.1):**

| Kol | Doğru cevap (34) | Gereksiz tutma | Açık kaldı (28) | 🚨 Yanlış gönderim |
|---|---|---|---|---|
| bugünkü hat | 24 | 10 | 19 | **9** |
| bugünkü hat + istem katmanı | 26 | 8 | 23 | **5** |
| cevap parçaları kipi + okuyucu | 30 | 4 | 28 | **0** |

**Sonra (ham model kolu, sözlüksüz):**

Fable 5.2, yaklaşık yirmi satırlık yansız istem, kapı yok (`docs/olcum/raw-arm-2026-11-13-fable-5.2.md`; ölçer `tests/eval/raw-arm-report.ts`):

| Kol | Doğru cevap (34) | Gereksiz tutma | Açık kaldı (28) | 🚨 Yanlış gönderim |
|---|---|---|---|---|
| ham model (kapısız) | 34 | 0 | 28 | **0** |
| ham + yalnız mekanik denetim (alıntı notta · sayı alıntıda) | 34 | 0 | 28 | **0** |
| ham + mekanik + modelin varlık / koşul beyanı | 34 | 0 | 28 | **0** |

İkinci set — çok mesajlı tur (`evals/turn-messages-dev.json`, 16 senaryo, 24 cevaplanmalı + 4 açık kalmalı): ham 24 / 24 doğru, 0 yanlış;
mekanik denetimle 23 / 24 (tek tutma: model çıkış saatini mülk alanından çıplak "11:00" diye alıntıladı; denetim bağlamsız alıntıyı
kaynak saymıyor). Ürün aynı sette: bugünkü hat 16 / 24, cevap parçaları + çok mesajlı tur anahtarıyla 22 / 24.

Örnekler (ham kolun gönderdiği metin; hepsi ev sahibinin ağzından):

| Misafir | Notlarda | Ham kol |
|---|---|---|
| "Wi-Fi şifresi ne? Kahvaltı dahil mi?" | Wi-Fi yazılı; kahvaltı yok | "Merhaba! Wi-Fi ağ adımız Lale_Home, şifre Lale2024." — kahvaltı: kaynak yok, ev sahibinde |
| "Is there an ATM nearby? Also, where is the nearest shop?" | market 150 m; ATM yok | "Hi! The nearest shop is a market about 150 metres up the street from the building." — ATM: kaynak yok |
| "Wi-Fi şifresi ne? Otopark ücretli mi?" | otopark için çelişen iki kayıt | Wi-Fi cevabı gider; otopark: ev sahibinin kararı |
| "Kahvaltı veriyor musunuz?" | yalnız restoran önerileri | hiçbir şey gitmez (kaynak yok) — bugünkü hat "Kahvaltı hizmeti sunmuyorum." gönderiyordu |

**Ne gösteriyor:**

1. Bu sette güçlü bir model, hiçbir kelime kapısı olmadan ve kısa bir istemle 62 ihtiyacın 62'sini doğru karara bağlıyor: cevabı olanı
   cevaplıyor, olmayanı uydurmuyor, yanındaki cevabı da tutmuyor. Aynı sette ürün 9 yanlış gönderiyor ve 10 doğru cevabı tutuyor.
2. Yani bu setteki hataların hiçbiri "çözülemez" değil; kaynağı ya ürünün kullandığı model ya da ürünün hattı (yaklaşık 60.000 karakterlik
   istem + kelime kapıları). Fable'ın istem denetimi (`docs/INCELEME-2026-11-13-fable-istem-denetimi.md`) ikincisi için güçlü kanıt
   sunuyor: taban istem dürüst çıkışların hepsini yasaklıyor, kapılar da istemin öğrettiği cümleyi tutuyor.

**Ne göstermiyor (dürüst sınır):**

- **Model farkı ayrılmadı.** Ham kol Fable 5.2, ürün gpt-5.1. Aynı ham istem gpt-5.1 ile koşulmadan "model mi, hat mı" sorusu cevaplanmış
  sayılmaz (§10 AM-5). gpt-5.1 ham kolda da temiz çıkarsa sorun hattadır ve D1–D3 doğrudan düzeltir; ham kolda da uyduruyorsa dayanak
  sözleşmesi + doğrulayıcı (D5–D6) asıl iştir.
- **Mekanik denetimin koruması bu ölçümde görünmedi**: ham kol hiç yanlış cümle yazmadığı için denetimin düşürecek bir şeyi olmadı; bedeli
  ise göründü (58 cevapta 1 gereksiz tutma). Koruma değeri, yanlış yazan bir modelle ölçülür — yine AM-5.
- **Yapısal alanlar için kimlik gerek**: tek gereksiz tutma, mülk alanındaki değerin ("11:00") bağlamsız alıntılanmasıydı. Yapısal
  bilgilerde (giriş / çıkış saati, adres) kaynak kimliği alan düzeyinde olmalı ("mülk.çıkışSaati"); alıntı uzunluğu orada aranmaz (D5).
- Geliştirme setidir (sınıfları bilerek yazıldı, kör değil), 59 senaryo; getirme katmanı bu ölçümde devre dışı (küçük bilgi tabanı bütün
  veriliyor); ham kolda öğe defteri olmadığı için yalnız giden metin puanlandı.

## 9. Codex önerisi ↔ bu plan

**Aynen alınanlar:** kelime / kök kararlarının envanteri (§2) · anlam modele, kesin kural koda (§4) · benzerlik puanı, kelime örtüşmesi,
model güveni kanıt değil · ham model ↔ ürün karşılaştırması, gereksiz tutma da hata (§7) · kaynak ↔ soru ilişkisi: varlık, özellik,
değer, koşul (§5 G) · parçanın bağlamdan kopması (§5 R, D4) · güvenlik yedekleri tek tek (§6.3) · Spain / spa'yı yeni istisnayla
kapatmamak (D5).

**Üstüne konanlar:**

1. **Modelin "destekliyor" demesi de kanıt değildir.** Codex "kaynak desteği modele dayansın" diyor; bu tek başına bugünkü okuyucunun
   evet / hayır'ına döner. Plan, beyanı sınanabilir parçalara böler (kimlik, birebir alıntı, sayılar, varlık, koşul), kodun
   sınayabildiğini koda (§5 K), kalanını yazan modelden bağımsız ikinci okumaya (§5 V) verir.
2. **Ham kol iki modelle.** Yalnız güçlü modelle ölçmek "model mi, katman mı" sorusunu cevaplamaz; aynı ham istem ürünün kendi
   modeliyle de koşulmalı (§7).
3. **Ölçüm tabanı açılış kipi.** Ölçümler açılışta açılacak dört anahtar olmadan koşuyordu (kurucunun sorusu); artık mühürlü koşu
   açılış kipinde değilse başlamıyor (`tests/eval/launch-profile.ts`).
4. **Sıra ölçülmüş etkiye göre.** İlk dilim Spain / spa sözlüğü değil, istem ↔ veto çelişkisi ve modelden ÖNCE çalışan iki kelime
   kararı (D1–D3): açılışta etkinler ve doğru cevabı tutuyorlar. Sözlük ailesi (D5) cevap parçaları kipi açılana kadar zaten kapalı.
5. **Aynı cetvel.** İki kol tek puanlayıcıyla ölçülüyor (`need-scoring.ts`); cetvelin kopyası yok.

**Ayrıştığım yer:** "dolaylı izin değerlendirmesi modele dayansın" — model iznin *gerekip gerekmediğini* ve kaydın bunu *açıkça söyleyip
söylemediğini* (alıntıyla) değerlendirir; iznin *var sayılması* kodda kalır (P5). Dolaylı izinden cevap üretmek kurucunun 10-01 /
10-02 kararlarıyla ("ev sahibinizin kararıdır" misafire gitmez; karar motoru) çelişir.

## 10. Kurucudan beklenen kararlar

- **AM-1 — Sıra.** §6.2b'deki birleşik sıra (ölçüm → kaynak sunumu → anlama şeması → gölgede yeni cevap hattı → yargıçlar → kelime
  kapıları yedeğe → QR) önerim. Onay ya da başka sıra?
- **AM-2 — Koşullu bilgi.** Not "Havuz hafta sonu 23:00'e kadar açık", misafir hafta içini soruyor. (a) Hiçbir şey gitmez, soru ev
  sahibinde kalır. (b) Bilinen kısım koşuluyla gider: "Havuzumuz hafta sonları 23:00'e kadar açık." — hafta içi sorusu ev sahibinde
  kalır. Önerim (b): güçlü bir modelin vereceği cevaba en yakın olanı; yanlış bilgi içermez. Karar sizin.
- **AM-3 — "Ev sahibimiz".** Üçüncü şahıs kapısı bunu da tutuyor (11-06'dan beri açık soru). Tutulsun mu, yalnız "ev sahibiniz" mi?
- **AM-4 — Getirme bağlamı (D4).** Modelin gördüğü bilgi satırı değişir (kimlik, tarih, başlık öneki; blok başlığı yansızlaşır).
  Misafire gideni dolaylı etkiler → ölçümle birlikte gelir; ölçüm için OpenAI kredisi gerekir.
- **AM-5 — Ham kolun ürün modeliyle koşusu.** Geliştirme setlerinde ~0,5 ABD doları; kör kabul koşularıyla aynı kredi isteğinin parçası.
- **AM-6 — Doğrulayıcının maliyeti (D6).** Otomatik giden her cevapta bir model çağrısı daha. Önerim: önce yalnız "cevapla" kararı olan
  ve sayı taşımayan cümlelerde (kodun göremediği yer); ölçümden sonra genişletilir.
- **AM-7 — Üç kurucu kararının bedeli (Fable denetimi; karar DEĞİL, ölçüm önerisi).** Yeni tasarım üç kararınızı aynen koruyor ama
  bedellerini adıyla yazıyor: (a) cevaplanmayan soru hakkında misafire hiçbir şey gitmiyor (iki soru sorup birine cevap alan misafir
  ötekini yeniden soruyor mu?) · (b) canlı tehlikede misafire hiçbir metin gitmiyor (ev sahibi e-postayı görene kadar) · (c) "olmazsa
  buradan yazın" kapanışı yasak (yarım kalan arıza tarifinde misafir ne yapacağını bilmiyor). Önerim: kararlar değişmeden önce
  "yeniden sorma oranı" ve "arıza cevabından sonra ikinci mesaj oranı" ölçülsün; (b) için ara yol sizin yazıp "acil durumda gönder" diye
  işaretlediğiniz güvenlik notunun kodla gitmesi. Ayrıntı: `docs/INCELEME-2026-11-13-fable-istem-denetimi.md`.
