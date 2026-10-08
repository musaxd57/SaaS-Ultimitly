# Sabah raporu — 2026-10-08 (Codex `15c8663` bulguları, gece döngüsü)

> Kurucu talimatı (10-07 gece): "1 saatte 1 … 4 turda bitirecek şekilde ve 5. turda tamamen yaptıklarının kontrolü". Onay gerektiren
> (müşteriye giden mesaj · görev üretimi · para / erişim anlamı) değişiklikler ana dala UYGULANMADI → hazır yama + Sabah Kararları 63–68.
> Ayrıntılı tablo (bulgu → doğrulama → düzeltme → regresyon testi): `docs/INCELEME-2026-10-07-codex-u16-u44.md`.

## 0. Kısaca

- **İtildi:** `claude/great-edison-3zqpZ` (tur 2 + 3 + 4 + belgeler; son commit bu raporun kendisi). Tam kapılar (tsc · lint · 13.220 test · build ·
  zafiyet kapısı) YEŞİL. CI: son yeşil koşu #1308; bu turun push'ları ardışık olduğu için ara koşular iptal edildi (eşzamanlılık), son
  push'un koşusu sonucu §2'de.
- **Railway kapalı** → canlıya bir şey gitmedi; geri açılınca dalın son yeşil commit'i gider (migration YOK bu turda).
- **Next.js 15.5.24 → 15.5.27:** gece yayımlanan iki danışma (GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p — SSG/ISR önbellek zehirlenmesi)
  zafiyet kapısını kırmızıya çevirdi; aynı küçük sürüm içinde yama, yalnız `next` + `@next/*`.
- **Mutasyon:** tur 2 19/19 · tur 3 + 4 44/44 (ilk koşuda yaşayan U37 için senkron bağlantı testi eklendi, sonra öldü).
- **Kararınızı bekleyen:** Sabah Kararları 63 (otopark tahsisi), 64 (görev tekilleştirme), 65 (Paddle tutarı), 66 (ödeme ↔ silme yarışı, ödeme
  tarafı), 67 (F06: doğrulanamayan oturumda sayfa), 68 (vaka kabulü katı ölçü). Hazır yamalar `docs/hazir-yamalar/*.patch` —
  `git apply <dosya>` + tam kapılar.

## 1. Ne düzeltildi (eski girdi → yanlış sonuç → yeni sonuç)

### Kimlik / oturum (gerçek PostgreSQL araya girme testleriyle)
- **U43:** parola değiştirme kodu doğrulandı → arada parola SIFIRLANDI → bekleyen istek devam etti → eskiden parola saldırganınki oldu ve yeni
  oturum verildi; şimdi reddedilir (sıfırlama bekleyen kodu da siler), parola sıfırlamanınki kalır, çerez yok. Çift tıklamada kaybeden yine 400.
- **U40:** 2FA açma / kapatma / kurtarma kodu, arada iptal edilen oturumla tamamlanamaz (yazma oturum sürümü koşullu).
- **U41:** hesap silme parola doğrulandıktan sonra sıfırlama olursa sürmez (silme işleminde sahip satırı kilitli + sürüm ön koşulu).
- **U42 (silme tarafı):** denetimle silme arasında aktifleşen abonelik → eskiden hesap + aktif abonelik silinirdi (Paddle faturalamaya devam);
  şimdi 409, hesap yerinde.
- **U44:** terk edilmiş kayıt süpürgesi aday seçildikten sonra doğrulanan hesabı silmez.
- **U13:** bürünmeden çıkış, arada iptal edilmiş operatör oturumunu yeni sürümle canlandırmaz.

### Misafir verisi / mesajlaşma
- **Y1:** kalıcı kuyrukta (bayrak kapalı) talep edilmiş ama gönderilmemiş satırın misafiri silinirse eskiden bellekteki özel metin gidiyordu;
  şimdi gönderimden hemen önce satır yeniden okunur, `[erased]` → iptal.
