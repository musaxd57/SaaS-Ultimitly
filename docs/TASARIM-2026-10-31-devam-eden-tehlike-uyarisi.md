# TASARIM — Devam eden tehlike bildirimi acil uyarı üretsin (kurucu 10-31)

> Kurucu (aynen, özet): "'Asansörde mahsur kaldık', 'biri kapıyı zorluyor', 'bizi tehdit ediyor' gibi devam eden tehlike bildirimleri uyarı
> üretmeli. Yalnız önceliği / bekleme süresini değiştirmek yeterli değil. Ama tek başına kelime eklemek de doğru çözüm olmaz. … Kesin tehlike
> ifadelerini yakalayan kod desteği + belirsizliği bağlamdan değerlendiren model birlikte. Model çalışmadığında da açık tehlike bildirimi
> sessizce kaybolmamalı. Test yalnız 'acil sınıfına girdi' dememeli: doğru host için bildirim oluşturuldu mu, kuyruğa kaydedildi mi, gönderim
> başarısızsa görünür oldu mu? Aynı olayın tekrarları bildirim yağmuruna dönüşmesin; aynı konuşmadaki yeni bir tehlike de eski bildirim
> yüzünden bastırılmasın."

## 1. Bugün (ölçüldü 10-31)

| Mesaj | Acil uyarı ağı (`isSafetyEmergencyText`) | Can güvenliği (yalnız zamanlama) |
|---|---|---|
| "Asansörde kaldık, çıkamıyoruz." | ✗ uyarı YOK | ✓ |
| "Biri kapıyı zorluyor!" | ✗ | ✓ |
| "Bizi tehdit ediyor" / "Нам угрожают" | ✗ | ✓ |
| "Quelqu'un force la porte" / "Alguien está forzando la puerta" / "شخص يحاول كسر الباب" | ✗ | ✗ |
| "Hırsızlığa karşı kasa var mı?" | ✗ (doğru) | ✓ (fazla — zamanlama için zararsız) |
| "Asansörde mahsur kalırsak kimi arayacağız?" | ✗ (doğru) | ✓ (fazla) |

Uyarı ağı bu sınıfı hiç tanımıyor. Can güvenliği sınıfı tanıyor ama varsayımsal soruyu ayırmıyor (uyarı için kullanılamaz).

**Kodda iki ek açık (okundu 10-31):**
1. Kelime uyarı geçişi (`sendDueAlerts`, `automation.ts`) acil sayımı için acil ağının YANINDA tehlike okuyucusunun (`hazardEvidenceOf` —
   yangın / gaz / elektrik / su) "açık / olası" demesini de şart koşuyor (`emergencyHit`). Yalnız acil ağına sözcük eklemek "zorla giriş"i
   yine uyarısız bırakırdı (okuyucu bu sınıfı tanımıyor).
2. Aday sorgusu yalnız `status: new` + "olası tehlike" işaretli Sorunlu konuşmaları seçiyor. Şikâyetle / model yoluyla / elle Sorunlu
   yapılmış konuşmada YENİ tehlike mesajı hiçbir yoldan uyarılmıyor (model yolu Sorunlu görünce erken döner) — kurucunun "eski bildirim
   yüzünden bastırılmasın" dediği açık bugün VAR.

## 2. Öneri — iki katman

