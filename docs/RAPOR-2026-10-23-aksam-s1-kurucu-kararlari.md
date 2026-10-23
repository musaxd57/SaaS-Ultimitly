# Rapor — 10-23 akşam: kurucu kararları (S1) kodda

Kararların aynen metni: `docs/KURUCU-KARARLARI-2026-10-23-aksam.md`. Önceki rapor (sorular): `docs/RAPOR-2026-10-23-ogle-okuyucu-anlam-denetimi-ve-etiketler.md` §4.
Railway KAPALI → hiçbiri canlıda değil; anahtarlı olanlar Railway açılış listesinde (`docs/RAILWAY-ACILIS-2026-10-15.md`).

## 1. Ne yapıldı (karar → kod)

| Karar | Kod | Anahtar |
|---|---|---|
| **4.5** "ev sahibinize sorabilirsiniz yazamaz … bilgisi yok sayılsın cevap tutulsun" | `ai/absence.ts refersGuestToHost` (TR/EN/DE/FR/ES/RU): misafiri bilgi için ev sahibine gönderen cümle "bilgim yok" sayılır → gitmez, istek açık kalır. Hariç: istenen telefon / e-posta DEĞERİ veren cümle, olay koşullu ev talimatı ("anahtarı kaybederseniz ev sahibinize ulaşın", "acil bir durumda"), yönlendirmenin olumsuzu ("ev sahibinize sormanıza gerek yok"), ev sahibinin kendi eylemi ("ev sahibiniz sizi kapıda karşılayacak"). İstem artık yönlendirme öğretmiyor; okuyucu da aynı sınıfı itiraf sayar. | anahtarsız |
| **4.5** "salak host kendi telefon numarasını yazamaz … rezervasyondan önce" | Airbnb'de onaylı rezervasyon yokken cevapta telefon / e-posta / bağlantı DEĞERİ varsa okuyucu olmasa da kod tutar (`containsContactValue`; "bit.ly/…", "t.me/…" dahil). | anahtarsız |
| **4.2** "Kahvaltı dahil mi?" → ücret de | Parça kipi istemi: dahil / ücretsiz sorusunda kalem ücreti yazıyorsa ücret koşuluyla söylenir ("Dahil değil; kişi başı 250 TL."). Yalnız ücret kuralı açıkken (kapalıyken her tutar yasak). | parça kipi + `AI_KB_FEE_RULE_ENABLED` |
| **4.9** "klimayı soğuğa nasıl alırım … yeri gitsin mi" | (a) İstem: nasıl yapılır sorusunda yer tek başına cevap değil, kalem adımları da yazıyorsa ikisi birlikte. (b) `ai/part-rewrite.ts`: okuyucu ya da kod bir parçayı DÜZELTİLEBİLİR sebeple tutarsa (sorulanı cevaplamıyor / yarım / yanlış bağ / notlarda olmayan söz / alıntı birebir değil / sayı alıntıda yok / ters olumluluk / çok uzun) cevap modeli o parçayı BİR KEZ aynı notlardan yeniden yazar; yeni parça kodun bütün denetimlerinden ve okuyucudan yeniden geçer, yine tutulursa ev sahibine kalır. Düzelmeyecek sebep (iki kalem çelişkisi, okuyucu emin değil, yalnız istisna) yeniden yazılmaz; tutulmayan parçaya dokunulamaz; tur başına bir kez. | `AI_PART_REWRITE_ENABLED` (yeni, kapalı) |
| **4.3** köpek sorusu bütün mesajı tutmasın | "Kural ihlali" kelime ağı ikiye bölündü (evcil hayvan / parti-fazla kişi-sigara-çıkışı reddetme; ağın kendisi aynı). Yalnız evcil hayvan ailesindense etiket evcil hayvan isteğine bağlanır — ama yalnız mesajın öteki istekleri bağımsız bilgi soruları (sauna, Wi-Fi, saatler, otopark…) ise. Öteki istek "diğer" / konaklama değişikliği / şikâyet ise bugünkü gibi bütün mesaj tutulur. | öğe kipi (canlıda açık olacak) |
| **4.4 A** evcil hayvan | Evcil hayvan isteği varsayılan ev sahibinde. TEK istisna: bilgi tabanı kodla okunduğunda açıkça ücretsiz + koşulsuz kabul diyorsa (`conversation-items/pet-policy.ts kbPetsFreeAllowed`; koşul / ücret / sayı / "küçük", "en fazla", "tasma zorunlu", "if", "only" … ya da başka hizmetin "ücretsiz"i → hayır). Yardımcı / hizmet / destek hayvanı (çok dilli) ayrı etiketle (`assistance_animal`) her zaman ev sahibinde; panelde "yardımcı hayvan — Airbnb: hizmet hayvanı reddedilemez, ücret alınamaz". Kod yedeği (kanal + QR kapısı): evcil hayvandan söz eden cevap yalnız doğrulanmış ücretsiz kabulde gider (`reply_pet_policy`). Ücret kuralı istemi: evcil hayvan ücreti kurala girmez. Bilgi tabanında "yasak" yazan kalem için uyarı metni hazır (`kb-scan/pet-rule.ts`, tarama dilimiyle panele bağlanacak). | anahtarsız (kapı) + öğe kipi |
| **4.10 A** "sakın B'yi yapma" | "Giriş saati kaçta? 12'de girebilir miyiz?" turunda standart giriş saati de gitmez — davranış test pinine alındı. | — |
| **4.1 B** kısmi cevap + açık ihtiyaç | Gönderilen turda cevaplanmayan güvenli istek (ve "gider ama açık kalır" parçası) için o mesaja TEK "Misafir cevabınızı bekliyor" e-postası; kalıcı kayıt ikinci e-postayı önler; hassas öğe e-postası giden mesaja ikinci e-posta yok; kaynak / asistan sorusu e-posta almaz. | öğe kipi |
| **4.8** yanmış seti ayrıntılı koş | Koşu + neden analizi (§3); çıkan düzeltmeler: olumluluk okumasında "kapalı havuz / kapalı tutun" sıfat-talimat (5 gereksiz tutma), "ücretsiz otopark yok" olumsuzlanmış ücretsizlik, daire saat satırının eş etiketleri ("Giriş saati:" / "Check-in time:"). | — |

