# Tasarım — QR'da birden çok misafir mesajına tek cevap (F4-b)

> Kurucu (11-20 öğlen, AYNEN): "kanal gibi olsun bu soru bile değil taksit taksit cevap vermesine gerek yok 5 tane soru sormuşsa bile tek cevapta
> verebilir ortalama uzunluk dağılımını iyi yap mesela 10 soru mesaj çok uzar o zaman 2'ye bölebilsin. İlk taslağı iptal etmek, ilk soruyu silmek
> demek olmasın. Wi‑Fi cevabı zaten misafire gittiyse ikinci cevap yalnız otoparkı kapsasın. Her mesaja sabit üç saniye eklemeyelim. İkinci soru
> güvenle cevaplanamıyorsa onu açık tutalım; QR'da kısmi gönderimi bu değişiklikle gizlice açmayalım"
>
> Anahtar: `GUEST_CHAT_TURN_MERGE_ENABLED` (yalnız "1"; VARSAYILAN KAPALI — misafire gideni değiştirir). Migration YOK.
> Kod: `src/lib/guest-chat-turn-core.ts` (saf) · `src/lib/guest-chat-turn.ts` (veritabanı) · `src/app/api/chat/[token]/route.ts` ·
> `src/components/guest-chat/guest-chat.tsx`. Testler: `tests/unit/guest-chat-turn-core.test.ts` · `tests/integration/qr-turn-merge.test.ts` ·
> `tests/ui/guest-chat-turn-merge.test.tsx`.

## 1. Bugün ne oluyor (envanter, kodda okundu)

- QR rotası misafirin mesajını **yalnız cevabıyla birlikte** yazar (`record` işlemi, model bittikten sonra). Model düşünürken mesaj hiçbir yerde
  kayıtlı değildir.
- Ekran (`guest-chat.tsx`) gönderim sürerken ikinci mesajı **göndermez** (`if (!text || sending) return`). Yani "taksit taksit cevap" bir yarış
  değil, sıralı tasarımın sonucu: misafir ilk cevabı bekler, sonra ikinci soruyu yazar, onun cevabını bekler…
- Kanal yolu (`automation.ts`): mesaj senkronla ÖNCE kaydedilir; cevap, son cevabımızdan sonraki BÜTÜN misafir mesajlarına birlikte yazılır
  (`pendingGuestMessages`); model düşünürken yeni mesaj geldiyse talep alınmaz (`unseenInbound` → `SUPERSEDED_BY_NEWER_MESSAGE`), sonraki geçiş
  bütün mesajlarla yeniden yazar. Sabit bekleme yoktur.

## 2. Karar — "kanal gibi", dört parça

1. **Misafir satırı modelden önce yazılır.** Satır "açık" işaret taşır (`Message.externalId = "qr-open:<istek kimliği>"`); kararı verilince
   (`cevaplandı / ev sahibine bırakıldı / cevap gerekmedi`) işaret `"qr:<kimlik>"` olur. QR satırlarında bu alan boştu; `(conversationId,
   externalId)` tekilliği aynı istek kimliğinin ikinci satırını da engeller. İşaret satırın kendisindedir, saat kıyası yoktur (kopyalar arası
   saat kaymasına bağlı değil). → "İlk taslağı iptal etmek, ilk soruyu silmek demek olmasın": taslak düşse de soru kayıtlı ve açık kalır.
2. **Tur = o an açık olan misafir satırları.** Metinleri yazılış sırasıyla, satır sonuyla birleşir ve hattın tamamı (anlama, getirme, model,
   kapılar, dil, kayıt gerekçesi) bunu misafirin **tek mesajı** olarak görür. Yeni bir istem biçimi YOK: çok sorulu tek mesajın bugünkü yolu
   aynen çalışır. (`AI_TURN_MESSAGES_ENABLED` ölçümündeki risk — önceki mesajdaki bilinmeyen soruyu uydurarak cevaplama — yeni bir istem bloğuna
   bağlıydı; burada misafir iki soruyu tek mesajda yazmış gibi olur, risk bugünkü çok sorulu mesajın riskiyle AYNIDIR. Yine de açmadan önce
   kör ölçüm şart — §6.)
