# Host Copilot / Host Command Center — kurucu gereksinimleri ve uygulama planı (09-25)

> **Durum:** KAYIT + PLAN. UYGULANMADI.
> **Kaynak:** kurucunun 09-25'te paylaştığı 13 görsel (hepsi bu belgede).
> **Kurucu:**
> - "Burası çok önemli bir geliştirme yeri; projenin en güçlü parçalarından biri olabilir."
> - "Her şeyi bitirince bu sisteme bakarız." Sıra: açık işler kapanır, sonra §14'teki plan.
>
> Mevcut tasarımın devamıdır, `docs/MESAJLASMA-CEKIRDEGI-V2-2026-09-25.md` içinde (aşağıda **MÇ §x**):
> - Host Karar Motoru (MÇ §3);
> - eylem makbuzu `claimedActions` (MÇ §4);
> - Konuşma Anlama Durumu (MÇ §2).
>
> Yalın "§x" bu belgenin kendi bölümüdür.
>
> Yol planındaki yeri: ürün fazları **V3 Actions + Tasks** ve **V8 Ask Lixus → Action** (CLAUDE.md "Yol planı").

## 1. Amaç
- Ayrı bir "panel" değil, **Host Copilot / Host Command Center**. Ev sahibi nerede olursa olsun AI ile:
  - doğal dille konuşur;
  - ses kaydı atar;
  - karar verir;
  - taslak ürettirir;
  - gerektiğinde tek dokunuşla onaylar.
- **İlk sürüm:** ev sahibi zorla web sitesine sokulmaz. **WhatsApp + hafif web ekranı** hibriti.
- **Kurucu (görsel 7):** "Burada artık host sistemle doğal dille çalışıyor. Bu, panel butonlarından çok daha ileri bir
  ürün."
- **Kurucu (görsel 13):** "Yani sadece AI taslak onayı değil, doğal dil üzerinden bir **operations control plane**."

## 2. Akış (görsel 2)
1. Misafir mesajı gelir.
2. AI mesajı anlar.
3. Kendi başına çözebilir mi?
   - **Evet:** çözer; gerekiyorsa cevaplar.
   - **Hayır:** bir **Host Decision** (karar isteği) oluşturur.
4. Karar isteği ev sahibine bir kanaldan (ilk sürümde WhatsApp) gider.
5. Ev sahibi düğmeye basar, yazı yazar ya da ses kaydı yollar.
6. AI ev sahibinin talimatını anlar.
7. AI taslak ya da yapılandırılmış karar (structured decision) oluşturur.
8. Ev sahibi onaylar.
9. **REVALIDATE:** koşullar gönderimden hemen önce yeniden kontrol edilir.
10. Cevap misafire gider.

## 3. Karar kartı (görsel 1 ve 3)
- **AI'nin karar öncesi sorduğu sorular (örnek: uzatma):**
  - Rezervasyon ne zaman bitiyor?
  - Sonraki gece booking var mı?
  - Temizlikçi görevi var mı?
  - Rezervasyon uzatılabilir mi?
  - Ev sahibinin mevcut uzatma politikası ne?
  - Fiyat / politika nereden geliyor?
  - Başka operasyonel çakışma var mı?
- **Kart içeriği (örnek 1 — uzatma):**
  - Başlık: "Konaklama uzatma kararı gerekiyor".
  - Misafirin sözü: "Bir gece daha kalsak olur mu?"
  - AI yorumu: +1 gece uzatma talebi.
  - Doğrulanan durum:
    - mevcut çıkış: 26 Eylül;
    - 26→27 Eylül gecesi: boş;
    - sonraki rezervasyon: 27 Eylül;
    - temizlik: 26 Eylül 11:30 planlı;
    - otomatik uzatma kuralı: tanımlı değil.
  - Neden size geldi: "Operasyonel olarak mümkün görünüyor ancak bu durum için host politika kararı yok."
  - AI önerisi: "Uzatma operasyonel olarak mümkün görünüyor. Mevcut fiyat/politika kaynağı üzerinden devam edilebilir."
  - Seçenekler: **Onayla / Reddet / Başka tarih-saat / Özel talimat**.
- **Kart içeriği (örnek 2 — geç çıkış):**
  - Başlık: "Late checkout kararı gerekiyor".
  - Misafir yarın 13:00'e kadar kalmak istiyor.
  - Normal çıkış: 11:00.
  - Sonraki rezervasyon: 17:00 giriş.
  - Temizlik: 14:00.
  - Otomatik kural bulunamadı.