**A. Kod: "devam eden tehlike" okuyucusu (`ai/active-danger.ts`, saf, LLM'siz).** Yalnız EYLEM / DURUM bildiren öbek (isim tek başına
değil): mahsur kalma ("asansörde kaldık / çıkamıyoruz / mahsur kaldık", "stuck/trapped in the lift", "stecken im Aufzug", "bloqués dans
l'ascenseur", "atrapados en el ascensor", "застряли в лифте", "عالقون في المصعد"), zorla giriş ("kapıyı zorluyor", "zorla girdi", "hırsız
girdi / içeride", "breaking in / broke in / intruder", "einbrechen / Einbrecher im Haus", "force la porte / cambriolé", "forzando la puerta /
entraron a robar", "ломятся / взломали", "يحاول كسر الباب / دخل لص"), tehdit / saldırı ("tehdit ediyor / etti", "bize saldırdı",
"threatening us / attacked us", "bedroht uns", "nous menace", "nos amenaza", "угрожают / напали", "يهددنا / هاجمنا").
**Eleyiciler (uyarı DEĞİL):** koşul ("-ırsak / -rsa / olursa", "if / in case / what if", "falls / wenn", "si / en cas de", "si / en caso de",
"если / в случае", "إذا / لو / في حال"); nesne / hizmet sorusu ("… var mı?", "is there …", "gibt es", "y a-t-il", "hay …", "есть ли", "هل
يوجد"); önlem ("… karşı", "against", "gegen", "contre", "contra", "от", "ضد"). Eleyici yalnız AYNI yan cümlede geçerli ("Asansörde kaldık!
Kimi arayalım?" → uyarı).

**Bağlantı:** okuyucu acil ağına (`isSafetyEmergencyText`) VEYA'lanır → bugünkü bütün yollar kendiliğinden: kelime uyarı geçişi
(`sendDueAlerts`, oto-yanıt kapalıyken de), oto-yanıt tur düzeyinde tutar + acil e-posta / WhatsApp, QR yapay zekâsı cevaplamaz ve ev sahibine
bildirir. Kelime uyarı geçişinin `emergencyHit`i "acil ağı VE tehlike okuyucusu" şartına "VEYA devam eden tehlike" eklenir (↑ açık 1).
Model çalışmasa da yakalanır.

**B. Model:** belirsizlik (kod eşleşmesi yok ama bağlam tehlike) anlama katmanının "acil" niyetiyle (`intent: emergency`) — bugün de model
yükseltme yolunda acil uyarı üretiyor; değişmez. Kod eşleşti ama model "varsayımsal" dese bile UYARI GİDER (şüphede uyar — kaçırmak daha
pahalı).

## 3. Tekrar / bastırma — "aynı olay" = aynı tehlike TÜRÜ

Tehlike türleri (kapalı küme): `fire_smoke · gas · electric · water · medical · trapped · intrusion · threat · self_harm · generic`.

- **Sorunlu olmayan konuşma:** bugünkü yol (ilk uyarı konuşmayı Sorunlu yapar, mesaj başına tek bildirim).
- **Sorunlu konuşma (hangi sebeple olursa olsun):** cevapsız yeni misafir mesajlarında tehlike varsa, o konuşmada son 72 saatte ZATEN
  bildirilmiş mesajların (karar kaydı `RiskEvent`, `finalDecision: human_review`, tetik mesaj) tehlike türleri çıkarılır. Yeni mesajın türü
  bu kümede DEĞİLSE → yeni tehlike → uyarı (e-posta + WhatsApp, hibrit kurala göre). Kümedeyse → aynı olayın tekrarı → uyarı YOK (konuşma
  zaten Sorunlu + Acil; panelde en üstte). Örnek: "Biri kapıyı zorluyor!" (uyarı) → "Hâlâ zorluyorlar!" (yok) → "Şimdi de duman var!" (uyarı).
- Eşzamanlı iki geçiş aynı mesajı iki kez bildirmesin: Sorunlu konuşmada talep `aiTriagedAt` üzerinde karşılaştır-ve-yaz (CAS); e-posta
  düşerse `aiTriagedAt` eski değerine döner, sonraki geçiş yeniden dener (bugünkü T2 geri alma deseni).
- Yağmurun son kesicisi bugünkü tavanlar: acil e-posta işletme başına saatte 3 + daire alt kotası (K4), WhatsApp saatte 10.
- Bugünkü "olası tehlike" yükseltmesi (T2) bu genel kuralın özel hâli olur (davranışı korunur, pinleri koşar).

## 4. Testler (kurucunun istediği uçtan uca)

- Saf: kurucu tablosu + 7 dil × (aktif / koşul / soru / önlem) + yan cümle ayrımı + süre pini (uzun metin).
- Entegrasyon (gerçek veritabanı): "Biri kapıyı zorluyor!" → (a) doğru işletmenin uyarı adresine acil e-posta, (b) doğru ev sahibine WhatsApp
  bildirimi satırı (`HostQuestion kind=alert`) + kuyruk kaydı, (c) e-posta düşerse talep geri alınır ve sonraki geçiş yeniden dener; alarm
  görünür, (d) aynı mesaj ikinci geçişte uyarı üretmez, (e) "Sorunlu" konuşmada yeni tehlike mesajı yeni uyarı üretir, (f) "Hırsızlığa karşı kasa
  var mı?" uyarı üretmez ve oto-yanıt normal cevaplar.

## 5. Risk

Acil ağına ekleme, bu cümlelere oto-yanıtı da durdurur (doğru: tehlike bildirimine yapay zekâ cevap vermez, ev sahibi devralır). Yanlış
pozitif maliyeti: gereksiz bir acil e-posta + oto-yanıt tutulur. Bu yüzden yalnız eylem / durum öbekleri, isim değil.

## 6. Sonnet eleştirisi sonrası DÜZELTİLMİŞ tasarım (10-31, bağlayıcı olan bu bölüm)

Eleştiri (kodla doğrulanacak) üç yeri değiştirdi:

1. **Ayrı okuyucu yerine tehlike okuyucusuna yeni türler.** `hazardEvidenceOf` (`ai/hazard-evidence.ts`) zaten yan cümle bölme, geçmiş anlatım
   (`PAST`), varsayım (`HYPOTHETICAL`), alıntı (`QUOTED`), olumsuzluk, soru → "olası" kademesi ve model uzlaştırmasını (`hazardDecisionFor`)
   taşıyor. Yeni türler `trapped · intrusion · threat` bu makineye eklenir: açık bildirim → "açık", soru biçimi ("zorluyor mu?") → "olası" (model
   karar verir; model yoksa uyarı). `sendDueAlerts.emergencyHit` bu türlerde acil ağı şartını aramaz. QR hızlı yolu aynı okuyucuyu kullandığı için
   kendiliğinden kapsanır. Acil ağına (`isSafetyEmergencyText`) VEYA'lama YAPILMAZ (çağıranları çok: görev üretimi "acil güvenlik bakım görevi"
   açardı, model vetosu imkânsız olurdu).