3. **Kayıt anı hükmü** (konuşma kilidi altında; ev sahibinin cevap rotasıyla aynı kilit) — `qrTurnCommitVerdict`:
   - daha yeni açık mesaj varsa **cevap yazılmaz** (bayat); o mesajın isteği hepsini birlikte cevaplar;
   - **devir kararı asla düşmez** (tehlike bildirimi daha yeni bir mesaj yüzünden kaybolmaz): gördüğü satırlar için yazılır, yeni satır açık kalır;
   - taslağın kapsadığı bir satır bu arada ev sahibine bırakıldıysa cevap **gitmez**, kalan satır da ev sahibine kalır (kısmi gönderim açılmaz);
   - kendi satırının kararı başka istekte verildiyse hiçbir şey yazılmaz.
4. **Sabit bekleme yok.** İstek hemen çalışır. Bedeli: model düşünürken yeni mesaj gelirse ilk model çağrısı boşa gider. Sınırlayan: (a) ücretli
   adımlardan hemen önce "tur hâlâ güncel mi" kontrolü (yeni mesaj geldiyse model hiç çağrılmaz), (b) konaklama başına saatte 40 mesaj tavanı ve
   günlük kotalar (aynen).

Ek: **sahipsiz mesaj.** Açık satır 5 dakikadan eskiyse onu işleyen istek ölmüştür (süren istek saniyeler sürer; çalışan kilit 120 sn). Sahipsiz
satır yeni tura katılmaz (dünkü "yarın" bugünün cevabına karışmasın) ve sessiz kalmaz: ev sahibine bırakılır ("Yanıtınızı bekliyor" + karar kaydı
`qr_turn_abandoned` + uyarı). Tur 10 mesajı / 8.000 karakteri aşarsa model çağrılmaz, hepsi ev sahibine (`qr_turn_too_large`).

## 3. Kurucunun cümleleri → davranış

| Kurucu | Davranış | Test |
|---|---|---|
| "5 soru … tek cevap" | Model düşünürken gelen mesajlar tek turda birleşir, tek cevap yazılır | `qr-turn-merge` "TEK cevap ikisini kapsar" |
| "İlk taslağı iptal etmek, ilk soruyu silmek demek olmasın" | Satır önce yazılır; taslak düşünce satır açık kalır, yeni tur onu da kapsar | "ilk taslak ÖNCE biterse de gitmez" |
| "Wi‑Fi cevabı zaten gittiyse ikinci cevap yalnız otoparkı kapsasın" | Kararı verilmiş satır tura girmez | "ikinci cevap YALNIZ yeni soruyu kapsar" |
| "sabit üç saniye eklemeyelim" | Bekleme yok; ikinci istek hemen modele gider | aynı test (zamanlayıcı yok) |
| "İkinci soru güvenle cevaplanamıyorsa açık tutalım; kısmi gönderimi gizlice açmayalım" | Birleşik tur kapıdan geçmezse HİÇBİR ŞEY gitmez, hepsi ev sahibinde; ev sahibine bırakılmış satırı kapsayan taslak gitmez | "devir kararı … DÜŞMEZ … kısmi gönderim yok" |
| "10 soru … 2'ye bölebilsin" | 700 karakteri aşan cevap iki mesaja bölünür | "uzun cevap iki mesaja bölünür" + çekirdek testleri |

## 4. Uzunluk dağılımı (ölçüm, ücretsiz)

Kaynak: `docs/olcum/*.json` açık ölçüm dosyaları (kör / kabul / mühürlü dosyalar OKUNMADI); misafire **gitmiş** 2.350 cevap.

| Ölçü | Karakter |
|---|---|
| medyan | 138 |
| %90 | 229 |
| %99 | 347 |
| en uzun | 556 |
| cümle başına ortalama | ~106 |
| tek sorunun cevabı (tipik) | 90–140 |

