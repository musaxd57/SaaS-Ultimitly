# Tasarım 10-23 sabah — Soru 9 (genel kural + istisna) · Soru 10 (sessiz kalan açık ihtiyaç) · Soru 11 (parça okuyucusu)

> Kurucu cevapları (10-23 sabah, aynen özet): migration 85 onaylandı · 9 → kurucunun şartlarıyla evet · 10 → evet, şartlarla ·
> 11 → evet, "kelime kelime kodu sınırlamak yerine modelleri geliştirelim"; parça kipi son kodla uçtan uca kör ölçüm geçene kadar KAPALI.
> Hepsi parça kipinin (`AI_ANSWER_PARTS_ENABLED`, KAPALI) içinde; kip kapalıyken misafire giden ve ev sahibine giden hiçbir şey değişmez.

## 0. Bugün ne var / ne eksik (envanter)

| Konu | Bugün | Eksik |
|---|---|---|
| Genel değer, istisnayı anmadan | `variant_omitted` TUTAR ("Havuz 20:00'de kapanır" ← kalemde "hafta sonu 23:00") | — |
| İstisna, genel değeri anmadan | GİDER ("Havuz hafta sonu 23:00'e kadar açık" — soru gün sormadı) — eski pin bilinçli | Soru 9 |
| Bayat açık satır, sessiz tur | panelde açık, e-posta YOK (`producedKeys` dışı satır cevaplanamaz, tur tutulur, üç bildirim yolu da susar) | Soru 10 |
| "Sorulanı gerçekten cevapladı mı" | yalnız kod: değer ↔ kaynak bağı + sözcük tabanlı yön / tesis kapsamı (`missingAspects`, `missesAskedFacility`) | Soru 11 |
| Kıdemli okuyucu | SON METNİ okur (bilgim-yok · ev sahibine ödeme · iletişim · özür · iç kaynak); parçaları, ihtiyaçları, kaynakları GÖRMEZ | Soru 11 |

## 1. Soru 9 — genel kural + istisna (kod; mevcut koşul sınıfları, YENİ SÖZCÜK LİSTESİ YOK)

Kural (kurucunun şartları birebir):
1. Parçanın değerleri YALNIZ bir değişkeye bağlıysa (gün: hafta sonu / hafta içi / gün adı; mevsim) ve kaynak (alıntının kalemi + istemdeki
   öteki kalemler — O6) AYNI konuya aynı türden BAŞKA bir değer veriyorsa (genel kural ya da öteki değişke) ve parça o değeri anmıyorsa →
   `general_omitted`, parça tutulur, istek açık kalır.
2. İstisna: misafir o değişkeyi sorduysa (isteğin sorguları · bu turun misafir mesajları · konuşmadaki önceki misafir mesajları) gider
   ("Hafta sonu havuz kaçta kapanıyor?" · önceki mesajda "Cumartesi geliyoruz" → cumartesi hafta sonunun özelidir, kapsar).
3. Kaynakta genel kural YOKSA (yalnız "Hafta sonu havuz 23:00'e kadar açıktır.") kural koşmaz — yalnız istisnayı söylemek doğru ve tek bilgi;
   genel değer uydurulamaz (bağ denetimi zaten tutar).
4. Tutulan parça yalnız KENDİ isteğini tutar; aynı mesajdaki bağımsız doğrulanmış parçalar gider (parça kipinin zaten yaptığı).

Örnekler (önce → sonra):
- Kalem "Havuz hafta içi 22:00'ye, hafta sonu 23:00'e kadar açık." · soru "Havuz 22:00'ye kadar açık mı?" · parça "Hafta sonu 23:00'e kadar
  açık." → bugün GİDER → artık TUTULUR (istek açık). Parça "Hafta içi 22:00'ye, hafta sonu 23:00'e kadar açık." → gider (değişmedi).
- Aynı kalem · soru "Hafta sonu havuz kaçta kapanıyor?" · parça "Hafta sonu 23:00'e kadar açık." → gider (değişmedi).
- Kalem yalnız "Hafta sonu havuz 23:00'e kadar açıktır." · soru "Havuz kaçta kapanıyor?" · parça "Hafta sonu 23:00'e kadar açık." → gider.