- **Y2:** tekrar konuşma temizliği okumadan sonra gelen özgün mesajı siliyordu; şimdi işlem içinde kilitli yeniden denetim, şüphede "inceleme".
- **Y3:** kuyruk onarıcısı cevap yazıldıktan sonra gelen yeni soruyu "yanıtlandı" yapıyordu; şimdi normal yolla aynı çapa.
- **Y4:** eski talebin kartı yeni talebi kapatabiliyordu (yavaş tur / eşit milisaniye / otomatik onay); şimdi kaynak mesaj sırası.
- **U3:** tehlike okuyucu: 32 "no fire" sonrası gerçek yangın artık AÇIK tehlike (tekrarlar tekilleşir; tarama tavanı aşılırsa seviye en az
  "olası" — asla "anılış"), ekipman yangın fiilinin öznesiyken ("the stove caught fire", "ocak alev aldı") tehlike bastırılmaz, olumsuzluk
  "ve / and / und / et / y / и / و" sınırında biter ("we have no power and smoke is coming out" → tehlike). Açık eval metinlerinde (3.067)
  seviye değişimi 0.
- **Y10 / U27 / U28:** gönderim sonucu yeni taslağı silmez (ev sahibi + misafir ekranı); eski 404 yeni açılmış sohbeti kapatmaz.

### Takvim / veri / rapor
- **U37:** HTML / JSON hata gövdesi "boş takvim" sayılmaz (`feed_not_icalendar`).
- **U33:** `TZID=Europe/Istanbul:2026-08-05T23:00:00` artık 20:00Z (eskiden 23:00Z → gün kayıyordu).
- **U30 / U31 / U32:** CSV "USD (100.00)", "－100" negatif → satır hatası; "100+50", "1e3" tahmin edilmez → "Tutar okunamadı"; tarih sunucu
  diliminden bağımsız.
- **U34:** yaz saati gece yarısında değişen günlerde gün başı (418 dilim × 2020–2030, 1,68 milyon gün: 0 uyuşmazlık).
- **U35 / U36 / U38 / Y6 / Y7 / Y8 / Y9 / U26:** ayrıntı takip tablosunda.

### Ölçüm araçları (müşteri gönderimi DEĞİŞMEDİ; %95 kapısı geri GELMEDİ)
- U16 rapor ezilmez · U18 boş ölçüm yeşil geçmez · U19 veri doğrulanmadan yazılmaz · U20 katı cevap sütunu + rakam sınırı · U21 rapor metni
  ölçümden · U22 cevap kesilmez · U23 setin bütün sırları her cevapta · U24 d-q017 etiketi · U25 Node tabanı 22.13.

## 2. Doğrulama (5. tur)
- Tam kapılar `87ba35d`: tsc · lint · 794 dosya / 13.220 test · build · zafiyet kapısı → ALL_GREEN.
- Tur 2 mutasyon: 19/19 öldürüldü (yaşayan U42 için ayrı test eklendi, sonra öldü).
- Tur 3 + 4 mutasyon (`scripts/mutation-run.mjs`, commit'in ayrık worktree'si, M0 yeşil): 43/44 → yaşayan U37 (senkronun `isIcalendarFrame`i
  kullandığını pinleyen test yoktu; birim testi yalnız saf fonksiyonu sınıyordu) → `calendar-sync.test.ts`e JSON / HTML gövde vakası → 44/44.
- Hazır yamalar: testleri yamalı kodda YEŞİL, eski kodda KIRMIZI (U17 7 · Y5 10 birim + 1 veritabanı · U39 6 veritabanı · U42 1 veritabanı ·
  U29 5 birim); beşi güncel ana dala tek tek ve BİRLİKTE temiz uygulanıyor (`git apply --check`). Yamalar ana dala UYGULANMADI.
- CI: #1308 (`5439a23`) yeşil; `87ba35d`'nin koşusu sonraki push'la iptal edildi; son push'un koşusu bu rapor itildikten sonra izleniyor
  (sonuç döngünün son mesajında).
- Bu turda tam kapının yakaladığı ve düzeltilen: çift tıklamanın kaybedeni 401 alıyordu (400'e döndü), iki eski test `deleteAccountData`ın
  dönüşünü `undefined` bekliyordu, gece yayımlanan Next.js danışmaları.

## 3. Yerelde güncelleme (PowerShell)
```powershell
cd "C:\Users\MUSA CINAR\Documents\LixusPreflight-43ccd3c"
Test-Path .\package.json
git status --short
git pull --ff-only
npm ci
npx prisma generate
```
`Test-Path` `True` demeli; `git status --short` boş değilse önce yerel değişikliklerinize bakın. Bu turda şema değişikliği YOK (veritabanı
komutu gerekmez); `npm ci` Next.js 15.5.27'yi kurar.
