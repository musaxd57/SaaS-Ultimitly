# KVKK Taslak Metinleri — Lixus AI

> ⚠️ **BUNLAR TASLAKTIR. AVUKAT ONAYI OLMADAN YAYINA/İMZAYA KOYMA.**
> Ben (yazılım asistanı) avukat değilim. Bu metinler, bir KVKK/bilişim avukatına
> götürüp **kesinleştirmen için başlangıç noktasıdır** — avukatın işini ucuzlatır.
> `[KÖŞELİ PARANTEZ]` alanları şirketin kurulunca dolacak.

## 0) ÖNCE ŞİRKET
Bu metinlerin hepsi "veri sorumlusu" olarak **senin işletmeni** (ünvan, adres, MERSİS/
vergi no) ister. O yüzden **önce şahıs şirketi** kur, sonra bunları doldur.

---

## 1) AYDINLATMA METNİ — eklenecekler (mevcut `gizlilik` sayfasına)

**İşlenen misafir verileri (açıkça):** misafirin adı, Airbnb/Booking üzerinden gönderdiği
**mesaj içerikleri**, giriş/çıkış tarihleri ve (varsa) iletişim bilgileri. Bu verileri
**ev sahibi adına "veri işleyen" sıfatıyla** işleriz; kendi hesap/kullanım verilerinde
ise "veri sorumlusu"yuz.

**Alıcılar / alt-işleyenler (hizmet sağlayıcılar):**
| Sağlayıcı | Amaç | Konum |
|---|---|---|
| Hospitable | Airbnb/Booking kanal entegrasyonu | ABD/AB |
| OpenAI | Mesaj yanıtı üreten yapay zekâ | **ABD (yurt dışı)** |
| Resend | E-posta gönderimi | ABD |
| Railway | Sunucu/barındırma | AB/ABD |
| Paddle | Ödeme altyapısı (Merchant of Record) | ABD/İngiltere |

*(2026-07-13 düzeltme: ödeme sağlayıcı iyzico değil, canlıdaki Paddle. Kod-doğrulamalı
saklama süreleri + imha mekanizmaları için `docs/saklama-ve-imha-politikasi.md` esastır.)*

**Yurt dışı aktarım (en kritik cümle — avukat mekanizmayı seçince netleşir):**
> "Misafir mesajları, yanıt üretmek amacıyla OpenAI'a (ABD) aktarılır. Bu aktarım, KVKK
> m.9 kapsamında **[imzalanan standart sözleşme / açık rızanız]** esas alınarak yapılır.
> OpenAI, API üzerinden gönderilen veriyi **model eğitimi için kullanmaz.**"

---

## 2) AÇIK RIZA METNİ (yurt dışı aktarım için — avukat "açık rıza yolu" derse)

> "Airbnb/Booking üzerinden gelen misafir mesajlarımın, yapay zekâ ile yanıt üretilmesi
> amacıyla [LIXUS ÜNVAN] tarafından OpenAI (ABD) altyapısına aktarılmasına; bu kapsamda
> kişisel verilerimin KVKK m.9 uyarınca yurt dışına aktarılmasına açık rıza veriyorum.
> Rızamı dilediğim zaman geri çekebileceğimi biliyorum."
>
> ☐ Okudum, anladım, açık rıza veriyorum.

*(Not: misafir senin müşterin değil — bu rızayı pratikte toplayamazsın. Bu yüzden avukat
genelde "standart sözleşme" yolunu önerir; aşağı bak.)*

---

## 3) EV SAHİBİ (MÜŞTERİ) İLE VERİ İŞLEME SÖZLEŞMESİ — DPA iskeleti
*(Kullanım Koşulları'na ek madde ya da ayrı imzalı belge. Misafir verisinde ev sahibi
"veri sorumlusu", Lixus "veri işleyen".)*

1. **Konu/süre:** Lixus, ev sahibinin Airbnb/Booking misafir verisini yalnızca hizmet
   süresince ve ev sahibinin talimatları doğrultusunda işler.
2. **Amaçla sınırlılık:** Veri yalnızca misafir mesajlarını yanıtlamak/operasyon için işlenir.
3. **Gizlilik:** Erişen personel gizlilikle yükümlüdür.
4. **Güvenlik tedbirleri:** Şifreleme (token/2FA), erişim kontrolü, denetim kaydı (mevcut).
5. **Alt-işleyenler:** Hospitable, OpenAI, Resend, Railway, iyzico (yukarıdaki tablo);
   OpenAI'a yurt dışı aktarım açıkça belirtilir.
6. **İhlal bildirimi:** Bir veri ihlalinde ev sahibine gecikmeksizin bildirilir.
7. **İade/imha:** Sözleşme bitince veri silinir/iade edilir (saklama politikasına göre).
8. **Tarafların yükümlülüğü:** Ev sahibi, misafirlere aydınlatma yapmaktan sorumludur;
   Lixus işleyen olarak talimatla bağlıdır.

---

## 4) OPENAI YURT DIŞI AKTARIMI — bu "kağıt imzala" değil, SÜREÇ
- OpenAI'ın kendi **DPA**'sını çevrimiçi kabul et (OpenAI panelinden).
- KVKK **Standart Sözleşmesi**: KVKK Kurumu'nun **resmî hazır formu** vardır (serbest yazılmaz).
  Doldurup imzalarsın ve **5 iş günü içinde Kurul'a bildirirsin.** → **Avukat bu formu yönetir.**
- "API verisi eğitimde kullanılmaz" ayarını OpenAI hesabında doğrula ve belgele.

## 5) VERBİS — kağıt değil, ONLINE KAYIT
`verbis.kvkk.gov.tr` üzerinden kayıt. Ana faaliyetin sürekli kişisel veri işlemek olduğu
için **muhtemelen zorunlu.** Avukat "gerekli mi" diye teyit eder, sonra online kaydolursun.

---

## Avukata söyleyeceklerin (özet, 1 cümle)
> "B2B SaaS'ım var; müşterilerim (ev sahipleri) adına misafir mesajlarını işliyorum ve bu
> mesajları yanıt üretmek için **OpenAI'a (ABD) gönderiyorum.** Bana: (1) bu yurt dışı
> aktarım için KVKK Standart Sözleşmesi, (2) müşterilerimle DPA, (3) VERBİS kaydım gerekli
> mi, (4) aydınlatma + açık rıza metinlerim yeterli mi — bunları kurmanı istiyorum."