2. **Eleyiciler genişler:** birinci kişi ("kapıyı zorluyoruz / zorladım", "we had to force the door") = kapıda kalma, tehlike değil; böcek / hava /
   deyim ("sivrisinekler saldırdı", "threatening clouds"); olumsuzluk ("kimse girmedi", "zorlamıyor"); geçmiş anlatım; alıntı; "-ysak / -sak" koşul.
   Eşleşme fiil KÖKÜ değil çekimli biçim listesi (ev sahibi talimatı "kapıyı zorlamayın" tutmasın).
3. **Tekrar kuralı `RiskEvent`e DEĞİL `aiTriagedAt`e dayanır** (RiskEvent claim anında yazılır, teslim kaydı değildir; e-posta düşüp geri alınınca
   tekrar sayardı). "Bildirilmiş türler" = konuşmanın yüklü 25 mesajında `createdAt ≤ aiTriagedAt` ve son 3 saat içindeki tehlike mesajlarının
   türleri (bellekte). Sorunlu konuşma yükseltmesinde `skippedReason` YAZILMAZ (çit damgası / sebep korunur); yalnız `aiTriagedAt`, tetik, risk türü,
   öncelik; geri alma `where aiTriagedAt = talepAnı` ile ve yazılan her alan eski değerine. Sorunlu konuşmalar ayrı sorgu + ayrı tavan (yeni
   konuşmaları aç bırakmasın).

Süre: yeni kalıplar sınırlı / doğrusal; `regex-worst-mode-cost.test.ts`e eklenir. Model yolu ve QR testleri §4'e eklenir.

## 7. Uygulanan hâl ve ölçüm (10-31)

**Kod katmanı** `src/lib/ai/person-danger.ts` (yaprak modül): (a) çekimli öbekler (üçüncü kişi, ara sözcük ≤2), (b) YAKINLIK İPUÇLARI — nesne / kişi +
canlı eylem aynı yan cümlede ≤4 sözcük arayla (kapı-pencere-kilit + kırma-zorlama-tekmeleme; yabancı / hırsız + odada / girdi; silah + çekti /
bağırıyor / kapıda; "beni / bizi" + vurma; asansör + durdu + içinde — ardışık yan cümleler dahil; kilitli + banyo), (c) korumalar: koşul eki
yalnız eşleşmede ve ardındaki sözcükte, koşul sözcüğü yalnız önündeki altı sözcükte, olumsuz özne, iş gereği / doğa öznesi (çilingir, polis,
rüzgâr), ev sahibi / platform / spor "tehdidi", böcek, kendi kapısı / kapıda kalma (mesaj düzeyi), deyim ("patronum beni öldürür"); geçmiş /
aktarım / dizi-film / bitmiş olay / soru → olası (model karar verir). Doğrusal (her eylem için ±4 komşu), en kötü düzenli ifade kipinde de pinli.

**Bağlantı:** `hazardEvidenceOf` kişisel türleri taşır (QR hızlı devir, can güvenliği = ikisi birden hemen); kelime risk ağı `safety_emergency` yalnız
AÇIK düzeyde (oto-yanıt durur, model kaldıramaz; acil sözcük ağının kendisi değişmedi); bakım görevi açılmaz; uyarı geçişi yalnız AÇIK düzeyde
tam uyarı (soru / aktarım modelin) + Sorunlu konuşmada yeni tür tehlike kuralı (§6.3; damga = okunan en yeni mesaj anı, bilinmiyorsa son 3 saat).

**Ölçüm (kod katmanı tek başına, model yok):** üç ayrı yazarın kör setleri, 7 dil, her biri 105 gerçek + 77–105 zor olumsuz.

| set | ilk ölçüm (yakalama · yanlış alarm) | sonra (set GÖRÜLDÜ) |
|---|---|---|
| #1 | 52/105 · 2/77 | 93/105 · 0/77 |
| #2 | 69/105 · 7/105 | 93/105 · 0/105 |
| #3 (tarafsız) | **75/105 (%71) · 5/105** | 75/105 · 0/105 (yalnız yanlış alarm sınıfları kapatıldı) |

Yorum: sabit kural katmanı gerçek tehlikenin ~%70'ini model OLMADAN yakalar; kaçanlar (dolaylı anlatım, lehçe, çeviri yazı, paragraf içine gömülü)
anlama modelinin işidir — model yolunda "acil" niyeti zaten tam uyarı üretir (`automation.ts` model yükseltmesi, QR `alertCritical`). Kurucunun
"kod kesin olanı, model belirsizi" ayrımının sayısal karşılığı budur. Üç set gerileme fikstürü (`tests/fixtures/person-danger/seen-set-*.json`):
yanlış alarm 0'da, yakalama ölçülen düzeyin altına inemez.
