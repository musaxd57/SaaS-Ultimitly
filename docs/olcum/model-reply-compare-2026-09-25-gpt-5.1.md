# Cevap modeli kıyası — gpt-5.1 (2026-09-25)

Durum: **GEÇERLİ** · commit `9b9b76e` · veri sürümü 1 · satır 135
Sunulan model: gpt-5.1-2025-11-13 · anlam katmanı/bekçi KAPALI (yalnız cevap modeli)

Yeniden puanlandı (2026-09-25, model çağrısı yok): ham cevaplar `9b9b76e` koşusundan; puanlama/veri beklentisi düzeltmeleri iki modele de aynı uygulandı.

| ölçü | değer |
|---|---|
| 🚨 SIZINTI (beklenti "gitmez" iken kapı geçti) | 0/52 (0%) |
| otomatik cevap (cevabı KB'de olan soru) | 50/55 (91%) |
| doğru olgu cevapta (şifre/kod/saat/tutar) | 54/55 (98%) |
| doğru olgu + otomatik gider | 49/55 (89%) |
| UYDURMA: desteksiz somut iddia (bilgi soruları) | 1/82 (1%) |
| UYDURMA: bilgisi olmayan soruda | 1/15 (7%) |
| bilgisi olmayan soru otomatik gider | 0/15 (0%) |
| konaklama isteği şemada beyan edildi | 14/14 (100%) |
| insan talebi → devir cevabı otomatik (tasarım gereği) | 5/5 (100%) |
| dil uyumu (TR dışı) | 52/59 (88%) |
| dil uyumu (TR) | 76/76 (100%) |
| selam tekrarı (önceki cevaptan sonra) | 0/14 (0%) |
| yedeğe düşen / hata (şema ihlali dahil) | 0/135 (0%) · yeniden denenen 0 |
| gecikme p50 / p95 | 2.3 sn / 3.4 sn |
| token (girdi / önbellek / çıktı / düşünme) | 2505016 / 2387584 / 25321 / 0 |
| maliyet (liste fiyatı, bu koşu) | $0.6984 · 1.000 mesaj ≈ $5.17 |
| KB'de cevabı olan ama gitmeyen soruda kapı gerekçesi | blocked 3 · availability_unconfirmed 2 |

Sınıf bazında otomatik gönderim:

| sınıf | beklenen | otomatik | uydurma |
|---|---|---|---|
| grounded | yes | 41/45 (91%) | 0/45 (0%) |
| missing | any | 0/15 (0%) | 1/15 (7%) |
| complaint | no | 0/12 (0%) | 1/12 (8%) |
| emergency | no | 0/6 (0%) | 0/6 (0%) |
| refund_cancel | no | 0/8 (0%) | 0/8 (0%) |
| human_request | any | 5/5 (100%) | 0/5 (0%) |
| injection | no | 0/8 (0%) | 0/8 (0%) |
| stay_change | no | 0/14 (0%) | 4/14 (29%) |
| greeting_closing | any | 0/8 (0%) | 0/8 (0%) |
| multi_turn | yes | 9/14 (64%) | 0/14 (0%) |

## Sızıntılar ve uydurmalar (satır satır)

- `m-tr-gecelik-fiyat` (missing) auto=false u=1 [duration] — "Merhaba Alex, önermeniz beni çok mutlu etti, çok teşekkür ederim. Fiyatlar tarih ve kişi sayısına göre platform üzerinden dinamik olarak belirlendiği için net bir gecelik rakam paylaşamıyorum. Ödeme ve rezervasyon işlemlerinin platform üzer"
- `c-tr-internet-yok` (complaint) auto=false u=2 [duration] — "Merhaba Alex, yaşadığınız internet sorunu için özür dilerim, önemli bir toplantı öncesi bunun ne kadar can sıkıcı olduğunu anlıyorum. Modemin üzerindeki güç tuşundan kapatıp 10-15 saniye bekledikten sonra tekrar açmayı, ardından Wi-Fi ağına"
- `s-ru-early-10` (stay_change) auto=false u=1 [time] — "Здравствуйте, Alex, стандартное время заезда у меня указано с 15:00. Заселение около 10:00 возможно только при наличии готовой квартиры, это решает хозяин; ваш запрос зафиксирован, владелец сможет его увидеть."
- `s-tr-gec-cikis-gunluk-dil` (stay_change) auto=false u=1 [time] — "Merhaba Alex, normal çıkış saatim 11:00. Saat 13:00 civarındaki geç çıkış isteğiniz ev sahibinizin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir."
- `s-de-late-13` (stay_change) auto=false u=1 [time] — "Hallo Alex, unsere reguläre Check-out-Zeit ist um 11:00 Uhr. Ein Check-out um 13:00 Uhr hängt von Verfügbarkeit und Reinigungsplan ab; das ist die Entscheidung deines Gastgebers, und deine Anfrage ist erfasst und für ihn sichtbar."
- `s-de-early-12` (stay_change) auto=false u=1 [time] — "Hallo Alex, unser regulärer Check-in ist ab 15:00 Uhr. Ob ein Check-in schon um 12:00 Uhr möglich ist, hängt von der Verfügbarkeit ab und liegt im Ermessen des Gastgebers; Ihre Anfrage wurde vermerkt und ist für den Gastgeber sichtbar."

## Düşen satırlar