## 2. Önce / sonra örnekleri (misafire giden)

- "Otopark var mı?" — bilgi tabanında yok. **Önce:** "Otopark için ev sahibinize sorabilirsiniz." gidebiliyordu. **Sonra:** hiçbir şey gitmez; istek panelde açık + (kısmi turda) tek e-posta.
- Airbnb ön sorusu (rezervasyon yok): "Numaranızı alabilir miyim?" **Önce:** model numara yazarsa okuyucu kapalıyken gidebiliyordu (Airbnb zaten engeller). **Sonra:** kod tutar.
- "Kahvaltı dahil mi?" (kalem: "Kahvaltı fiyata dahil değildir, kişi başı 250 TL.") **Önce:** "Dahil değil." **Sonra:** "Dahil değil; kişi başı 250 TL." (ücret kuralı açıkken).
- "Klimayı nasıl soğutmaya alırım?" (kalem: "Kumanda komodinin çekmecesinde; mavi kar tanesi tuşu soğutma.") **Önce:** "Klima kumandası komodinin çekmecesinde." → okuyucu "yarım" der, hiçbir şey gitmez. **Sonra:** istem yer + adımı birlikte ister; yine yarım yazılırsa bir kez yeniden yazılır: "Kumanda komodinin çekmecesinde; soğutma için mavi kar tanesi tuşuna basın."
- "Sauna kaçta açılıyor? Küçük köpeğimizi getirebilir miyiz?" **Önce:** hiçbir şey gitmez. **Sonra:** "Sauna 16:00'da açılıyor." gider, köpek sorusu sizde.
- "Köpeğimizi getirebilir miyiz?" — bilgi tabanı "Evcil hayvanlar ücretsiz kabul edilir." → "Evet, getirebilirsiniz." gider. "Gecelik 200 TL ile kabul edilir" / "küçük köpekler" / "yasaktır" → sizde (yasakta bilgi tabanı uyarısı).
- "Rehber köpeğim var, gelebilir mi?" → her zaman sizde, panelde "yardımcı hayvan" etiketiyle.
- "Wi-Fi şifresi? Sitede sauna var mı?" (sauna bilgisi yok) **Önce:** Wi-Fi gider, sauna yalnız panelde. **Sonra:** Wi-Fi gider + size tek "Misafir cevabınızı bekliyor" e-postası.

## 3. 4.8 — yanmış set neden analizi ve yeniden koşu

(ölçüm sonucu bu bölüme eklenecek)

## 4. Kurucuya sorular

(bölüm sonuçla birlikte yazılacak)
