# İnceleme 2026-11-18 — Codex 11-17 raporu (957e91c1 denetimi): kodda doğrulama + durum

> Kaynak (AYNEN): `docs/KURUCU-TALIMATI-2026-11-18-codex-raporu-ve-orkestrasyon.md`. Bu dosya o raporun madde madde KODDA doğrulanmış
> hâli ve durumudur. Yöntem: yedi doğrulama ajanı (yalnız okuma) → her hüküm ana oturumda kodda / kırmızı-önce testle yeniden sınandı →
> düzeltme. Codex önerisi karar değildir: daha doğru çözüm varsa o uygulandı ve gerekçesi yazıldı.
> Çalışma düzeni (kurucu 11-18): Claude orkestratör; kod yazan Opus ajanları ayrık çalışma ağacında, push'suz; her çıktı satır satır
> incelendi (ör. ödeme-2'de ajanın eklediği tavan dalında açlık kusuru bulundu, geri gönderildi); en zor parça (ödeme-1) ana oturumda yazıldı.

Durum simgeleri: ✅ düzeltildi (commit) · 🔧 yazılıyor / incelemede · 📋 planlı (dalga) · ❓ kurucu kararı · ➖ kod değişikliği gerekmiyor.

## 1. En önemli üç bulgu (Codex'in sırası: önce 1, sonra 2 ve 3 paralel)

| # | Codex iddiası | Kodda | Açılışta tetiklenir mi | Durum |
|---|---|---|---|---|
| ÖDEME-1 | Ödeme alınmış, abonelik bağlanmamışken 10 dk kilit düşünce yeni ödeme işlemi açılıyor | DOĞRU — iki kipte de kırmızı-önce testle yeniden üretildi (`checkout-paid-awaiting.test.ts`). Niyet kapalı kipte işlem olayı hiçbir şey yazmıyordu | Evet (anahtar gerekmez) | ✅ `12e5c1f1` + `9c5c013a` — "ödeme alındı, abonelik bekleniyor" süreyle kapanmayan kayıt; tasarım `docs/TASARIM-2026-11-18-odeme-alindi-abonelik-bekleniyor.md` |
| ÖDEME-2 | Yeniden işleme işi en eski 200 kaydı seçip vadeye sonra bakıyor; arkadaki vadesi gelmiş olay hiç denenmiyor, tur işareti yine ilerliyor | DOĞRU (`paddle-replay.ts`) | Evet | ✅ `57557676`, `b6fa2706` — vade koşulu sorguda, sayfalama; tavanı aşan tur birkaç koşuya yayılan tek mantıksal tur (imleç + dondurulmuş an), tavan alarmı |
| MESAJ-3 | Dış hedefi olmayan elle açılmış konuşmada cevap yalnız kaydediliyor ama "Mesaj gönderildi" deniyor | DOĞRU (`host-send.ts` `skipped` alanını okumuyor) | Evet | 🔧 WP-B |

Codex'in uzun vadeli önerisi (ÖDEME-2: olay başına "sonraki deneme zamanı" sütunu) migration ister → migration turu adayı (§6). Şemasız
düzeltme birebir aynı seçimi yapıyor (kâhin testi) ve bugünkü ölçeğin çok üstünü taşıyor.

## 2. "Kalan önemli açıklar" 1–7

| # | İddia | Kodda | Açılışta | Durum |
|---|---|---|---|---|
| 1 | Plan değişikliği sürerken abonelik değişirse işlem eski aboneliğe gidiyor | DOĞRU, pencere 1–3 sn (`plan-change/route.ts`) | Evet (`PADDLE_PLAN_CHANGE_ENABLED`) | ✅ `1931e574`, `06def63b` — PATCH'ten hemen önce yeniden okuma (ret: var olan metin), PATCH sonrası değişim → denetim işareti + operatör alarmı (202 dalı dahil). Aynı sınıf "devam ettir": `2df90d3f` (belirteç aboneliği bağlar) |
| 2 | Onaylıdan "bekliyor"a dönen rezervasyona kuyruktaki giriş mesajı gidiyor | DOĞRU, yalnız kalıcı kuyruk yolunda (`worker.ts lifecycleVeto`) | Hayır (kuyruk kapalı) | 📋 dalga 2 (kuyruk açılış engelleri) · ❓ erteleme mi iptal mi |
| 3 | Misafire ulaşmamış ev sahibi cevabı açık ihtiyacı gizliyor | DOĞRU (`HOST_OUTBOUND_WHERE` teslim durumuna bakmıyor; dört okuyucu) | Kuyruk yolu hayır; yerel cevap evet | 🔧 WP-B (kesin gitmeyenler) · ❓ yerel / doğrulanamayan cevap (S-1, S-2) |
| 4 | Kuyrukta ihtiyaç güncellemesi düşerse teslim etkisi yine damgalanıyor | KISMEN — damga doğru; onarıcıda yeniden kapatma adımı hiç yok; etki güvenli yönde (fazladan açık iş) | Hayır | 🔧 WP-B |
| 5 | QR'da süren isteğin tekrarı mesajı kaybettirebiliyor (`deduped: true`) | DOĞRU, tetik dar (üç koşul birlikte) | Evet (`GUEST_CHAT_ENABLED`) | 📋 dalga 2 |
| 6 | Elle görev oluşturma tekrar güvenli değil | DOĞRU (`api/tasks` işlem kimliği okumuyor) | Evet | 📋 dalga 2 |
| 7 | Otomatik mesaj sırasında 200 gönderilemeyen kayıt 201.'yi kalıcı engelliyor | DOĞRU (imleç her geçişte sıfırlanıyor) | Evet (büyük portföy) | 📋 dalga 2 |

## 3. Öteki doğrulanan eksikler

| Konu | Kodda | Durum |
|---|---|---|
| Karar cevabının bağı mesajdan ayrı yazılıyor (G2-01) | DOĞRU — bağın kalıcı yazılmadığı dört yol | 🔧 WP-B (bağ mesajla aynı işlemde) |
| Karar + kuyruk: kuyruğa kabul = tamamlandı (K2-01) | DOĞRU, belgelenmiş engel; iki anahtar birlikte açılamaz | 📋 dalga 2 |
| Onay ile gönderim arası rezervasyon iptali (G2-02) | KISMEN — doğrudan yolda ms; asıl açık kuyrukta (ev sahibi satırı vetodan muaf) | 📋 dalga 2 |
| Kuyrukta son kontrol → gönderim penceresi | KISMEN — pencere Codex'in tarifinden farklı yerde (yanıt satırında varlık vetosu ↔ son talep; otomatik mesajda son talep ↔ gönderim) | 📋 dalga 2 (gerçek PostgreSQL + sahte sağlayıcı testleriyle) |
| Açık ihtiyaç listesi ilk 500 / konuşma sayfası 20 satır | DOĞRU | 📋 dalga 2 |
| Görev saati sunucu saat dilimine göre | DOĞRU (sunucu UTC ise 15:00 → 18:00) | 📋 dalga 2 |
| Giriş: hesap başına 20 deneme sınırı eşzamanlı istekte gevşiyor | DOĞRU (~54 / 15 dk; sınır dalgasında doğru parola tanınmayan cihazdan girebiliyor) | 📋 dalga 2 (hak bcrypt'ten önce ayrılır) |
| Bayat oturumun kod isteği yeni kodu eziyor | DOĞRU, etkisi düşük | 📋 dalga 2 |
| Sıfırlama e-postası canlılık kapısı kendi kaydına bakmıyor | DOĞRU, pencere ms | 📋 dalga 2 |
| Son yazmada süre sonu | KISMEN | ➖ yorum + pin (karar anı = hak alma anı) |
| Doğrulama ekranı geçerli bağlantıda hata gösteriyor | DOĞRU (`reason` başlangıçta "error") | 📋 dalga 2 |
| Alıntılanan misafir sözü ev sahibi sözü sayılıyor | DOĞRU; misafire gitmez, yanlış iç görev açar | 📋 dalga 2 · ❓ önce / sonra örneği |
| Ev sahibi cevabında değer ↔ hizmet bağı / olumsuzluk | DOĞRU; `HOST_QUESTIONS_ENABLED` kapalı → açılmadan önce şart | 📋 anahtar ön şartı · ❓ |
| `translateTo` ile önizlemesiz model çıktısı gönderimi | DOĞRU; arayüzde çağıran yok | 📋 dalga 2 (alan 400 döner) |
| Eski sekme: şablon / mülk formu başkasının değişikliğini eziyor | DOĞRU (23 sürümsüz PATCH / PUT rotası sayıldı) | 📋 dalga 2 (en riskli tam form gönderenler) |
| Operatör yapay zekâ kalite konsolu geç yanıt | DOĞRU | 📋 dalga 2 |
| "Ekstra hazırlık gerekmiyor" eksik profile rağmen | DOĞRU (dar) | 📋 dalga 2 · ❓ metin |
| Yardımcı okuma hatası boş liste gibi | DOĞRU | 📋 dalga 2 |
| Görev panosu bayat atama | DOĞRU (sunucu koruması hazır, pano göndermiyor) | 📋 dalga 2 |
| QR okuma konumu | DOĞRU | 📋 dalga 2 |
| "AI bu cevaptan emin" rozeti | KISMEN — kod doğru; etiket modelin kendi beyanını doğruluk gibi sunuyor | ❓ metin |

## 4. Codex'e eklenenler / Codex'ten ayrılan yerler

- **ÖDEME-1, niyet kapalı kip:** Codex'in senaryosu niyet akışıydı; kodda açılış varsayılanı olan kapalı kipte durumun daha kötü olduğu
  görüldü (kilidi yalnız istemci yazıyordu). Düzeltme iki kipi de kapsıyor; istemci sinyali sunucuda Paddle'dan doğrulanıyor.
- **ÖDEME-1, kalıcı engelin tersi:** "süreyle kapanmasın" tek başına müşteriyi kalıcı kilitleyebilirdi (yenileme işlemleri, olayların ters
  sırası, sonradan iptal edilen abonelik). Kayıt yalnız kanıtla açılır ve yalnız kanıtla kapanır; uzlaştırma + operatör serbest bırakma eklendi.
- **ÖDEME-2:** şemasız çözüm seçildi; tur tavanı bir "sessiz sınır" olmasın diye mantıksal tur imleci + alarm eklendi.
- **Kalan-4:** damgayı geri tutmak tek başına bir şey düzeltmez (onarıcıda adım yok) — onarıcıya adım eklenir.
- **Kuyruk penceresi:** pencere Codex'in söylediği yerde değil; gerçek pencereler ayrı ayrı testle gösterilecek.

## 5. Kurucu soruları (birikiyor; her biri önce / sonra örneğiyle rapora girecek)

- Ö-1 yeni müşteri metni (ödeme alındı, henüz tanımlanmadı) · Ö-2 abonelik olayı gelmezse kendiliğinden kurtarma · Ö-3 migration turu
  (tasarım belgesi §6).
- Plan değişikliği sürerken abonelik değişirse müşteriye "başarılı" yerine bekleme metni mi.
- S-1…S-4: elle konuşmada kaydedilen cevap konuşmayı "Cevaplandı" yapsın / ihtiyaçları kapatsın mı; doğrulanamayan gönderim ihtiyacı
  kapatsın mı; düğme "Kaydet" mi olsun; yerel cevaptaki sözden görev üretilsin mi.
- Kalan-2: "bekliyor"a dönen rezervasyonun kuyruk mesajı ertelensin mi iptal mi edilsin.

## 6. Migration turu adayları (kod YOK; tek onay)

`WebhookEvent.nextAttemptAt` + `attempts` (olay başına deneme zamanı) · ödeme kaydında abonelik kimliği · `Message.deliveryPath` +
`Message.replyScope` · `MessageOutbox.cancelRequestedAt` · görev istek kimliği.