## 4. Ev sahibinin AI ile özel sohbeti (görsel 6–7)
- Ev sahibinin GuestOps AI ile **kendi özel konuşması** olur. Misafir sohbetlerinden ayrı bir yerdir.
- Örnek:
  - Ev sahibi: "Bugün cevap bekleyen ne var?"
  - AI: "2 karar bekliyor: 1. Daire 3 — 12:00 erken giriş · 2. Daire 8 — +1 gece uzatma."
  - Ev sahibi: "İlkine izin ver. İkincisi için yarın rezervasyon var mı?"
  - AI **gerçek takvime bakar**: "Daire 8'de yarın rezervasyon yok. Sonraki rezervasyon 28 Eylül."
  - Ev sahibi (sesle): "O zaman bir gece uzatmasına izin ver, mevcut gecelik fiyat neyse onu kullan."
- Tek konuşmada birden çok karar verilebilir; AI her kararı kendi karar isteğine (kartına) bağlar.

## 5. Ses kaydı ve yapılandırılmış talimat (görsel 3–4)
- Örnek ses kaydı: "Olur, 1'e kadar kalsın ama temizlikçiye de haber ver. Misafire kısa yaz."
- 🚨 **AI bunu misafire gönderilecek mesaj SANMAZ.** Önce yapılandırılmış **HOST INSTRUCTION**'a dönüştürür:
  ```
  late_checkout:
    approved_until: 13:00
  cleaning:
    notify_cleaner: true
  reply_style:
    concise
  ```
- Sonra gereken **gerçek işleri** yapar:
  - Temizlikçiye **gerçekten bildirebiliyorsa** bildirir ve **makbuz (receipt)** alır.
  - Ardından misafir taslağını hazırlar: "Yarın saat 13:00'e kadar çıkış yapabilirsiniz."
- Ev sahibine şöyle döner: "Gönderilecek cevap: … [Gönder] [Değiştir]".
- Ev sahibi **Gönder**'e bastığında sistem koşulları **bir kez daha** kontrol eder, sonra gönderir.

## 6. Doğal dil → doğrudan yürütme YOK: iki onay kademesi (görsel 7–9)
- 🚨 **Doğal dilden doğrudan yürütme yapılmaz.** Bu özellikle şu alanlarda geçerlidir:
  - para;
  - rezervasyon değişikliği;
  - iptal.
- Örnek: ev sahibi "20 euro al, olur." dedi. AI'nin yorumu `fee = 20 EUR · approve = true` olabilir. Ama kritik işte
  ev sahibine kısa bir onay gösterilir:
  - "**Anladığım:** Geç çıkış: 13:00 · Ek ücret: €20 · Misafire bildirilecek. **[Onayla]**"
  - Böylece ses tanıma ya da dil anlama hatası (20 → 200) gerçek bir işleme dönüşmez.
- **Basit kararlarda iki aşama gereksizdir.** Sistem "12:00 erken giriş? Takvim uygun." gönderdi, ev sahibi
  **Onayla**'ya bastı. "Gerçekten onaylıyor musunuz?" diye sorulmaz: **Approve → revalidate → send**.
- **Kural:**
  - **Bilinen yapılandırılmış seçim → tek dokunuş.** Kartın kendi düğmesi, değerler zaten kartta: onayla → yeniden
    doğrula → gönder.
  - **Yeni serbest talimat → yorumla + önizleme + onay.** Serbest metin ya da ses yeni fiyat, yeni saat ya da yeni koşul
    veriyorsa yorum ev sahibine "Anladığım: …" diye gösterilir, onayı beklenir.

## 7. Karar türleri — ev sahibi yalnız cevap yazdırmaz (görsel 10)
- **Karşı teklif (COUNTER_OFFER):**
  - Ev sahibi (sesle): "Buna kibarca hayır de ama 12 yerine 11:30 önerebiliriz."
  - AI yorumu: `decision = COUNTER_OFFER · requested = 12:00 · offered = 11:30 · tone = polite`.
  - Taslak: "Saat 12:00 mümkün görünmüyor ancak 11:30 için yardımcı olabiliriz."
  - Ev sahibi onaylar.
- **Konuşmayı ev sahibi devralır:**
  - Ev sahibi: "Buna cevap verme, ben arayacağım."
  - Konuşmanın durumu: `AI_AUTOREPLY_DISABLED_FOR_THIS_TURN · owner = HOST`.
  - Yapay zekâ bu tur için otomatik cevap vermez; konu ev sahibinindir.
