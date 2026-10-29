# Gece döngüsü — derin hata ayıklama bulguları (10-28 / 10-29 gece)

> Kurucu (aynen): "soru sormadan ilerle, debugging yap ama sadece kendin oku, her 30 dk'da 1 derin ve geniş çapta didik didik debugging".
> Alt ajan yok; her bulgu kodda ölçülür. Yalnız TUTMA yönündeki düzeltmeler ve iç hatalar uygulanır; müşteriye gideni gevşeten ya da yeni
> davranış kuran bulgu önce / sonra örnekli SORU olarak buraya yazılır.

## Tur 1 — `ai/host-contact-filler.ts` (bu gece yazılan R13-b/c silicisi) × konuşma öğeleri kipi (canlı)

### GD1 — P1 (kendi kodum, tutma yönünde düzeltme) — misafirin sorduğu varsayımsal durumun cevabı silinince istek sessizce "cevaplandı" kapanıyor
- Mesaj: "Otopark var mı? Wi-Fi bozulursa ne yapmalıyım?" · model: "Otopark arkada. Wi-Fi bozulursa ev sahibinize yazın." · model beyanı: iki
  istek de cevaplandı (`answeredRequests`).
- Silici "yazın" cümlesini çıkarır (kurucu: hiçbir koşulda gitmez) → misafire yalnız otopark gider; ama öğe kipinde Wi-Fi isteği modelin beyanıyla
  "cevaplandı" kapanır → ev sahibi o soruyu GÖRMEZ.
- Düzeltme: çıkarılan cümle misafirin TAM sorduğu duruma cevapsa (`guestAskedThisSituation`) cümle silinmez, bütün cevap tutulur
  (`hostContactOnly`) — ev sahibi yanıtlar. Genel kapanış (soruyla ilgisiz) silinmeye devam eder.
- Durum: kapı bitince uygulanacak (kırmızı-önce test + mutasyon + tam kapı).

### GD2 — P3 (bilinen sınır, düzeltilmedi) — koşul eki sezgisi yer adlarına takılabilir
- `asksHypotheticalSituation`: "Bursa'dan geliyoruz" → "Bursa" "-rsa" koşul eki gibi okunur. Etkisi dar: koşullu "arayın" cümlesinin KALMASI için
  ayrıca konu örtüşmesi + bilgi tabanı dayanağı gerekiyor. Yazıldı, değiştirilmedi.

### GD3 — P3 (bilinen sınır) — önceki cevapsız mesaj varsayımsal, son mesaj yaşanan olay
- "Anahtarı kaybedersem?" (cevapsız) → "Anahtarı kaybettim" (yeni): silici iki metni birlikte okuduğu için "kaybederseniz ev sahibinizi arayın"
  (dayanaklıysa) KALIR. Tek mesajda ("Anahtarı kaybettim") silici cümleyi çıkarır, içerik kalmazsa tutar (ölçüldü). İlk taslakta "sözcük ağı bunu
  zaten tutar" yazmıştım — ÖLÇÜM YANLIŞLADI (↓GD4); düzeltildi.

### GD4 — P2 — SORU (davranış değişikliği) — kayıp anahtar sözcük ağında sorun sayılmıyor
Ölçüldü (kapı, model niyeti "genel", cevap "Anahtarı kaybederseniz ev sahibinizi arayın."):

| misafir | sözcük ağı | bugün |
|---|---|---|
| "Anahtarı kaybettim" | `checkin`, şikâyet değil | kapı GEÇİRİR (silici "arayın"ı çıkarır → içerik yoksa tutulur) |
| "I lost the key" | `checkin`, şikâyet değil | aynı |
| "Anahtarı kaybettim, ne yapmalıyım?" | `checkin`, şikâyet değil | aynı |

Kayıp anahtar bir ERİŞİM / GÜVENLİK olayıdır (kilit değişimi, yedek anahtar, ücret). Bugün tek koruma modelin niyeti. Önerim: "anahtar(ı) kaybettim /
kayboldu / bulamıyorum / lost (my) key / locked out" yaşanan olay kalıbı sözcük ağında erişim sorunu sayılsın → cevap ne olursa olsun ev sahibine
kalır (yedek anahtar bilgisi bilgi tabanında olsa bile ilk cevap ev sahibinden). Önce: model "genel" derse bilgi tabanındaki "yedek anahtar
resepsiyonda" cevabı gidebilir. Sonra: her kayıp anahtar bildirimi ev sahibinde. **Böyle yapalım mı?**
