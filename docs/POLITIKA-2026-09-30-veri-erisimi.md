# Müşteri verisine erişim politikası — 2026-09-30 (K16)

Kurucu kararı (09-30, K16): müşteri verisine erişimin varsayılan yolu **uygulamanın kontrollü dışa aktarımı** ve **salt-okunur
destek görünümüdür**. Doğrudan veritabanı / Railway erişimi yalnız iki durumda ve ayrı kurallarla: **yetkili teknik yedek** ve
**olay incelemesi**. Bu belge bir kural kaydıdır; hukuki metin (avukat onayı gerektiren müşteri bilgilendirmesi, K13) DEĞİLDİR.

## 1. Varsayılan yol — uygulama içinden

| Amaç | Yol | Kural (kodda zorlanır) |
|---|---|---|
| Destek talebinde hesabı görmek | Operatör bürünmesi (destek görünümü) | Salt okunur (hiçbir yazma), en çok 2 saat, başlangıç kaydı zorunlu, QR sohbeti açılamaz / cihaz bağlanamaz (K8, 09-28 / 09-30) |
| Müşteri verisini dışa aktarmak | Operatör dışa aktarımı | Yalnız kendi operatör hesabından (bürünmede 403), 2FA, **amaç zorunlu** (kapalı küme) + isteğe bağlı talep no, kayıt İNDİRMEDEN ÖNCE yazılır (yazılamazsa veri çıkmaz) |
| Müşterinin kendi verisi | Hesap sahibinin KVKK dışa aktarımı | Uygulama içi, müşterinin kendisi |
| Misafirin QR ekranını görmek | "Misafirin gördüğü ekran" önizlemesi (K14) | Yalnız görüntüleme: gönderim / cihaz bağlama / okundu değişikliği yok |

Bu yollar uygulamanın kayıt (denetim izi), yetki ve sır ayıklama katmanlarından geçer. Airbnb güvenlik incelemesinde "en az yetki"
ve "iz sürülebilirlik" bu yolla savunulur.

## 2. Doğrudan veritabanı erişimi — yalnız iki durum

### 2a. Yetkili teknik yedek
- Ne zaman: migration içeren yayından ÖNCE (depo kuralı: taze `pg_dump` + açık onay), geri yükleme provası, planlı duraklatma.
- Kim: kurucu (ya da kurucunun yazılı olarak yetkilendirdiği kişi). Yapay zekâ ajanları bağlantı dizesini / anahtarı GÖRMEZ, sohbete
  yapıştırılmaz.
- Nasıl: yedek betiği (`scripts/`) ile; dosya şifreli / erişimi kısıtlı yerde, **şifreleme anahtarından AYRI** saklanır; özet
  (SHA256) ve geri yükleme provasının ASSERT satırları kaydedilir.
- Yasak: üretim yedeğini yerel geliştirme veritabanına yüklemek (misafir adı / telefonu / mesajı taşır — depo kuralı), paylaşılan
  sürücülere koymak, e-postayla göndermek.

### 2b. Olay incelemesi
- Ne zaman: güvenlik olayı, veri bozulması, uygulamanın kendi araçlarıyla teşhis edilemeyen arıza.
- Önce: yazılı amaç (ne araştırılıyor, hangi kiracı / tablo), mümkünse uygulama içi teşhis araçları (Operasyon Teşhisi, salt-okuma
  betikleri — ör. `scripts/diagnose-hospitable-tokens.ts`).
- Sorgu: **salt-okunur işlem** (`SET TRANSACTION READ ONLY` + doğrulama; Set B dışa aktarımıyla aynı kapı), yalnız gereken alanlar,
  sonuçta kişisel veri yerel makinede kalıcı saklanmaz.
- Kayıt: olay kaydına tarih, kişi, amaç, çalıştırılan sorgunun özeti ve sonuç yazılır. Veri DEĞİŞTİREN bir düzeltme gerekiyorsa
  önce taze yedek + ayrı onay; mümkünse betik uygulama koduyla (testli) yazılır, elle `UPDATE` yapılmaz.

## 3. Hiçbir durumda
- Merak / analiz / "hızlıca bakayım" amaçlı doğrudan sorgu.
- Bağlantı dizesi (`DATABASE_URL`), `ENCRYPTION_KEY`, `AUTH_SECRET` gibi sırların sohbete, belgeye, depoya yazılması.
- Kiracılar arası veri birleştirme (bir müşterinin verisini başka müşterinin işi için kullanmak).

## 4. Durum
Bu belge kuralı kaydeder; kodda zaten zorlanan kısımlar (§1) canlıdadır. §2'nin süreç kısmı (olay kaydı biçimi, yedek saklama yeri)
kurucunun işletme sürecidir — kodla zorlanmaz. Müşteriye yönelik bilgilendirme metni (K13) avukat onayı bekler.