- Görselden çıkan karar türleri:
  - onayla;
  - reddet;
  - başka tarih-saat / karşı teklif;
  - özel talimat;
  - bu turu ev sahibi devralır.

## 8. Sesle bağlam ekleme → bilgi tabanı bakımı (görsel 11)
- AI bilmediği / doğrulayamadığı bir şeyi ev sahibine sorar: "Daire 4 için bebek yatağının mevcut olup olmadığını
  doğrulayamıyorum."
- Ev sahibi (sesle): "Var, depodaki katlanır yatağı kullanıyoruz. Bundan sonra bu daire için bunu bil."
- 🚨 **Bilgi tabanına KÖRLEMESİNE yazılmaz.** AI önce sorar: "Bunu Daire 4 için kalıcı bilgi olarak kaydedeyim mi?"
- Ev sahibi onaylarsa bilgi tabanına **yapılandırılmış** kalem eklenir.
- Böylece ev sahibi sohbeti **RAG / bilgi bakımı arayüzüne** de dönüşür. Kurucu: "Bu bayağı güçlü."

## 9. Ev sahibi mesajının üç türü karışmaz (görsel 12)
- Ev sahibi AI ile konuşurken sistem mesajın hangi tür olduğunu anlamalı:

  | Tür | Örnek | Etkisinin kapsamı |
  |---|---|---|
  | **Karar (Decision)** | "İzin ver." | YALNIZ mevcut isteğe (karar kartına) aittir |
  | **Talimat (Instruction)** | "Kısa ve sıcak yaz." | YALNIZ cevap üretimini etkiler |
  | **Bilgi güncellemesi (Knowledge update)** | "Dairede iki tane bebek yatağı var." | Kalıcı olabilir (onayla, §8) |

- **Kurucu:** "Bunların sonuçları farklı. AI bunları birbirine karıştırmamalı."
- Bu belgeden çıkan iki ek tür:
  - **Sorgu (Query):** "Bugün ne bekliyor?" — salt-okuma, hiçbir şey değiştirmez.
  - **Devralma (Takeover):** "Ben arayacağım" — bu tur için sahip ev sahibi.

## 10. Ev sahibi WhatsApp'ı = operasyon kumandası (görsel 13)
- Uzun vadede ev sahibinin sorabilecekleri:
  - "Bugün temizlikler ne durumda?" → sorgu (görevler).
  - "Saat 4'ten önce giriş isteyen var mı?" → sorgu (karar istekleri / erken giriş).
  - "Daire 3'ün son mesajını özetle." → sorgu (konuşma özeti).
  - "Bu misafire daha resmi cevap ver." → talimat.
  - "Bu misafirin late checkout'una izin ver." → karar.
  - "Daire 7'nin Wi-Fi şifresini değiştir." → **eylem**, ancak ileride gerçek bir araç varsa.
- Yani yalnız "AI taslak onayı" değil, doğal dil üzerinden bir **operations control plane**.

## 11. Mimari ilke — WhatsApp sistemin kendisi DEĞİL (görsel 4–5)
- **Karar mantığı ≠ WhatsApp.** WhatsApp yalnız ev sahibinin **arayüzü / kanalıdır**.
- **Gerçek kayıt backend'de yaşar:** `DecisionRequest` · `HostInstruction` · `Action` · `ActionReceipt` · `Draft` ·
  `Approval` · `FinalMessage`.
- Böylece WhatsApp yerine ya da yanına şunlar eklense de aynı sistem çalışır:
  - kendi mobil uygulama;
  - push bildirimi;
  - web;
  - Slack;
  - SMS.
- Ev sahibinin "kendisi" backend'dedir; WhatsApp onun en rahat kapısıdır.

## 12. Mevcut değişmezlerle bağ (uygulanırken korunacaklar)
- **Talimat ≠ mesaj:** ev sahibinin sesi/yazısı misafire ASLA doğrudan gitmez. Misafire yalnız şunlar gider:
  - koddan kurulan doğrulanmış metin;
  - ya da ev sahibinin onayladığı taslak.
- **Makbuzsuz iddia yok:** "temizlikçiye haber verdim" yalnız gerçek `ActionReceipt` varsa söylenir.
  - Yapılamayan eylem ev sahibine dürüstçe "yapılamadı" diye döner.
  - İlgili kurallar: `claimedActions` (MÇ §4) ve çıktı vetosu.
