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

## 6. Opus ikinci dilim kontrolü (10-28) + tedarik zinciri kapısı

**Opus R1–R5 + R9 (ev sahibine yönlendirme yüklemi, `ai/absence.ts`)** — ilk düzeltme turunun açtığı gerilemeler, hepsi kodda + testli
(her biri düzeltmesiz kırmızı, mutasyon 15/15 + 3/3; 52 cümlelik ölçüm 52/52):

| bulgu | önce | şimdi |
|---|---|---|
| R1 (P1) | "For parking, please contact your host before arrival." / "Otopark için gelmeden önce ev sahibinize yazabilirsiniz." **gidiyordu** (varış sözcüğü muafiyet sanılıyordu) | konulu (için / hakkında / about / for the X / whether) cümle varış muafiyeti alamaz → tutulur; konusuz varış talimatı ("Please text your host when you arrive") gider |
| R2 (P1) | "Alarm şifresini öğrenmek isterseniz ev sahibinize sorabilirsiniz." / "If you need the alarm code, please ask your host." / "çalışma saatleri" **gidiyordu** (konu adı olay sanılıyordu) | olay ADI değil olay YÜKLEMİ: "alarm çalarsa / goes off", "yangın çıkarsa", "acil durum", "çalışmıyorsa"; öğrenmek / know koşulu bilgi koşulu → tutulur |
| R3 (P2, gereksiz tutma) | "Herhangi bir sorun olursa ev sahibinizi arayın." / "If the power goes out, contact your host." / "Wi-Fi çalışmazsa ev sahibinizi arayın." **tutuluyordu** | gerçek olay talimatı gider (kurucu 4.5'in "anahtarı kaybederseniz" sınıfı) |
| R4 (P2, gereksiz tutma) | "Ev sahibinize şu numaradan ulaşabilirsiniz:\n0532 …" / "You can call your host, the number is +90 …" **tutuluyordu** | istenen telefonu veren konusuz cümle gider; konulu cümlede değer yine kendi yan cümlesinde olmalı |
| R5 | satır sonu işlemesi 50.000 satır sonunda 10,5 sn (karesel) | satır satır, 3 ms; süre pini eklendi |
| R9 | "Of course" Türkçe koşul eki (-rse) sanılıyordu | koşul eki ses uyumuyla (olursa / verirse evet, course hayır) |

**Tedarik zinciri kapısı (10-28, tam kapıda kırmızı çıktı — bizim kodumuz değil, yeni yayımlanan danışmalar):**
- nodemailer: üç orta düzey adres ayrıştırıcı açığı (GHSA-8c8m / GHSA-m943 / GHSA-85x2) → **10.0.13 → 10.1.7** (ana sürüm aynı; e-posta yolunun
  113 test dosyası yeşil). Railway kapalı olduğu için canlı e-posta denemesi açılışta sizinle.
- zod: GHSA-mrhx-c7xc-m3w5 (high, "kısıtlı büyük koleksiyonu doğrularken bellek tükenmesi"). Düzeltme yalnız zod 4.6.6+'da, 3.x için yama yok.
  **Ölçüldü: bizde ulaşılamaz** — dışarıdan gelen bütün istek gövdeleri zod'a girmeden 64 KB'ta kesiliyor; rota dışında zod yalnız kendi
  modelimizin sınırlı çıktısında ve tek e-posta dizesinde. Gerekçeli triaj kaydı açıldı, **2026-12-31'de dolar** (kapı o gün yeniden kırmızı
  olur, bakılmaya zorlar).

**4.15 — zod 3 → 4 geçişi ne zaman?** Bugün: güvenli (ulaşılamaz), kayıt 31 Aralık'ta doluyor. zod 4 ana sürüm: zod 10 dosyada kullanılıyor
(6 rota + ortak `validators.ts`, `zod-tr.ts` hata metinleri, kalite denetçisi, e-posta kimliği — ölçüldü) ve Anthropic SDK'nın zod 3 bağımlılığı
birlikte düşünülmeli; iş sanıldığından küçük. Önerim: Railway açılışından ÖNCE ayrı, testli bir dilim olarak
yapmak (müşteriye giden metin değişmez; yalnız hata mesajı biçimleri — onlar da `zod-tr.ts` tek kaynaktan, pinli). Yapalım mı, yoksa
açılıştan sonraya mı?

