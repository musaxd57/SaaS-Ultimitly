# Sabah Kararları — 2026-10-01 (gece modu)

> Gece modunda (kurucu: "soru sorma, ben gelene kadar") onay gerektiren her nokta burada birikir. Hiçbir madde silinmez;
> yanıtlanan madde "KARAR: …" satırıyla kapanır. Her maddede: **durum** · **öneri** · **müşteriye etkisi** · **beklerken yapılmayan**.
> Önceki listeler: `docs/SABAH-KARARLARI-2026-09-28.md` (K1–K10 a–t) ve `docs/INCELEME-2026-09-30-codex-ve-ajanlar.md` (K1–K18).

## 1. "Karar bekliyor" kartı — erken giriş / geç çıkış için onay / ret düğmesi
- **Durum:** Kurucunun istediği akışın üç parçası kodda, anahtar arkasında (`AI_HOST_DECISION_HOLD_ENABLED`, varsayılan KAPALI):
  "ev sahibinizin kararıdır" cümlesi ve iki modelin doğruladığı konaklama ertelemesi misafire **gitmez**; ev sahibine mesaj başına
  **tek** "Misafir cevabınızı bekliyor" e-postası; konuşmanın öğesi **açık** kalır (cevaplandı yazılmaz). Eksik parça: panelde
  "13:00 erken giriş — karar bekliyor" başlıklı kart ve **Onayla / Reddet** düğmeleri (talebin sonuçlanması). Bu, Host Copilot Faz 1
  (Host Karar Motoru) işidir: `DecisionRequest` tablosu (migration) + 6 dilde metin + e-posta. Onay paketi hazır:
  `docs/ONAY-HOST-COPILOT-FAZ0-2026-09-25.md` (K1–K10).
