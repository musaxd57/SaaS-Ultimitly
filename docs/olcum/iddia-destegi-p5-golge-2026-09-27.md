# İddia desteği (P5) — gölge koşu: yanlış alarm + kaçan uydurma (2026-09-27)

> Kurucu 09-27: "P5'i şimdi canlı açma. 10 dakika = 10 minutes geçerken gerçekten farklı sürelerin geçmediğini test et; ardından
> gölge koşuda yanlış alarm ve kaçan uydurmaları raporla." P5 CANLIDA KAPALI kalır (hiçbir kapı `claim-support.ts`i okumaz — mimari pin).
> Ölçüm ÜCRETSİZ: 27.09'un önbellekteki 552 gerçek cevabı (gpt-5.1, dev seti, soru başına 60 kalem) aynı istemle yeniden denetlendi.

## Sonuç

| | eski denetim | yeni denetim |
|---|---|---|
| desteksiz iddia taşıyan cevap (552) | **21** | **1** |
| bunlardan gerçek bulgu | 1 | 1 |
| dayanaklı batarya (138 cevap) yanlış alarm | 0 | 0 |
| uydurma bataryası ana küme (45) yakalanan | 43 | 43 |
| uydurma bataryası zor küme (25) yakalanan | 8 | 8 (kaçan 17: sözel uydurma — sayısal denetimin kapsamı dışı) |
| yeni kontrol: "4 km’lik" bağlamında cevaptaki "4 metre" | **kaçıyordu** (4 km 4 m okunuyordu) | yakalanır |

Kalan tek alarm gerçek: "Dört kişi için … toplam **8 havlu**" — kaynakta yazmayan, hesapla türetilmiş sayı (hesap doğru; kör inceleme).

## Yanlış alarmların kökleri (20 cevap, hepsi kaynak metinle yeniden üretildi)

| kök | örnek (cevap ⇐ kaynak) | düzeltme |
|---|---|---|
| birim eşleşmenin SON harflerinden okunuyordu | "100 Mbps" ⇐ "100 Mbps’e" (birim "e") · "4 km" ⇐ "4 km’lik" (4 METRE) · "180°C" ⇐ "180°C’ye" · "8–10 minutes’ walk" (birimsiz) | birim = eşleşen birim sözcüğü, kesme işaretinden öncesi |
| Türkçe belirsiz "bir" sayı 1 sanılıyordu | "yeni **bir anahtar**" · "küçük **bir çocuk** oyun alanı" · "**Gece bir** acil durumda" (01:00) | değeri 1 olan sözcük yalnız ölçü biriminden (süre/mesafe) önce iddia; saat sözcüğünden sonra yalnız "birde" |
| sıfat + "bir" + ad | "çok daha **erken bir saat** için" | kapalı sıfat kümesinden sonra "bir" belirsizliktir |
| katlama çakışması | "her 40 dakikada **bir geçen**" → "gece" · "güneş / güncel" → "gün" | "gece / gün" yalnız fiil/sıfat devamı yokken birim |
| İngilizce "on" Türkçe "on" (10) sanılıyordu | "**on weekdays** between 08:30 and 18:00" · "on days when it rains" | Türkçe "on" yalnız Türkçe birimden önce; İngilizce birim sözcük sınırıyla biter |
| "night bus" bileşiği | "there are **two night bus** routes" (2 gece) | gece + otobüs/tren/vardiya… bileşiği gece sayısı değil |
| genel sayma sözcüğü diller arası | "**iki adet** vantilatör" ⇐ "two portable fans" | adet / tane / pieces nesne taşımaz → DEĞERLE eşleşir |
| süre sözcüğü diller arası | "**bir haftayı** aşan" ⇐ "stays over a week" | bağlamda "a / an + ölçü birimi" = 1 (yalnız desteği genişletir) |

## Farklı değer GEÇMEZ (kontroller, `tests/unit/claim-support-translated-units.test.ts`)

"10 dakika" bağlamında: 10 minute(s) / Minuten / minutos / минут / دقائق desteklenir; **15 minutes, 10 hours, 10 seconds, 15 Minuten,
20 минут desteklenmez**. "4 km’lik" ↔ 40 km / 4 metre · "100 Mbps’e" ↔ 1000 Mbps · "180°C’ye" ↔ 200°C · "8–10 dakika" ↔ 12 minutes’ /
10 hours’ · "two portable fans" ↔ üç adet / 3 tane · gerçek gece sayısı ("two nights", "iki gece konaklama"), gerçek saat ("gece birde"),
gerçek süre ("bir saat sürer", "transfer bir gün sürer", "her 50 dakikada bir") İDDİA kalır ve desteksiz yakalanır.

## Bilinen sınırlar (bilinçli)

- Değeri 1 olan sözcük sayım / kişi biriminden önce iddia DEĞİL: uydurma "bir anahtar" (kaynakta 2) görünmez — belirsizlik okuması baskın.
- Genel sayma sözcüğü bağlamdaki HERHANGİ bir aynı sayıyla desteklenir ("3 adet", bağlamda "3. kat" varsa geçer).
- Türetilmiş doğru hesap desteksiz görünür ("toplam 8 havlu") — harfiyen dayanak ilkesi; kör inceleyici karar verir.
- Sözel uydurma (sayısız) bu denetimin kapsamı dışı (zor kümede 17/25 kaçan).

P5 canlıya açılırsa önce `time / date / money` sınıfları (09-26 kanıtı `iddia-destegi-p5-kanit-2026-09-26.md`); açma kurucu kararı.
