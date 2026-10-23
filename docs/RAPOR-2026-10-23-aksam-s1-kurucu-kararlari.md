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

Set: öğlen yakılan kabul seti (50 senaryo, 55 cevaplanması gereken + 16 açık kalması gereken ihtiyaç; geliştirme verisi, artık kabul ölçüsü
değil). Yapılandırma canlıyla aynı (Luna cevap, 5.1 anlama / okuyucu, gömme + sıralayıcı, bilgi tabanı 34 kaleme dolgulu). Raporlar:
`docs/olcum/live-pipeline-2026-10-23-gpt-6-luna-yanmis-2-e1023-new-burned{,_r2}.md` (+ `.json`). Maliyet koşu başına ≈ 0,19 $.

| ölçü | öğle kabul koşusu (kör) | 1. ayrıntılı koşu (`ae91a47d`) | 2. koşu (`f38da6b2`, bu akşamın kodu + yeniden yazma AÇIK) |
|---|---|---|---|
| doğru değerle giden ihtiyaç | 42/55 | 39/55 | **40/55** |
| açık kalması gereken → açık kaldı | — | 16/16 | 16/16 |
| 🚨 yanlış gönderim | 0 | 0 | **1 → ölçer hatası, gerçek yanlış 0** (↓) |
| gereksiz tutma | 13 | 16 | 14 |
| "bilgim yok" / iç kaynak anlatımı giden | 0 | 0 | 0 |

**Ölçerin "yanlış" saydığı tek vaka ürün hatası DEĞİL:** k-fr-001 "Y a-t-il un sauna ?" → giden "La résidence ne dispose ni de sauna ni
de hammam." · bilgi tabanı "Sitede sauna ve hamam bulunmamaktadır." Anlam birebir aynı; ölçerin (mühürlü dosyadaki) deseni Fransızcadaki
"ne … ni … ni" olumsuzunu tanımıyor (1. koşudaki "ne dispose pas de sauna" ✔ sayılmıştı). Mühürlü dosya değiştirilemez (SHA-256 pinli).

**14 gereksiz tutmanın nedenleri (koşu 2):**