Çıkarım: beş sorunun cevabı ≈ 500–700 karakter → **tek mesaj**; on sorunun cevabı ≈ 1.000–1.400 → telefonda tek baloncuk ekranı aşar →
**iki mesaj**. Eşik `QR_REPLY_SPLIT_OVER = 700`; parçaların hiçbiri 200 karakterden kısa kalmaz; gönderim tavanı (2.000) aynen. Bölme yalnız
sunumdur: kapılar metnin tamamını tek parça görür, iki parça aynı işlemde art arda yazılır. Sınır önceliği: boş satır > satır sonu > cümle sonu,
ortadaki banda (%35–%65) en yakın; cümle ortasından bölünmez, sınır yoksa bölünmez (liste numarası "1." ve küçük harfle süren kısaltma sınır
sayılmaz).

## 5. Ekran

Kip açıkken (`turnMerge`, sayfa anahtarı okuyup verir) misafir cevabı beklemeden yazabilir. Yerel balonlar sunucu listesinden ayrı tutulur;
okuma yanıtı misafirin kendi istek kimliğini (`clientId`) taşır → kaydı listede görünen mesaj iki kez çizilmez, yolda olan mesajın balonu
kaybolmaz. "Yazıyor" göstergesi son istek bitene kadar durur. Sunucu, kapsanan isteğe `{ merged: true }` döner (ekran bunu "kaydedildi" sayar).
Yeni misafir metni YOK.

## 6. Açmadan önce (kurucuya sorular + ölçüm)

**Ölçüm (ücretli, kurucu onayıyla):** anahtar açık / kapalı aynı senaryolar — iki-üç mesaja bölünmüş sorular, biri bilgi tabanında yok. Bakılacak:
yanlış gönderim sayısı (uydurma cevap) kapalıyken ≥ açıkken mi; tek cevabın bütün soruları kapsama oranı.

**S-F4b-1 · Art arda yazılan mesajlardan biri cevaplanamıyorsa.** Örnek: misafir 10:00:00 "Ütü var mı?" (bilgi tabanında yok), 10:00:03 "Wi‑Fi
şifresi ne?" yazıyor.
- Bugün (sıralı): ütü sorusu size kalır, Wi‑Fi cevabı gider.
- Kip açıkken: iki mesaj tek tur → birleşik cevap kapıdan geçemez → **hiçbiri gitmez, ikisi de size kalır** (kısmi gönderim açılmadığı için).
  Misafir önce ütüyü sorup cevabın gelmediğini gördükten SONRA Wi‑Fi'yi sorarsa bugünkü gibi Wi‑Fi cevabı gider.
- Önerim: böyle kalsın (talimatınızla uyumlu); kısmi gönderim QR'a ayrı kararla gelirse bu durum da çözülür. **Uygun mu?**

**S-F4b-2 · Bölme eşiği.** 700 karakter (≈ 5 sorunun cevabı tek mesaj, daha uzunu iki mesaj). **Uygun mu, yoksa daha kısa / uzun mu olsun?**

**S-F4b-3 · Ev sahibine daha önce bırakılmış mesaj.** Örnek: misafir sabah "Klima çalışmıyor" yazdı (size kaldı, henüz cevaplamadınız); öğlen
"Çöp ne zaman alınıyor?" yazıyor. Kanal yolunda klima mesajı cevap gidene kadar sonraki turların kapısında kalır; QR'da bugün kalmaz (çöp cevabı
gider). Bu değişiklik bunu DEĞİŞTİRMEDİ (yalnız kararı verilmemiş mesajlar birleşir). **Böyle kalsın mı?**

## 7. Bilinen sınırlar

- İstek kimliği göndermeyen eski açık sekme: tekrar koruması bugünkü gibi yoktur (satır yine işaret taşır).
- Kapsanan (bırakılan) isteğin model çağrısı ve kota birimi geri gelmez (yukarıda sınırlandı).
- Kritik uyarı kimliği metinden türediği için aynı tehlike mesajı iki turda (tek başına + birleşik) iki uyarı üretebilir — fazla uyarı ucuz taraf.
- Süreç çökerse (dağıtım) açık satır sahipsiz kalır; ev sahibi onu konuşmada görür ama işaret ancak misafirin sonraki mesajında düşer
  (G-2 konuşma özeti bunu kendiliğinden "bekleyen misafir mesajı" olarak gösterecek — orada bağlanır).