Bilinen sınır (tutma yönünde): "Havuz bu akşam kaçta kapanıyor?" cumartesi sorulursa "bu akşam"ın hafta sonu olduğu kodla okunmaz → tutulur
(okuyucu bunu bağlamla bilir ama kodun tuttuğunu serbest bırakamaz — §3 kural 2).

## 2. Soru 10 — sessiz kalan gerçek açık ihtiyaç (kalıcı kayıt + mevcut e-posta yolu)

Durum: parça kipinde bu turun mesajlarında önceki okumadan kalmış açık satır (bu okuma üretmedi → cevaplanamaz, Opus e2e F5) var; tur
tutuldu, misafire hiçbir şey gitmedi ve hiçbir bildirim yolu (hassas öğe acil e-postası · karar kartı · devir / cevapsız parça e-postası) çalışmadı.

Kural (kurucunun şartları):
- Yalnız GERÇEK açık ihtiyaç: satır `open` / `pending_host` (cevaplandı · vazgeçildi · yerine geçildi · bitti DEĞİL), kaynak / asistan
  sorusu değil (`NO_NOTIFY_KINDS`), turun mesajlarından (ev sahibi bu mesajlardan sonra yazmadı — tur tanımı). Misafirin vazgeçmesi anlama
  katmanının `withdrawn` okumasıyla satırı kapatır (`applyWithdrawals`) → bildirim yok. Ev sahibi yazdıysa mesaj tura girmez → bildirim yok.
- ÖNCE kalıcı kayıt: satır başına benzersiz talep satırı (`SystemLock` `open-need-mail:<satır>`, bir yıl; `create` yarışını tek kazanan —
  eşzamanlı ya da yeniden işlenen geçişte ikinci e-posta yok). Kaydı zaten olan satır e-posta tetiklemez → yeniden işleme / her tarama yeni
  e-posta üretmez. (`ConversationItem.notifiedAt` BİLEREK kullanılmadı: bugün yalnız hassas satırlarda dolu ve "mesaj zaten bildirildi"
  okumaları — acil e-posta tekilleştirmesi — onu mesaj düzeyinde okur; güvenli satıra yazılırsa aynı mesajın sonraki hassas öğesinin acil
  e-postası susardı.) Gönderimden hemen önce satırın GÜNCEL durumu yeniden okunur (arada cevaplanan / vazgeçilen satır bildirilmez).
- SONRA mevcut yol: `notifyHostReplyWaiting` (mesaj başına tek e-posta, `SystemLock` talebi, alıcı = uyarı adresi ya da sahip). E-posta
  gitmezse (gönderim hatası · talep deposu okunamadı · alıcı yok) satır kayıtları geri alınır (sonraki geçiş yeniden dener — e-posta
  gitmemişti); "zaten gitti" (mesaj talebi var) kayıtları TUTAR.
- Yeni e-posta metni YOK (bugünkü "Misafir cevabınızı bekliyor" e-postası, satırın mesajını alıntılar). Yeni anahtar YOK (parça kipinin içinde).

Örnek: misafir "Havuz kaçta?" (satır açıldı, tur tutuldu, e-posta gitti) → misafir ikinci mesaj "Teşekkürler" yazdı → yeniden okuma havuz
isteğini üretmedi, tur sessiz → havuz satırının mesajına e-posta zaten gitmişti → İKİNCİ E-POSTA YOK (kayıt tutulur). İlk turda e-posta
hiç gitmemişse (ör. o tur başka sebeple sessizdi) → tek e-posta. Misafir "Havuzu boşverin" yazdıysa → satır vazgeçildi → e-posta yok.

## 3. Soru 11 — parça okuyucusu (kıdemli okuyucunun parça kipindeki soruları)

