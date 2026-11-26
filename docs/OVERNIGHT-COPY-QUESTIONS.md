# Gece Metin Turu — Sorular ve Durum (2026-07-30/31)

> Codex talimatlı gece kopyası inceleme turu. 4-ajan paneli (Türkçe UX yazarı ·
> ürün doğruluk denetçisi · şüpheci kullanıcı · mobil/erişilebilirlik denetçisi).
> EŞİK GÜNCELLEMESİ (kullanıcı, 00:0x Ist canlı mesajı): oybirliği ŞART DEĞİL —
> 4 panelistten en az 3 ONAY + ana ajanın kendi onayı yeterli. Push YALNIZ final
> turda, en fazla 1 kez. Hukuk/fiyat/güvenlik-vaadi metinleri her durumda sabah
> onayı bekler.

## DURUM

- [x] Tur 1 (BİTTİ, 23:05-00:00 Ist): Panel çekirdeği — 4 öneri panele sunuldu; 2'si oybirliğiyle UYGULANDI (dashboard boş-durum açıklaması + Mesajları çek hata metinleri), 2'si (Ö2+Ö3, 3'er ONAY) önce oybirliği kuralıyla düşmüşken kullanıcının canlı eşik güncellemesiyle (3/4 + ana ajan) UYGULANDI — toplam 4/4 öneri uygulandı
- KADANS GÜNCELLEMESİ (kullanıcı, ~00:15 Ist): turlar artık HER 30 DAKİKADA (:07 ve :37).
  Dilimler inceltildi; her tur TEK dilim alır, sırayla:
- [x] Tur 2 (BİTTİ, ~01:15 Ist): Ayarlar — AI ve Otomasyon. 4 öneri → 4'ü de eşiği geçti, UYGULANDI: (P1) sayfa başlığı açıklaması rol-nötr revizeyle "İşletme, otomasyon ve hesap ayarlarınızı yönetin." (doğruluk denetçisi Faturalandırma'nın owner-only olduğunu kanıtladı, 3 panelist revizeyi ayrıca teyit etti) · (P2, 3/1) "0 ile 72 arasında bir saat değeri girin" · (P3, 4/4) üç toggle tooltip'inden iç env adı (AUTO_REPLY_ENABLED) çıktı, da/de uyumu düzeltildi · (P4, 3/1) iki noktasız "Kaydedilemedi" noktalandı. İtirazlar (şüpheci): P2 "aralık zaten yazıyor", P4 "tek form görüyorum, farkı fark etmem" — kayıtlı.
- [ ] Tur 3: Ayarlar — Bağlantılar + Genel (Hospitable kartı, takvim akışı gizliliği, saat dilimi, işletme bilgileri)
- [ ] Tur 4: Ayarlar — Hesap ve Güvenlik (şifre değiştirme, e-posta; 2FA kartı HARİÇ — bugün elden geçti) [Faturalandırma metinleri = fiyat alanı → yalnız QUESTIONS önerisi]
- [ ] Tur 5: Mülk detayı + mülk formu + tedarik profili + takvim kaynakları kartı
- [ ] Tur 6: Takvim + Rezervasyonlar/İptaller + rezervasyon içe aktarma
- [ ] Tur 7: Raporlar
- [ ] Tur 8: Gönderilenler + /sent/queue
- [ ] Tur 9: Bilgi Tabanı + Şablonlar
- [ ] Tur 10: Misafir Sohbetleri (host yüzü) + QR ayar kartları
- [ ] Tur 11: Operatör/admin ekranları (müşteri yönetimi, lead CRM, reset-2fa formu)
- Dilimler biterse: yeni inceleme YOK, boş tur notu.
- [ ] FİNAL (06:00-11:00 Ist arası ilk tur): yeni inceleme YOK — diff doğrulama + full gates + TEK push + CI izleme + cron sil

KAPSAM DIŞI (bu gece): landing, kayıt, giriş, 2FA, hesap silme — 07-30 gündüz
kullanıcıyla birlikte elden geçirildi; "önceki metinleri sebepsiz değiştirme".
Hukuk sayfaları (gizlilik/koşullar/mesafeli satış/ön bilgilendirme) HER ZAMAN dışı.

## SABAH ONAYI BEKLEYEN SORULAR

(metin sorusu henüz yok)

## GÜNDÜZE NOT — METİN DIŞI (kullanıcı gece iletti, 2026-07-31 ~01:30 Ist)

- **GPT-5.6 Luna/Terra fiyat indirimi** (Luna $0.2/$1.2 −%80, Terra $2/$12 −%20;
  1.05M context, Şub-2026 cutoff). Kullanıcı geçiş istiyor; ana ajan önerisi
  KADEMELİ: pinli karar gereği (model değişimi = hot-path rekalibrasyon, yalnız
  arıza+A/B) önce DEĞERLENDİRME — (1) Luna'yı GLM-gölge deseniyle karar-yetkisiz
  gölge sınıflandırıcı olarak koştur (OpenAI zaten DPA'lı alt-işleyen → yeni
  hukuk işi YOK), (2) redakte gerçek mesajlar + golden set ile offline replay
  (intent/riskType/confidence kıyası), (3) uyum yüksekse A/B'li geçiş + birkaç
  gün oto-yanıt oranı izleme. Aday: LUNA (maliyet profili bizim iş yükü);
  Terra muhtemelen mevcut gpt-5.1'den pahalı. Bu bir GÜNDÜZ projesi — gece
  turunda hiçbir model/kod değişikliği yapılmadı.
  → **ADIM (1) 07-31 sabah UYGULANDI:** gölge sınıflandırıcı GLM/Akash'tan
  `gpt-5.6-luna`'ya çevrildi (kod+test; Railway env'i kullanıcı girecek).
  Detay ve üç yapısal düzeltme CLAUDE.md'de. Adım (2) offline replay ve adım (3)
  A/B hâlâ AÇIK.

## REDDEDİLEN ÖNERİLER (panel itirazı — uygulanmadı)

(yok — Tur 1'in iki 3-ONAY'lı maddesi kullanıcının eşik güncellemesiyle uygulandı;
şüpheci kullanıcının itiraz gerekçeleri kayıt için: Ö2 "gözle görülmez fark",
Ö3 "etiket zaten önerinin üstünde". İkisi de zarar değil düşük-kazanç itirazıydı.)

## SONRAKİ TURLARA DEVREDİLEN NOTLAR

- UX yazarı (T2): üç tooltip'te terim ikiliği sürüyor ("Güvenlik ana şalteri" ×1 vs "Ana şalter" ×2) — tek terime sabitleme ayrı bir öneri olarak değerlendirilebilir.
- UX yazarı (T2): dilim dışı iki noktasız fallback daha var (bulk-times-form.tsx:50 = Tur 3 Ayarlar-Genel dilimi, kb-manager.tsx:257 = Tur 9 Bilgi Tabanı dilimi) — kendi dilimlerinde panele götürülebilir.
- Mobil (T1): task-board sonuç satırında ikon hizalama iyileştirmesi (shrink-0 + items-start) — CSS değişikliği, gece kapsamı DIŞI, gündüze not.

## ESKİ TUR 2 NOTU

- UX yazarı bulgusu: property-form.tsx:145 "İç notlar, özel talimatlar..." üç-nokta
  tipografisi — mülk ekranları Tur 2 kapsamında; Ö2 emsali yeni eşikle geçtiği
  için bu da panele götürülebilir.