- **Bekleme sözü yok** (kurucu kararı): misafire "soruyorum / döneceğim" gitmez.
- **REVALIDATE = TOCTOU kapısı** (MÇ §3.2 adım 6):
  - rezervasyon iptali, geçmiş gün/saat, yeni çakışma → gönderim durur;
  - istekten sonra misafir yazdıysa işlem durur;
  - diğer önemli değişiklik → tazelenmiş kart.
- **Canlı olgular yalnız doğrulanmış araç sonucundan.** "AI gerçek takvime bakar" = müsaitlik motoru:
  - "Boş" yalnız kanıtla (her kapsama kaynağı taze); kanıt yoksa "bilinmiyor".
  - Ev sahibine giden metinde en güçlü ifade "bağlı takvimlerinizde boş"tur (`docs/MUSAITLIK-MOTORU-2026-09-24.md`).
  - Sorgu cevapları (temizlik durumu, bekleyen istekler, özet) veritabanından gelir; model uydurmaz. Kaynak ve zaman
    damgası gösterilir.
- 🚨 **"Mevcut gecelik fiyat" kaynağı bugün YOK:**
  - Sağlayıcıdan fiyat okunmuyor (`financials:read` yok).
  - `Reservation.totalAmount` bilinçli olarak okunmuyor.
  - Tek kaynak ev sahibinin girdiği gecelik aralık (V2 para etkisi) ve o bir ARALIK.
  - Fiyat kaynağı olmadan AI misafire tutar yazamaz: ev sahibine "fiyat kaynağı yok, tutarı yazın" der.
  - Tutar yalnız ev sahibinin onayladığı değerle gider (§6).
- **Para ve rezervasyon değişikliği:**
  - Model tutar üretmez.
  - Tutar yalnız ev sahibinin talimatından ya da kaydından gelir ve §6 önizlemesiyle onaylanır.
  - Ödeme yöntemi süzgeci geçerlidir; platform dışı ödeme talimatı gitmez.
- **Bilgi güncellemesi bugünkü bilgi tabanı kurallarından geçer:**
  - onay kapısı (`kb-review.ts`): `approved` yalnız ev sahibinin açık onayıyla;
  - sır kategorisi kapısı (Wi-Fi şifresi, kapı kodu);
  - talimat-ele-geçirme süzgeci;
  - sürüm/geçersizleştirme (`supersededById`);
  - Mülk Hafızası tazelemesi.
  - Değişmez 13: LLM metni kalıcı gerçek değildir. Kalem ev sahibinin onayladığı yapılandırılmış olgudur; kaynak
    (ev sahibi sohbeti / ses) ve zaman damgası taşır.
- **"Ben arayacağım" ile mevcut kilitler:**
  - Bugün "Sorunlu" durumu AI'yı KALICI durdurur; `autoReplyHoldUntil` ise bir kilittir.
  - Tur başına devralma yeni bir hâldir. Hangi olayla biteceği tasarımda netleşecek: ev sahibinin cevabı mı, sonraki
    misafir mesajı mı, süre mi?
- **Kanal bağımsızlığı:** V0 ilkeleriyle aynı. Çekirdek WhatsApp'a (ya da Hospitable'a) bağlanmaz. WhatsApp bir
  "host kanalı" adaptörüdür; misafir kanallarından ayrıdır.
- **Geç çıkış istisnası yapısal kaydedilir** (bugün kaydedilmiyor, MÇ §3.1). Onaylanan `approved_until` sonraki misafirin
  erken giriş kontrolünde görünür.
- **Temizlikçi bildirimi temizlikçi görünümü kuralından geçer** (`lib/tasks/staff-view.ts`): misafir adı/mesajı
  temizlikçiye gitmez.
- **Kod kapıları ev sahibi onayında da geçerli:**
  - ödeme yöntemi süzgeci;
  - para sözleri;
  - misafirin dili.

## 13. Uygulama öncesi karar / onay gerektirenler
- **WhatsApp Business:**
  - sağlayıcı: Meta Cloud API ya da bir BSP;
  - işletme doğrulaması;
  - şablon mesaj onayı;
  - 24 saat penceresi kuralları;
  - maliyet;
  - ev sahibinin açık rızası (opt-in).