Ne: parça kipinde, kodun doğruladığı parçalar birleştirilmeden ÖNCE kıdemli okuyucu (aynı anahtar `AI_SENIOR_READER_ENABLED`, aynı model
ayarı `guard`) gönderilecek PARÇALARI, her parçanın İSTEĞİNİ ve dayandığı KAYNAK kalemi görür. İstek başına dört soru (kurucunun listesi):
1. Bu parça misafirin hangi ihtiyacına cevap veriyor — gösterilen isteğe mi?
2. O ihtiyacı GERÇEKTEN karşılıyor mu, yoksa yalnız aynı konudan mı bahsediyor? (`yes` / `partly` / `no`)
3. Saat, koşul ve istisna kaynaktaki AYNI şeye ve AYNI koşula mı bağlanmış? + Soru 9'un anlam karşılığı: kaynakta genel kural varken
   misafirin sormadığı bir istisnayı tek başına mı veriyor (önceki misafir mesajları da gösterilir)?
4. Cevaplanmayan ihtiyaç ev sahibinde açık kalır → KODDA: okuyucunun tuttuğu parçanın isteği "cevaplandı" sayılmaz (beyandan düşer,
   panelde açık; bütün parçalar düştüyse tur bugünkü cevapsız-parça yolundan ev sahibine bildirilir).

Kurallar (kurucunun şartları):
1. Okuyucu ilk taslağı DEĞİL, kodun ayıklamasından SONRA kalan parçaları + kaynaklarını okur.
2. Okuyucunun "evet"i gönderim izni DEĞİL: yalnız kodun doğruladığı parçayı TUTABİLİR, kodun tuttuğunu serbest bırakamaz. Yetki, sır,
   işlem onayı, güncellik (bağ denetimi, sır kapısı, eylem beyanı, bayat kaynak, son metnin beş okuyucu hükmü, bütün kapı) kodda kalır.
3. Belirsizlikte parça tutulur: `partly` / `no` / bağ yanlış / istisna tek başına / parça okuyucunun cevabında YOK / okuyucu düştü ya da
   bozuk cevap verdi → o parça (okuyucu bütünüyle düştüyse BÜTÜN parçalar) tutulur.