## 7. Kurucu kararları §7 (10-28) — yapılanlar, cevaplar, açık kalanlar

Kararların aynen metni: `docs/KURUCU-KARARLARI-2026-10-28-bilgi-tabani-7.md`.

### 7.1 Kodda (bu dilim; Railway kapalı → canlıya etkisi yok)

| karar | ne yapıldı | nasıl sınandı |
|---|---|---|
| 7-A (2) şablon | Bilgi tabanı sayfasından değil, `/api/kb/template` ucundan boş doldurulabilir şablon (Türkçe / İngilizce): "Giriş:", "Wi-Fi:", "Otopark:", "Çöp:", "Ev Kuralları:", "Temizlik:", "Konum:", "Yerel Tavsiye:", "Genel:" başlıkları + "____" boşlukları | boş şablon yüklenirse HİÇ taslak çıkmaz (yer tutucu atlanır); doldurulmuş şablon doğru kategorilere düşer (Wi-Fi → wifi, Giriş → giriş talimatı, Otopark, Ev Kuralları) |
| 7-A (3) dışa aktar | `/api/kb/export` + bilgi tabanı sayfasında **"Dışa aktar"** düğmesi: daire başına "# Daire adı", altında "## Başlık" + kendi cümleleriniz, kelimesi kelimesine | yalnız kendi işletmeniz (başka işletmenin dairesi 404), yalnız etkin kalemler, saatte 10, her indirme denetim kaydına yazılır; **dışa aktarılan dosya geri yüklenince aynı taslaklar çıkar** (gidiş-dönüş testi) |
| 7-A "deneme sürümünde olmasın" | iki özellik tek kapıdan: **deneme sürümünde ve etkin paketi olmayan hesapta kapalı**, destek görünümünde (bürünme) dışa aktarma kapalı; düğme kullanılamıyorken hiç görünmez | deneme hesabı 403 + "Bu özellik deneme sürümünde kullanılamaz; bir paket seçtiğinizde açılır.", ücretli hesap 200, personel 403 |
| 7-C | tasarımda düğme adı **"Böyle kalsın" → "Vazgeç"** | tasarım belgesi §5 / §7-C ve Opus inceleme belgesi güncellendi (kart henüz kodda değil — aşağıda) |

**Müşteriye giden yeni metinler (iki cümle, ikisi de yalnız ev sahibine):** "Bu özellik deneme sürümünde kullanılamaz; bir paket seçtiğinizde
açılır." · "Bu özellik için etkin bir paket gerekir." — ikisi de sizin "deneme sürümünde olmasın" kararınızın doğrudan karşılığı; farklı bir
cümle isterseniz tek yerden (`billing/subscription.ts`) değişir.

### 7.2 "Dosya yükleyince metni kategoriye mi bölüyoruz, tek metin mi koyuyoruz?" (7-A sorunuz)

**Bölüyoruz, ama sizin cümlelerinize dokunmadan.** Adım adım:
1. Dosyanın metni çıkarılır (PDF / Word / metin), **paragraflara** ayrılır.
2. Başlıklar okunur ("Wi-Fi:", "Giriş", "# Lale 1" gibi). Başlık yoksa paragrafın kendi sözcüklerine bakılır (şifre / ağ → Wi-Fi; anahtar /
   kapı kodu / kutu → Giriş Talimatı; otopark; çöp; kurallar…).
3. Aynı konudaki paragraflar **tek taslak kalem** olur (ör. bütün Wi-Fi paragrafları bir "Wi-Fi" kalemi).
4. Kalemin içeriği **sizin yazdığınız cümlelerin aynısıdır** — yapay zekâ da kod da yeniden yazmaz, kısaltmaz, "düzeltmez". "____" gibi boş
   bırakılmış yerler atlanır.
5. Taslaklar **önce size gösterilir**; onaylamadığınız hiçbir şey bilgi tabanına girmez, misafire gitmez.