- **Kimlik:**
  - WhatsApp numarası ↔ kullanıcı eşlemesi;
  - numara ele geçirilirse karar verilebilir → ek doğrulama gerekiyor mu? Para ve iptal kararları özellikle.
  - operatör/personel rolleri (`withManage` eşdeğeri).
- **Ses:**
  - döküm sağlayıcısı alt-işleyen listesine girer (KVKK / avukat);
  - ses dosyası ve dökümü için saklama/silme paritesi.
- **Migration'lar:** `DecisionRequest` (MÇ §3.3) + `HostInstruction` / `Action` / `ActionReceipt` / `Draft` / `Approval` /
  `FinalMessage`. Her biri taze `pg_dump` + açık onay ister.
- **Fiyat kaynağı:** uzatma ve geç çıkış ücreti için ev sahibinin kayıtlı kuralı mı, kanal fiyatı mı olacak? Bugün
  kanal fiyatı yok.
- **Otomatik gönderim sınırı:** ev sahibi onayı olmadan gönderim yok. v1'de özel talimatın otomatik gönderimi YOK (MÇ §3.6 madde 6).

## 14. Uygulama planı (öneri — her faz kurucu onayıyla başlar)
Her faz kendi bayrağıyla ve varsayılan KAPALI gelir. Sıra: önce kurucu org (iç kiracı), sonra küçük pilot. Her fazda:
- kırmızı-önce test + iki yönlü mutasyon + tam kapılar;
- kiracı izolasyonu davranışsal testi;
- migration varsa taze `pg_dump` + açık onay.

### Faz 0 — Tasarım ve onay paketi (kod yok, ~1 gün)
- **Veri modeli:**
  - `DecisionRequest` (MÇ §3.3);
  - `HostMessage`: kanal, tür = karar / talimat / bilgi / sorgu / devralma, döküm, dil;
  - `HostInstruction`: yapılandırılmış alanlar;
  - `Action` / `ActionReceipt`;
  - `Draft` / `Approval` / `FinalMessage`.
  - İlişkiler, durum makineleri ve migration listesi.
- **Güvenlik modeli:**
  - host kanalı kimliği, rol ve MFA eşdeğeri;
  - her kararın denetim kaydı;
  - kanal ele geçirilirse para ve iptal için ek doğrulama.
- **Kararlar kurucuya:**
  - WhatsApp sağlayıcısı;
  - ses sağlayıcısı (alt-işleyen);
  - fiyat kaynağı;
  - karar gecikirse misafire ne gider (MÇ §3.4, sabitlenmedi);
  - "ben arayacağım" hâlinin bitişi.
- **Çıktı:** onay paketi HAZIR (09-25) → `docs/ONAY-HOST-COPILOT-FAZ0-2026-09-25.md`. En üstte on karar (K1–K10), altında
  veri modeli, durum makinesi, yeniden doğrulama sözleşmesi, güvenlik ve test planı.

### Faz 1 — Karar kartı çekirdeği (web, kanalsız) = Host Karar Motoru v1
- `DecisionRequest` kaydı: erken giriş (bugünkü `needs_host` / `pending` durumları), geç çıkış, uzatma.
  - Olgular yalnız doğrulanmış kaynaklardan gelir: rezervasyon, müsaitlik motoru, temizlik görevleri, kurallar.
- Gelen kutusunda kart. Düğmeler:
  - Onayla;
  - Reddet;
  - Başka saat (karşı teklif);
  - Özel talimat (yazılı);
  - Ben ilgileneceğim (devralma).
- **Bilinen seçim tek dokunuş** (§6): onayla → yeniden doğrula → gönder.
  - CAS kilidi;
  - istekten sonra misafir yazdıysa dur;
  - olgular değiştiyse 409 + taze kart.
- Koddan kurulan metin (6 dil), idempotent anahtar (kart + sürüm), `aiAssisted`, denetim kaydı.
- Yeni istek eski kartı geçersiz kılar (`superseded`); "boş verin" isteği iptal eder.
- Onaylanan geç çıkış yapısal kaydedilir, sonraki misafirin erken giriş kontrolünde görünür.
- **Testler:**
  - TOCTOU;
  - çift tıklama;
  - kart geçersizleşmesi;
  - kiracı izolasyonu;
  - 6 dilde metin;
  - gönderim belirsizliği (`send_unverified`).

### Faz 2 — Serbest talimat → yapılandırılmış talimat + önizleme
- **Talimat yorumlayıcısı:** Structured Outputs, katı şema, yalnız sıkılaştırır.
  - Mesaj türü: karar / talimat / bilgi / sorgu / devralma (§9).
  - Alanlar: `approved_until`, `fee`, `offered`, `tone`, `reply_style`, `notify_cleaner`, …