4. Tek okuma (misafir mesajıyla). ⚠️ **10-23 öğle DÜZELTME (Codex):** buradaki eski cümle ("okuyucu susturulursa kodun doğruladığı parça
   gider") Opus G1'den beri YANLIŞTIR. Güncel davranış (testle pinli, `tests/unit/answer-parts.test.ts`): okuyucu kapalıysa, HTTP hatası
   verirse, bozuk cevap dönerse ya da bir parçayı hiç anmazsa o parça (düştüyse BÜTÜN parçalar) TUTULUR (`reader_unread`). Susturmak hiçbir
   şeyi göndertmez. **S3 sonrası açık risk (dürüst kayıt):** anlam denetimi artık okuyucuda olduğundan misafir metnine yazılmış "kontrolcüye
   not" okuyucuyu "evet"e yöneltirse, kodun eskiden tutacağı bir ANLAM hatası (ör. saunanın saati havuza) gidebilir — ama yalnız misafirin
   kendi sorusuna, yalnız bilgi tabanındaki bir değerle: uydurma değer, kaynakta olmayan alıntı, sır, yetki, işlem onayı ve bütün kapı kodda
   kaldığından okuyucunun "evet"i bunları açamaz. Okuyucu misafir metnini çitli + "güvenilmeyen veri" olarak görür.
5. Maliyet: parça kipinde doğrulanmış en az bir parça varsa tur başına bir küçük çağrı (`guard` modeli). Kip kapalıyken çağrı yok, istem
   ve şema değişmez (son metin okuyucusu bayt bayt aynı).

Örnek: soru "Havuz kaçta açılıyor?" · kalem "Havuz kapısı gece kilitli kalır; havuz 09:00'da açılır." · parça "Havuz kapısı gece kilitli
kalır." → kod: yön sözcüğü yok, belirsiz (bugün tutuluyor) · okuyucu: `no` → tutulur. Parça "Havuz 09:00'da açılır." → kod + okuyucu evet → gider.

## 4. Ölçüm (Soru 11 son şartı)

Uçtan uca gerçek model (E koşucusu, onaylı Luna yapılandırması) parça kipi AÇIK + okuyucu AÇIK, son kodla: misafire giden YANLIŞ parça
sayısı (hedef 0) ve GEREKSİZ tutma (doğru cevabı olan isteğin tutulması) AYRI sayılır; her hata için neden analizi (`failure-analysis`).
Kör set mühürlü kalır (yazarı ayrı; dosyaları ajan dahil kimse açmaz) — kör koşu yalnız sayı döker. Parça kipi kurucu kararına kadar KAPALI.

## 5. Güncelleme (10-23 öğlen) — Opus incelemesi + Codex önerisi sonrası

**Soru 9 koda değil okuyucuya taşındı.** Sözcük tabanlı ilk sürüm (`omitsGeneralRule`) Opus derin incelemesinde 7 bulgu verdi, hepsi denenerek
doğrulandı: "diğer günlerde 22:00", "normalde 22:00", parantezli istisna, iki sözcüklü tesis adı, aynı mesajın BAŞKA sorusundaki gün sözcüğü
("hafta sonu kahvaltı var mı?"), "yazın" (yaz mevsimi ↔ "WhatsApp'tan yazın") yanlış gönderim; "havuz temizliği 14:00" gibi ilgisiz saatin "genel
kural" sanılması gereksiz tutma. Kurucu ve Codex: "kelime listelerini büyütmek değil, anlam ilişkisini değerlendirmek". Kod artık yalnız YAPIYI
sınar; parantez yan cümle sınırı olarak eklendi (Opus F2: "Havuz 22:00'ye kadar açık (hafta sonu 23:00'e kadar)" → "Hafta sonu 22:00" gidiyordu).

**Codex'in altı maddesi — koddaki karşılığı:** (1) istek başına kimlik + okuyucu asıl mesajı / önceki mesajları görür — VAR. (2) "kaynak
destekliyor mu" ile "ihtiyacı karşılıyor mu" ayrı karar — okuyucuya `supported_by_notes` EKLENDİ (ayrıca `binding_ok`, `answers_request`). (3)
içeride "cevaplayamıyorum" — VAR (`no_info`, okuyucu `partly` / `no`) + `unsure` EKLENDİ. (4) okuyucu SON metni görsün — onaylanan parça son metinde
aynen durmuyorsa tur tutulur (EKLENDİ); son metnin beş kuralı zaten kıdemli okuyucuda. (5) yetki / sır / güncellik kodda — VAR. (6) "cevap hazır /
gönderildi / çözüldü" — VAR (doğrudan gönderimde teslimden SONRA "cevaplandı"; hassas öğe cevapla kapanmaz). ✅ 10-23 öğle (Codex): kalıcı
kuyrukta öğe kuyruğa girişte "cevaplandı" olur ama cevabı taşıyan mesaj öğeye yazılır; teslim kalıcı olarak gitmezse (kesin hata · kanal engeli ·
gönderim anı vetosuyla iptal) işçi YALNIZ o mesajın kapattığı öğeleri ev sahibinde yeniden açar (`reopenItemsAnsweredBy`; belirsiz teslimde
açmaz; testi `tests/integration/outbox-items-reopen.test.ts`).

**Model gücü — A / B / C:** A = okuyucu kapalı (yalnız kod) · B = aynı model + açık anlam görevi (Luna, düşük çaba) · C = B + YALNIZ okuyucuda
daha güçlü ayar (`AI_PART_READER_MODEL` / `AI_PART_READER_REASONING_EFFORT`). Önce `evals/part-reader-dev.json` (32 soru–kaynak–parça, etiketli;
Codex'in havuz / havuz barı üç satırı dahil) ile okuyucu tek başına, sonra bütün akış (geliştirme seti), en sonda mühürlü kör set. İnce ayar YOK;
üretim izleri eğitim verisine çevrilmez.

## 6. Ölçüm sonuçları (10-23 öğleden sonra; geliştirme seti — kör set ayrı)

**Okuyucu tek başına** (`evals/part-reader-dev.json`, vaka × 2 tekrar):

| kol | yanlış geçiş | gereksiz tutma | düşen | kararsız | ort. süre |
|---|---|---|---|---|---|
| B (Luna, düşük çaba) — ilk istem, 32 vaka | 0 | 2 | 0 | 0 | 1920 ms |
| C (Luna, yüksek çaba yalnız okuyucuda) — ilk istem | 0 | 2 | 3 | 1 | 2968 ms |
| B — son istem, 33 vaka | 0 | 0 | 0 | 0 | 1835 ms |

C daha iyi değil (aynı tutma + düşen çağrı + kararsızlık + %50 yavaş) → C kolu bırakıldı. Son istem iki kural ekledi: "kaynak tek durumu
anlatıyorsa o durumu veren parça tam cevaptır" ve "isteğin sormadığını bırakmak yarım cevap değildir" ("kaça kadar" sorusunda açılış saati).
Bu set istemi ayarlamak için kullanıldı — gerçek sınav mühürlü kör settir.

**Bütün akış** (`evals/needs-2026-10-23.json`, 32 senaryo / 38 cevaplanacak + 8 açık kalacak ihtiyaç, e31eb346):

| kol | doğru değerle giden | açık kalan | yanlış gönderim | gereksiz tutma |
|---|---|---|---|---|
| A — okuyucu kapalı | 31/38 | 8/8 | 0 | 7 |
| B — okuyucu açık | 28/38 | 8/8 | 0 | 10 |

Okuyucunun eklediği tutmalar: "Kahvaltı kaça kadar?" (açılış saati yok diye "yarım" — istem düzeltildi, okuyucu setine eklendi) ve "Bisiklet
ücretsiz mi?" (anlama katmanı isteği otopark sandı; okuyucu bisiklet cevabını o isteğe uymadığı için tuttu — kök neden anlama katmanı). Öteki
farklar iki koşu arasındaki taslak farkı: kodun yön / koşul denetimi ("aspect_missing", "condition_dropped") aynı soruya farklı yazılmış taslakları
farklı tuttu. Ölçer artık anlama katmanının okuduğu istekleri de yazar (hangi sorguyla tutulduğu görülsün; mühürlü rapor yazmaz).

**Kod denetimlerinin gereksiz tuttuğu sınıflar (karar kurucuda — müşteriye gideni değiştirir):** (a) "Kahvaltı fiyata dahil değil" cevabı
kaynaktaki "kişi başı 250 TL" düştüğü için tutuluyor (kurucu A: "koşul düşerse gitmez" — tutar burada koşul değil ek bilgi); (b) "Bisiklet ücreti"
gibi anlama katmanının yanlış türe koyduğu istek; (c) yön denetimi ("open until 23:00" ↔ "close") — sorgu kaydı olmadan yeniden üretilemedi.

**İnceleme bulguları (Haiku, e31eb346):** son metin denetiminde boş / selamdan ibaret parça her metinde "duruyor" sayılıyordu → düzeltildi
(73da88c2, adla selam dahil); harf / boşluk farkı artık değişiklik sayılmaz. ✅ 10-23 öğle (Codex) kapandı — eski "bilinen dar yarış"
(aynı mesaja başka bir geçişin e-posta talebi uçuştayken bu geçiş "zaten gönderildi" sayıyordu; öteki e-posta düşerse ihtiyaç bildirimsiz
kalıyordu): talep satırına e-posta gidince "gönderildi" onayı yazılır (`confirmReplyWaitingSent`, "Karar bekliyor" da yazar); onaysız ve 10
dakikadan yeni talep "uçuşta" sayılır — açık ihtiyaç kaydı yazılmaz / geri verilir, sonraki geçiş yeniden bakar (testler
`host-reply-waiting-confirm.test.ts`, `conversation-items-ordinal.test.ts`). Bir turda iki mesajda iki açık ihtiyaç → TEK e-posta (konuşmaya), ikisi de bildirilmiş sayılır (tasarım).