- **Örnek — misafir: "Saat 13:00'te giriş yapabilir miyiz?"**
  - *Bugün (canlı):* iki model ertelemeyi doğrularsa "Standart giriş 15:00. Erken giriş ev sahibinizin kararına bağlıdır." GİDER;
    konuşma "cevaplandı" olur, ev sahibine bildirim YOK (kurucunun tarif ettiği hata).
  - *Anahtar açılınca (bu gece hazır):* misafire HİÇBİR ŞEY gitmez; ev sahibine TEK e-posta "Misafir cevabınızı bekliyor"; konuşmada
    erken giriş öğesi AÇIK; gelen kutusundaki erken giriş kontrol paneli kanıtları gösterir (temizlik "bitti" kaydı ve saati, önceki
    misafirin çıkışı, sonraki / önceki rezervasyon, ücret kuralı). Her şey doğrulanmış ve mülkte "otomatik" kuralı açıksa AI zaten
    KODLA kurulmuş onayı gönderir ("Daireniz hazır; bugün (1 Ekim) saat 13:00 itibarıyla giriş yapabilirsiniz. Erken giriş ücreti
    300 TL.") — bu yol değişmedi.
  - *Faz 1 (onayınızla):* panelde "13:00 erken giriş — karar bekliyor" kartı + **Onayla / Reddet**. Onayla → kod kanıtları yeniden
    doğrular, misafire kodla kurulmuş onay gider; Reddet → nazik ret ("Bugün erken giriş mümkün olmadı; giriş 15:00'ten itibaren.").
    Bildirim tek; talep kararla kapanır; karar kaydı tutulur. (Büyük platformlar da böyle: bekleyen talep kartı + kabul / ret.)
- **Öneri:** Faz 0 paketindeki on kararı verin; ardından migration + kart + düğmeler (kırmızı-önce, tam kapılar, yedek onayıyla).
- **Müşteriye etkisi:** Misafire geçiştirici cevap gitmez; ev sahibi tek bildirimle kararı panelden verir, AI kararı misafire
  kodla kurulmuş metinle iletir.
- **Beklerken yapılmayan:** migration, kart, düğmeler. Anahtar canlıda AÇILMADI.

## 1b. "Daire hazır" kanıtında temizlikçinin FOTOĞRAFI şart olsun mu?
- **Durum:** Bugün "hazır" kanıtı = temizlik görevinin KİMLİKLİ son durum kaydı "bitti" + saati (≥5 dk önceki çıkıştan sonra); fotoğraf
  isteğe bağlı. Kurucu notu: "temizlikçinin attığı fotoya işaretlemesinin saatine bakacak".
- **Öneri:** Otomatik onay için "bitti" kaydında en az bir fotoğraf şartı (fotoğrafsız "bitti" → ev sahibine karar kartı). Elle onayda
  şart yok.
- **Müşteriye etkisi:** Fotoğraf yüklemeyen temizlikçide erken giriş otomatik onaylanmaz, ev sahibine düşer.
- **Beklerken yapılmayan:** kural değişikliği.

## 1c. Erken giriş kanıtlarını cevap modeline "bol bol" vermek (kurucu: "onu bol bol besleyip cevabı EN DOĞRU şekilde")
- **Durum:** Kanıtlar (temizlik "bitti" kaydı ve saati, önceki misafirin çıkışı, sonraki / önceki rezervasyon, ücret kuralı) KODDA
  değerlendiriliyor; otomatik onay yalnız koddan kurulan metinle gider (model izin cümlesi yazamaz). Cevap modeli bu kanıtları GÖRMÜYOR.
- **Öneri:** Kanıtları cevap modeline YALNIZ ev sahibine hazırlanan TASLAK için salt-okuma özet olarak verelim ("Temizlik 12:40'ta
  bitti · önceki misafir 11:05'te çıktı · ücret 300 TL"); misafire otomatik giden metin yine YALNIZ kodla kurulur (model kanıttan izin
  ÇIKARAMAZ). Böylece ev sahibinin önündeki taslak doğru ve dolu olur, karar yine kanıtla verilir.
- **Müşteriye etkisi:** Misafire giden metin değişmez; ev sahibinin taslağı kanıtlı hâle gelir.
- **Beklerken yapılmayan:** istem / bağlam değişikliği.

## 2. Erken giriş BİLGİ cevabındaki "kararı ev sahibiniz verir" cümlesi
- **Durum:** Koddan kurulan politika metni (ör. "Erken giriş ücreti 300 TL. Erken girişin mümkün olup olmadığı o günkü temizliğe
  bağlıdır; kararı ev sahibiniz verir.") 6 dilde bu cümleyi taşır. Anahtar (madde 1) açılırsa bu bilgi cevabı da **tutulur** (pinli).
- **Öneri:** Metni şöyle değiştirelim: "Erken giriş ücreti 300 TL. Erken girişin mümkün olup olmadığı o günkü temizliğe göre
  netleşir." (ev sahibini karar verici diye anmadan; 6 dil).
- **Müşteriye etkisi:** "Erken giriş ücretli mi?" sorusu otomatik cevaplanmaya devam eder; geçiştirici cümle kalkar.
- **Beklerken yapılmayan:** metin değişikliği (müşteriye giden metin → onayınız).

## 3. Şikâyete bağlı istek kuralının kapsamı
- **Durum:** Kurucu talimatıyla CANLIYA HAZIR (anahtarsız, RC49): bu turda tutulan bir **şikâyet** varken, bağımsız bilgi türü
  olmayan istek cevaplanmaz; kapı da (iki öğe doğrudan verilse bile) tutar. Bağımsız türler: Wi-Fi, otopark, giriş / çıkış saati,
  bagaj, ulaşım, çevre önerisi, giriş / anahtar. Olanaklar, cihaz kullanımı, temizlik / çarşaf, çöp, ev kuralları, "diğer" şikâyet
  turunda bağlı sayılır (temkinli).
- **Öneri:** (a) Liste böyle kalsın. (b) Aynı kural **iade / iptal** ve **ev sahibiyle görüşme** isteğine de uygulansın ("İade
  istiyorum, şimdi ne yapacağız?" → hiçbir şey gitmez, ev sahibinde). Öneri: (b).
- **Müşteriye etkisi:** (b) seçilirse iade / görüşme turlarında bağımsız olmayan yardım sorusu da ev sahibine kalır.
- **Beklerken yapılmayan:** iade / görüşme genişletmesi.

## 4. K6 — Meslek / rutin bakım anılması acil sayılmıyor (canlı davranış değişikliği)
- **Durum:** Codex K6'ya göre düzeltildi (RC49): "Doktor olan arkadaşım…", "Avukat arkadaşımızla…", "hastanedeki rutin kontrol
  randevum" artık nötrlenmiş acil sözcüğünü geri açmıyor. "mutfak yanıyor", "kapı kilitli, duman var", "doktor lazım, arkadaşım
  bayıldı", "hastaneye kaldırıldı" acil kalır. Bilgi için: onaylı K kapsamı.
- **Müşteriye etkisi:** Bu tür mesajlara artık otomatik cevap gidebilir (eskiden acil e-posta + cevap yok).

## 5. K5 — Sağlık ("Çocuğun ateşi var") — 09-30'dan devreden
- **Durum:** Değişmedi; karar modelde. **Öneri:** "sağlık" sınıfı: otomatik gönderim yok, ev sahibine bildirim (acil e-posta değil).

## 6. Luna (gpt-6-luna) katman bazında geçiş — ölçüm sonuçlarına göre (bu belgenin sonunda tablo)
- **Durum:** Ölçüm sürüyor (gece bütçesi ~25 USD). Katman bazında model ayarı eklendi (`AI_UNDERSTANDING_MODEL`,
  `AI_STAY_GUARD_MODEL`, `KB_RERANK_MODEL` + `*_REASONING_EFFORT`; boşken bugünkü ortak ayar).
- **Beklerken yapılmayan:** canlı model / bayrak değişikliği.

## 7. Ücret kuralı (kurucu ifadesi) — anahtar `AI_KB_FEE_RULE_ENABLED`
- **Durum:** İstem metni kurucunun ifadesiyle güncellendi ("Onaylı bilgi tabanındaki sabit hizmet ücretini, koşullarıyla birlikte
  söyle. Konaklama fiyatı, indirim, iade veya tazminat konusunda fiyat üretme ya da onay verme."); "ASLA yazma" yasağı anahtar
  açıkken satırın YERİNE geçer. Anahtar KAPALI.
- **Öneri:** Ölçüm sonucuna göre açılış (bu belgenin sonunda).

## 8. Şikâyet takibi istem katmanları — anahtar `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED`
- **Durum:** Kodda, KAPALI. Kod koruması (madde 3) anahtardan bağımsız çalışır.
- **Öneri:** Ölçüm sonucuna göre açılış.

## 9. Aşama 2 (V0–V8) — kurucunun 6 maddesi bekleniyor
- **Durum:** `docs/ASAMA-2-V0-V8-HARITA-2026-09-30.md` taslak. Gece V işine başlanmadı (talimat).

## 10. Devreden: K13 (destek erişimi metni — avukat), K15 (Nodemailer gerçek deneme e-postası), K17 (kod selamı anahtarı)
- **Durum:** Değişmedi.