- 🚨 **Para, saat ya da yeni koşul içeren her serbest talimat → "Anladığım: …" önizlemesi → onay** (§6).
  - Sayılar koddan doğrulanır: tutar ev sahibinin metninde harfiyen geçmeli; 20 ≠ 200.
- Karşı teklif ve devralma (tur başına kilit, bitiş olayı Faz 0 kararı).
- Talimat kapsamı: yalnız o cevabın üretimi (§9). Kalıcı üslup yalnız Ayarlar'dan.
- **Eval:**
  - kör host talimat bataryası (TR/EN, ses dökümü benzeri gürültülü metin dahil);
  - tür karışması oranı;
  - önizlemede düzeltilen yorum oranı.

### Faz 3 — Ev sahibi sohbeti (web) + sorgular (salt-okuma "control plane")
- Sohbet ekranı: "Bugün ne bekliyor?", "Temizlikler ne durumda?", "Saat 4'ten önce giriş isteyen var mı?", "Daire 3'ün
  son mesajını özetle."
- Cevaplar yalnız araç sonuçlarından gelir (veritabanı sorguları, müsaitlik motoru, görevler). Model yalnız cümle kurar.
  Her cevap kaynak ve zaman damgası taşır.
- Sohbetten karar vermek aynı Faz 1–2 yolundan geçer: kart, önizleme, yeniden doğrulama.
- Toplu karar: "İlkine izin ver, ikincisi için …" her karar kendi kartına bağlanır.
- **Test:** sorgu cevabında uydurma olgu yok (claim-support benzeri dayanak kontrolü).

### Faz 4 — Bilgi güncellemesi (bilgi tabanı bakımı)
- AI doğrulayamadığı bilgiyi ev sahibine sorar. Tetikleyiciler:
  - `missingInfo`;
  - "bilgim yok" itirafı;
  - karar kaydı.
- Ev sahibinin cevabı:
  - "Kalıcı kaydedeyim mi?" (§8) → onay → yapılandırılmış bilgi tabanı kalemi;
  - kaynak: ev sahibi sohbeti; onaylı; sürüm/geçersizleştirme; sır ve ele geçirme süzgeçleri.
- O cevabı bekleyen misafir sorusu yeniden aday olur (erken giriş `recheck` deseni).
- Sır kategorisi güncellemesi (Wi-Fi şifresi, kapı kodu) ayrı onay ister ve QR'a gitmez.

### Faz 5 — WhatsApp host kanalı (adaptör)
- Kanal adaptörü sözleşmesi + uyum kiti: aynı çekirdek, yeni kapı.
- Kapsam:
  - karar bildirimi (şablon);
  - etkileşimli düğmeler;
  - yazılı talimat;
  - sorgular.
- Numara ↔ kullanıcı eşlemesi ve doğrulama; açık rıza; 24 saat penceresi.
- Para ve iptal kararlarında ek doğrulama (Faz 0 kararı).

### Faz 6 — Ses
- Ses → döküm → Faz 2 yolu. **Ses her zaman serbest talimattır**, yani her zaman önizleme.
- Ses dosyası ve dökümü için saklama/silme paritesi (KVKK).

### Faz 7 — Gerçek eylemler + makbuz
- Eylemler:
  - temizlikçiye bildirim (temizlikçi görünümü kuralıyla);
  - görev oluşturma / güncelleme;
  - rezervasyon notu.
- Her eylemin `ActionReceipt`'i olur. `claimedActions` ile birleşir: makbuzsuz iddia misafire de ev sahibine de gitmez.
- Fiziksel/dış sistem eylemleri ("Wi-Fi şifresini değiştir") yalnız gerçek bir araç varsa yapılır.

### Faz 8 — Diğer kanallar
- Push, mobil uygulama, Slack, SMS: yalnız yeni adaptör; çekirdek değişmez.

### Başarı ölçütleri
- Karar süresi (misafir isteği → gönderim) ve karar başına ev sahibi dokunuşu.
- Önizlemede düzeltilen yorum oranı ve tür karışması oranı.
- Yeniden doğrulamanın durdurduğu gönderim sayısı.
- 🚨 Misafire giden yanlış olgu, makbuzsuz iddia ve onaysız tutar: **sıfır** (sert sınır).