Neden tek parça değil: misafir "Wi-Fi şifresi ne?" diye sorduğunda arama motoru 20 sayfalık tek metin yerine yalnız Wi-Fi kalemini bulur —
cevap hem daha doğru hem daha ucuz. Neden yeniden yazmıyoruz: misafire gidecek bilginin TEK doğrusu sizin cümleniz (kurucu kuralı "model bilgi
yazamaz").

### 7.3 7-e — kalıcı gömme deposu "bizim için iyi mi, çok ücret gelir mi?"

**İyi, ve ücreti çok küçük.** Bugün bilgi tabanı parçalarının anlam vektörleri yalnız sunucu belleğinde duruyor; sunucu her yeniden
başladığında (her yayın) sıfırlanıyor ve yeniden başlattıktan sonraki ilk cevaplar yalnız sözcük aramasıyla veriliyor ("soğuk" — anlamla eşleşme
yok). Depo bunu kapatır: vektör bir kez üretilir, veritabanında kalır.

| | hesap | tutar |
|---|---|---|
| Vektör üretimi (text-embedding-3-small, 1 milyon belirteç ≈ 0,02 $) | 100 ev sahibi × 10 daire × 30 parça = 30.000 parça × ~200 belirteç ≈ 6 milyon belirteç | **≈ 0,12 $ — bir kez**; sonra yalnız değişen kalem |
| Depo olmadan | her yayında / yeniden başlatmada aynı 6 milyon belirteç yeniden | ≈ 0,12 $ her seferinde + ilk cevaplar anlamsız aramayla |
| Veritabanı yeri | 30.000 × 1.536 sayı × 4 bayt ≈ 184 MB | Railway depolama fiyatıyla ayda birkaç sent |
| Bugünkü sizin hesabınız (~10 daire) | ~300 parça | kuruşun altında |

Yani belirleyici olan para değil **kalite**: yayından sonraki ilk misafir sorularında anlamsal eşleşme kaybolmasın. Plan (onaylı, migration 87,
anahtar `KB_VECTOR_STORE_ENABLED` KAPALI doğar): tasarım belgesi §10.1 — yalnız yeni tablo, metin saklanmaz, kalem silinince vektör de gider,
başka işletmenin vektörü okunamaz. **Bir sonraki dilimde yazılacak** (bu dilim şablon / dışa aktarma ve Opus bulgularına gitti).

### 7.4 7-B, 7-D, 7-f, 7-g

- **7-B "evet sayılsın":** dosyadan gelen taslak onaylanınca normal kalem gibi plan sınırına sayılır; sınırı aşan taslak "paket sınırı" diye
  işaretlenir, onaylanamaz (tasarım §4.4). Yükleme ekranı bağlanırken uygulanacak; bugün yükleme ekranı yok.
- **7-D gönderim zamanı — test ettim, sonuç (araştırma + simülasyon: `docs/arastirma-2026-10-28/7d-gonderim-zamani.md`, 40 senaryo, makine
  okunur set + betik aynı klasörde; model koşusu YOK):**

  | | doğru | yanlış gönderim (kritik) | gereksiz tutma | modele kalan |
  |---|---|---|---|---|
  | A — sabit kural (24 saat + araya mesaj + konaklama) | 15 (+7 kabul edilebilir) | **5** | **8** | — |
  | C — katmanlı: önce kod, sonra anlama kayıtları, kalan belirsize küçük model | **30 / 30** (kodun karar verdiği) | **0** | 0 | 10 (%25) |

  A'nın yanlış gönderimleri: gece 23:40'ta "bu akşam havuz kaçta kapanıyor?" sorusuna cevap · çıkış saatinden sonra "anahtarı kutuya bırakın"
  · bilgi tabanı arada değişmişken eski saat · İngilizce misafire Türkçe metin · konusuz "Bu arada, 22:00'ye kadar açık.". A'nın gereksiz
  tuttukları: ertesi gün hâlâ geçerli soru, aynı soruyu yeniden soran misafir. **Önerim C** — süre bir eşik değil, üç soru: misafirin sorduğu
  AN geçti mi · konaklama hâlâ geçerli mi · misafir şu an uyuyor olabilir mi (gece + sessizse "07:30'da gönderilsin mi?"). Model metin YAZMAZ,
  yalnız dört davranıştan birini seçer (gönder / "Bu arada," ile gönder / düzenleyiciyi aç / gönderme); şüphede ve arızada düzenleyici açılır.
  **Dürüstlük notu:** C'nin kuralları bu seti görerek yazıldı → 30/30 iyimser; görmemiş biriyle yazılmış kör set + modelli ölçüm gerekiyor
  (≈ 0,05 $ luna / ≈ 0,80 $ gpt-5.1 — "sen direk test et" dediniz, bir sonraki oturumda kör setle birlikte koşacağım).
  **Sorular (belge §8, önce / sonra örnekli):** 8-1 C kabul mü · 8-2 bağlaç "Bu arada," mı · 8-3 gece kuralı 23:00–08:00 → 07:30 uygun mu ·
  8-4 üç sınır durumu (araya giren konu cevaplandıysa / sitemli tekrar / araya cevapsız başka istek) · 8-5 e-postadaki "Bunu gönder" düğmesi
  doğrudan göndermesin, paneli açsın mı (e-posta güvenlik tarayıcıları bağlantılara kendiliğinden tıklayabiliyor).
  "Bilgi tabanına kaydedeyim mi?" → hangi daire + **"Bütün daireler için kaydet"** + daire seçme kutuları — tasarıma eklendi; mesaj gönderilmese
  de sorulur. Eksik bilgi döngüsü ve ileride WhatsApp: not edildi (projenin sonuna doğru, ayrı karar).
- **7-f, 7-g:** onaylandı, not edildi.

### 7.5 Opus ikinci dilim kalanlarından düzeltilenler (müşteriye giden cevabı DAHA ÇOK tutar; gevşetme yok)

| bulgu | önce | şimdi |
|---|---|---|
| R16 | bilgi tabanında "Kediler ücretsiz kabul edilir." ya da "Evcil hayvanlar ücretsiz, köpekler hariç." yazıyorsa **köpekli misafire** "Evet, getirebilirsiniz" gidebiliyordu (kural "herkese ücretsiz" sanılıyordu) | tür adı ya da istisna (hariç / dışında / except / außer / sauf / excepto…) geçen kural genel "ücretsiz kabul" sayılmaz → cevap size kalır |
| R18 | "Can we bring our **puppy**?" — sözlükte olmayan hayvan sözcüğünde evcil hayvan kemeri hiç devreye girmiyordu; "Gecelik ücret 200 TL" gibi bilgi tabanında olmayan ücret gidebiliyordu | canlıda açık öğe kipinde kemer misafirin sözcüğüne değil **öğenin türüne** (evcil hayvan) bakar → tutulur |
| R21 | onaysız Airbnb konuşmasında **sizin kendi nezaket metninizde** telefon varsa ("Bize 0532 … numarasından ulaşabilirsiniz") nezaket cevabı gidiyordu (yalnız imza taranıyordu) | metnin tamamı taranır → gitmez (Airbnb platform dışı iletişim kuralı) |

### 7.6 Haiku dar incelemesi (10-28) → düzeltilenler (hepsi "daha çok tutar" ya da yalnız dosya biçimi)

| bulgu | önce | şimdi |
|---|---|---|
| "haricinde / harici / dışındaki" | "Evcil hayvanlar ücretsiz kabul edilir; tehlikeli ırklar **haricinde**." genel "ücretsiz" sayılıyordu (R16 yalnız "hariç / dışında"yı görüyordu) | ekli biçimler de koşul → cevap size kalır |
| anlama katmanı evcil hayvanı kaçırırsa | "Köpeğimizle gelebilir miyiz? Giriş kaçta?" → anlama yalnız giriş saatini çıkarırsa evcil hayvan kemeri HİÇ devreye girmiyordu; "Giriş 15:00. Evet, getirebilirsiniz; gecelik ücret 200 TL." gidebilirdi. Yardımcı hayvan ("service dog") da aynı | evcil hayvan öğesi yoksa misafirin mesajı yine okunur (QR'daki kuralla aynı) → tutulur. Öğe tutulduysa öteki sorular yine gider (4.3) |
| dışa aktar → yeniden yükle | içeriğin ilk satırı başlık gibiyse ("Wi-Fi bilgileri:", "ÖNEMLİ") dosya geri yüklenince "## Wi-Fi" yazısı içeriğe giriyor, kalem ikiye bölünüyordu; 58–60 karakterlik / virgülle biten / saatli başlıkta da aynı | dosya geri yüklenince içerik birebir aynı, "##" içeriğe girmez (başlık uygun değilse kategori adı yazılır — içe aktarıcının kendi kuralıyla sınanır) |
| onay bekleyen taslak | dışa aktarma yalnız "etkin" bakıyordu; onay bekleyen taslak (bugün üreten yol yok) dosyaya girecekti | yalnız yapay zekânın okuduğu (eski + onaylı) kalemler |