| neden | adet | ne yapıldı |
|---|---|---|
| Okuyucu çağrısı o anda DÜŞTÜ (6 senaryoda 8 parça "okunamadı"; API o koşuda yavaştı — ortanca 22,6 sn, 1. koşuda 16,6 sn) | 7 | Aynı 8 senaryo tek başına yeniden koşuldu (≈ 0,03 $): okuyucu 1–2,5 sn'de cevap verdi, **bütün parçalar doğrulandı**. Kalıcı hata değil, geçici. Okuyucu düşünce her şey tutulur (güvenli yön) — yeniden deneme yok → **soru 4.11** |
| Model kendi cevabına düşük güven verdi (0,70 / 0,72 < 0,75) — oysa gidecek parça kodla + okuyucuyla doğrulanmıştı; düşük güven cevaplanamayan İKİNCİ soru yüzünden | 2 | → **soru 4.12** |
| Bir kez yeniden yazma çalıştı ama model parça kimliğini "R1" yerine "<R1>" yazdı → iyi yeniden yazım çöpe gitti (k-tr-016: "Havuz her gün 21:00'de kapanır. Pazartesi günleri temizlik nedeniyle 13:00'te açılır.") | 1 | **Düzeltildi** (kimlikteki tek kat "<>" / "[]" işareti soyulur; yine bilinen kimlikle birebir eşleşmeli). Test + pin. |
| Rusça cevapta çevrilmiş tarih ("1 октября по 30 ноября") alıntıdaki "1 Ekim – 30 Kasım" ile eşleşmiyor → sayı denetimi tutuyor; yeniden yazma aynı metni üretti | 1 | Bilinen sınır (ay adları dil bağımsız eşlenmiyor); sonraki tur |
| Balkonda sigara sorusu (ev kuralı) → ev sahibinde | 1 | Tasarım gereği: ev kuralları politikası (#188) açılış sırasında (kart → gölge → ölçüm → onay) |
| "Ekstra yatağın gecelik ücreti" → anlama katmanı "ödeme" saydı → ev sahibinde | 1 | → **soru 4.13** |
| Asistan sorusu + çıkış saati turunda çıktı vetosu tuttu (k-en-002) | 1 | 1. koşuda da tutuldu; veto kalıbı inceleniyor (sonraki tur) |

**Yeniden koşu sırasında bulunan iki hata daha (tam kapıda yakalandı, düzeltildi):**
- "I'll check with the host … and get back to you" (asistanın bekleme sözü) yeni 4.5 kuralına yanlışlıkla "misafiri ev sahibine gönderiyor"
  diye takılıyordu → doğrulanmış erken giriş akışının iki pini kırmızıydı. Birinci kişi danışması (I'll / we'll / let me … check with the host;
  "Ich werde bei Ihrem Gastgeber nachfragen") artık yönlendirme sayılmaz; öznesi misafir olan ("I recommend you ask your host") yine sayılır.
  Bekleme sözü zaten çıktı vetosunda tutulur — misafire giden değişmez.
- Ölçüm raporunun bayrak listesine `AI_PART_REWRITE_ENABLED` eklenmemişti (koşu kimliği yeni anahtarı görmüyordu) → eklendi.

**Kurucu kararlarının eski testlerle çakışması (bilinçli güncellendi):** QR "dar bant" testleri 09-11'deki "Bu konuda ev sahibiniz size
yardımcı olabilir" savuşturmasının GİTTİĞİNİ sabitliyordu → 4.5 ile artık tutuluyor (test yeni davranışı sabitliyor). "Ev sahibinin kararı"
testinin kontrol yarısında evcil hayvan cevabı gidiyordu → 4.4 (A) ile tutuluyor (test konusu teras yapıldı, evcil hayvan ayrı satırla
sabitlendi).

## 4. Kurucuya sorular

**4.11 — Okuyucu çağrısı düşünce bir kez yeniden denensin mi?** Bugün: okuyucu (ikinci yapay zekâ) o anda cevap veremezse (ağ / hız sınırı
/ sunucu hatası) bütün parçalar tutulur — güvenli ama 2. koşuda 7 gereksiz tutmanın sebebi buydu. Cevap modelinde 10-21'de onayladığınız
kural var: "geçici hatada bir kez hızlı yeniden dene, zaman aşımında deneme". Önerim aynı kuralı okuyucuya da uygulamak.
Örnek — "Site restoranı akşam kaça kadar açık?": **bugün** okuyucu o an düştüyse hiçbir şey gitmez, size e-posta; **öneri** ile ikinci
denemede okuyucu "doğru" derse "Site restoranı diğer aylarda 12:00–21:00 arasında açık." gider. Okuyucunun hükmü değişmez, yalnız düşen
çağrı bir kez tekrarlanır. Yapalım mı?

**4.12 — Parça kipinde modelin "genel güveni" doğrulanmış parçayı durdursun mu?** Bugün: model cevabının tamamına 0,75'in altında güven
verirse hiçbir şey gitmez. Parça kipinde düşük güvenin sebebi çoğu zaman CEVAPLANAMAYAN öteki soru. Örnek — "Bahçedeki bisikletlerin kilit
şifresi ne? Yakınlarda kuaför var mı?" (bilgi tabanında kuaför yok; model güveni 0,72): **bugün** hiçbir şey gitmez; **öneri**: kod +
okuyucunun doğruladığı "Bisiklet kilit şifresi 5190." gider, kuaför sorusu açık kalır + size tek "Misafir cevabınızı bekliyor" e-postası
(4.1 B). Almanca eşi aynı koşuda: "Das Fitnessstudio öffnet sonntags um 10:00 Uhr." (güven 0,70, süpermarket sorusu yüzünden) gitmedi. Öneri yalnız parça kipinde ve yalnız gidecek her parça doğrulanmışsa; risk / şikâyet / acil kapıları aynen önde. Yapalım mı?

**4.13 — "Ekstra yatağın gecelik ücreti ne kadar?" ödeme sorusu mu?** Anlama katmanı bunu "ödeme / fatura" sayıyor → her zaman sizde.
Bilgi tabanında "Ekstra yatak gecelik 300 TL" yazıyorsa ücret kuralı (`AI_KB_FEE_RULE_ENABLED`) açıkken cevap verilebilirdi. Fiyat sorusu
ev sahibinde mi kalsın (bugünkü), yoksa bilgi tabanında yazan HİZMET ücreti sorusu cevaplansın mı (iade / iptal / ödeme sorunları yine
sizde)?

## 5. Opus 5.5 derin kontrolü (bu dilimin kodu) → düzeltmeler

Opus 17 bulgu bildirdi (`docs/INCELEME-2026-10-23-aksam-opus-bilgi-tabani.md` ayrı; bu bölüm cevap yolunun bulguları). Her biri kodda ölçülerek
doğrulandı; hepsi "daha çok tutar" yönünde olduğu için uygulandı (müşteriye giden metni DEĞİŞTİRMEZ, yalnız gitmesi gerekmeyeni tutar). Her
düzeltme önce kırmızı test, sonra kod (düzeltme geri alınınca test yeniden kırmızı — ölçüldü).

| bulgu | sorun (örnek) | düzeltme |
|---|---|---|
| A1 | "If you need parking, ask your host" / "Merak ederseniz ev sahibinize sorabilirsiniz" "koşullu talimat" sayılıp GİDİYORDU | Koşul muafiyeti yalnız OLAY / ARIZA / ACİL koşulunda ("anahtarı kaybederseniz", "Wi-Fi çalışmazsa", "acil bir durumda") |
| A2 | "I'd recommend contacting your host", "Bu sorunuzu ev sahibinize iletebilirsiniz", "Your host would know", "N'hésitez pas à contacter votre hôte", "Le recomiendo contactar con su anfitrión", "Рекомендую связаться с хозяином", "Bitte setzen Sie sich mit Ihrem Gastgeber in Verbindung" yakalanmıyordu | 20 yeni kalıp (ulaç, mastar, "host'a / mülk sahibi / site yöneticisi") |
| A3 | Cümlenin başka yan cümlesindeki telefon ("Resepsiyon: 0212…, otopark için ev sahibinize sorabilirsiniz") yönlendirmeyi kurtarıyordu | Telefon / e-posta muafiyeti yalnız yönlendirmenin KENDİ yan cümlesinde |
| A4 | "Please text your host when you arrive" (varış talimatı) yönlendirme sayılabiliyordu | Varış / giriş talimatı muaf (kontrol testi) |
| A5 | "…ev sahibinize sorabilirsiniz, taksi aramanıza gerek yok" — olumsuzluk başka fiile aitken yönlendirme kalkıyordu | Olumsuzluk ev sahibine bağlı aranır ("ev sahibinize sormanıza gerek yok") |
| A6 | Madde düzenli cevapta başka satırdaki koşul / telefon yönlendirmeyi kurtarıyordu | Satır sonu cümle sınırı (bu düzeltmenin ilk hâli 50.000 boşlukta 3,3 sn sürüyordu — ölçüldü, doğrusala indirildi, süre pini eklendi) |
| E1 | Bilgi tabanı "Havuz şu an kapalı. Havuz havluları dolaptadır." iken "Havuz açık." parçası DOĞRULANIYORDU (iki cümle birleşince "kapalı havuz" sıfat sanılıyordu) | Yerler arasına cümle ayracı; "Havuz şu an kapalı spor salonu açık" gibi virgülsüz yazımda da yüklem okunur ("Sitenin kapalı yüzme havuzu açıktır" sıfat kalır) |
| B4 | Bilgi tabanı "ücretsiz kabul" derken model "Maalesef kabul edilmiyor" ya da "gecelik 200 TL ile getirebilirsiniz" yazarsa GİDİYORDU | "Ücretsiz kabul" yolunda cevabın evcil hayvan cümlesi de okunur: olumsuzluk / koşul / rakam / ücret → tutulur (kanal + QR) |
| C1 | İmzaya telefon yazılmışsa (Ayarlar ekranı bunu öneriyor) Airbnb ön sorusu cevabı telefonla gidiyordu — 4.5'in yasakladığı durum | İmzada iletişim değeri varken Airbnb onaysız konuşmada cevap da kapanış nezaketi de gitmez (`signature_offplatform_contact`) → **soru 4.14** |
| D1 | Dosyadan bilgi tabanı: "The key is under the flower pot", "La clé est sous le paillasson", "Ключ под ковриком" Genel'e (aday misafire açık) düşüyordu; uzun paragrafta kod öteki parçada kalınca da; "Network / Password" Wi-Fi değil Genel | Anahtar / kilit dört dilde, erişim kararı paragraf düzeyinde, Wi-Fi ağı / şifresi Wi-Fi'ye (rezervasyon öncesi kapalı) |
| G1 | Teşhis betiği "hiçbir şey yazmaz" diyordu, OAuth token yenilemesi yazabilir | Yorum düzeltildi |

Açık kalan küçükler (müşteriye giden metni değiştirmez, sonraki tur): **C2** kısmi gönderim turunda "Misafir cevabınızı bekliyor" e-postası
o an gönderilemezse yeniden denenmiyor (panelde görünür; güvenli yön) · **F1** parça yeniden yazma ikinci bir model çağrısı ama günlük kotaya
sayılmıyor, okuyucunun iki çağrısı maliyet ölçümüne girmiyor.

**4.14 — İmzada telefon numarası varken Airbnb ön sorusuna cevap:** Ayarlar ekranı imzaya "📞 +90 5XX…" yazmayı öneriyor; Airbnb rezervasyon
onayından önce iletişim bilgisini engeller (4.5'te "rezervasyondan önce yazamaz" dediniz). **Şimdi (bu turda kodda):** imzada telefon /
e-posta / bağlantı varsa onaysız konuşmada cevap hiç gitmez, size kalır. Örnek — "Otopark var mı?" (bilgi tabanı "Ücretsiz otopark var",
imza "Sevgiler, Ali / 📞 +90 532 …"): **şimdi** hiçbir şey gitmez. **Öneri:** onaysız konuşmada imzanın telefon satırı çıkarılıp cevap
gitsin: "Evet, ücretsiz otopark var.\n\nSevgiler, Ali". Onaylı konaklamada imza bugünkü gibi tam gider. Telefon satırını çıkarıp göndereyim
mi, yoksa tutmaya devam mı?
