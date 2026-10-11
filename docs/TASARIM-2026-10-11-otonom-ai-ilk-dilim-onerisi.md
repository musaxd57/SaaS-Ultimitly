# Otonom yapay zekâ — ilk dilim önerisi (yürütme sırası ⑤) — KURUCU KARARI BEKLİYOR

> Kurucu (10-11): "Başta öner + tek tıkla onay olur ama geçici — yaptıklarını görmek için; sonra beğenirsek hemen düşük riskte otomatik
> olsun; ama önce öteki işler, bunları not al."
> Talimat (09-07, yürütme sırası): "Introduce broader autonomous AI behavior only after the required authorization, guardrails, grounding
> and evaluation controls are verified."
> Bu belge KOD DEĞİL; seçenekler + örnekler. Kurucu seçmeden hiçbir şey yazılmaz (CLAUDE.md "SORMADAN SİSTEM KURULMAZ").

## 1. Bugün zaten olan (tekrar kurulmaz)

| Var olan | Ne yapıyor | Durum |
|---|---|---|
| Otomatik misafir cevabı | Güvenli soruya cevap; riskli mesaj insana | CANLI (`AUTO_REPLY_ENABLED=1`) |
| Şikâyetten görev | Kelime yolu şikâyeti `origin: "ai"` bakım görevi açar (`automation.ts`) | CANLI |
| Ev sahibi karar kartı | Erken giriş / geç çıkış talebi için kart, metin taslağı, gönderim öncesi denetim | Kod hazır, `HOST_DECISIONS_ENABLED` KAPALI |
| Açık söz hafızası | Ev sahibinin işaretlediği söz + bağlı görev | CANLI (migration 61) |
| Bilgi tabanı önerileri | Eksik bilgi adayları, "Bilgi tabanına ekle" ön doldurma, çelişki uyarısı | CANLI / yeni |

Yani "mesaj göndermek" zaten otomatik (düşük riskte). ⑤'in yeni kısmı **mesaj DIŞI eylemler**: görev aç / ata, bilgi tabanını düzelt,
söz kaydet.

## 2. İlk dilim için üç aday (hepsi "öner → ev sahibi tek tıkla onaylar", geçici)

**A — Görev önerisi** (en somut fayda)
- Misafir: "Banyoda havlu yok." → Bugün: kelime ağı şikâyet sayarsa konuşma "sorunlu" olur ve genel başlıklı, ATANMAMIŞ bir bakım
  görevi açılır ("Şikayet: Alex", açıklama = mesaj metni).
- Öneri sonrası: konuşma panelinde kart → **"Daire 3'e havlu götür — Ayşe'ye (temizlik) ata, bugün 14:00'e kadar"** [Onayla] [Düzenle] [Yok say].
  Onayda görev açılır + atanır (bugünkü atama e-postası kuralları aynen). Kanıt: misafir mesajının kendisi (bağlantı).

**B — Bilgi tabanı düzeltme önerisi**
- 3 misafir "Wi-Fi şifresi yanlış" dedi, ev sahibi konuşmada yeni şifreyi yazdı ("Yeni şifre: …") → Bugün: çelişki uyarısı görünür, ev
  sahibi bilgi tabanına kendisi gider.
- Öneri sonrası: uyarının altında **"Bilgi tabanındaki Wi-Fi kalemini ev sahibinin 10-11 mesajındaki şifreyle güncelle?"** [Onayla] [Bilerek böyle].
  ⚠️ Şifre / kod sır sayılır: öneri metni şifreyi GÖSTERMEZ, onayda kalem güncellenir (bugünkü sır kapısı kuralları aynen).

**C — Söz kaydı önerisi**
- Ev sahibi misafire yazdı: "Yarın sabah teknisyen gelip kombiye bakacak." → Bugün: söz yalnız ev sahibi işaretlerse hafızaya girer.
- Öneri sonrası: **"Bu bir söz: 'yarın sabah teknisyen — kombi'. Açık söz olarak kaydet + teknisyen görevi aç?"** [Onayla] [Yok say].

## 3. Hepsinde ortak korumalar (talimatın dört şartı)

| Şart | Uygulama |
|---|---|
| Yetki | Yalnız sahip / yönetici onaylar (personel görmez); destek görünümünde (bürünme) kapalı (K8) |
| Korumalar | İlk dilimde para, iade, kapı kodu / şifre gösterimi, misafire mesaj YOK; öneri kartı 24 saatte düşer; her onay geri alınabilir |
| Dayanak | Her öneri hangi mesajdan doğduğunu gösterir; dayanaksız öneri üretilmez (LLM serbest metni gerçek sayılmaz — değişmez 13) |
| Ölçüm | Her öneri için onay / düzenle / yok say kaydı (metin yok, kod); "beğenirsek" ölçütü aşağıda |

**"Beğenirsek → düşük riskte otomatik" ölçütü (öneri):** bir eylem türü 2 hafta boyunca ≥ %90 düzenlemesiz onay ve 0 geri alma alırsa,
YALNIZ o tür ayrı bir anahtarla otomatiğe geçer (ör. A'da yalnız "havlu / nevresim götür" görevleri). Para / erişim / misafire mesaj
otomatiğe hiç geçmez.

## 4. Kurucuya sorular

1. İlk dilim hangisi: **A** (görev), **B** (bilgi tabanı), **C** (söz) — ya da hangileri birlikte?
2. Onay kimde: sahip + yönetici (önerim) mi, yalnız sahip mi?
3. Otomatiğe geçiş ölçütü yukarıdaki gibi mi (2 hafta, ≥ %90, 0 geri alma)?
4. Migration: öneri kartı + onay kaydı yeni bir tablo ister (taze `pg_dump` + onay kuralı). Railway kapalıyken kod hazırlanıp
   push edilebilir mi, yoksa Railway açılınca mı?
