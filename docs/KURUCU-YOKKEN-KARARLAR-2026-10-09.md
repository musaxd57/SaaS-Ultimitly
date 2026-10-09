# Kurucu yokken verdiğim kararlar (2026-10-09 gece →)

> Kurucu (10-09 gece): "Soru sormadan ilerle geçici olarak — kendi önerilerin, nasıl olmasını sen belirle, uygula; ben sana gelince neleri
> sorman gerekirken kendi önerin gibi yaptın yaz bana." Her satır: **normalde sorulacak soru · verdiğim karar · gerekçe · geri alma**.
> Canlı yok (Railway kapalı); yeni davranışlar KAPALI anahtar arkasında. Müşteriye giden metni değiştiren her şey anahtar açılmadan etkisiz.

| # | Normalde sorardım | Kararım | Gerekçe | Geri alma |
|---|---|---|---|---|
| 1 | Konuşma durumu satırının metni ("Konuşma aşaması … · teslim edilmiş cevap: N · son cevaptan bu yana X (yeni oturum)") | Yalnız OLGU yazılır, davranış talimatı yok (selam / kısa selam kuralı eklenmedi) | Kod selamı canlıda açık (`AI_CODE_GREETING_ENABLED`) — modele "yeni oturumda selam ver" demek kodun selam kuralıyla çakışırdı; önce kör eval etkisini ölçer | `AI_CONVERSATION_STATE_ENABLED` kapalı kalır |
| 2 | Kör eval yapılandırması | Önce hedef yapılandırma (cevap + anlama Luna `low`), sonra 5.1 ve Luna `medium` | Kurucu 10-09: Luna'ya geçiş + "reasoning farklarını dene" | — |
| 3 | QR'de doğrulanmış müsaitlik / uzatma: aynı anahtar mı ayrı mı, hangi tarihler | AYRI anahtar `AI_VERIFIED_QR_ENABLED` (kapalı); müsaitlik yalnız konaklamaya DEĞMEYEN aralıkta (bitişik / örtüşen = konaklama değişikliği → ev sahibi); uzatma kanaldaki kurallarla aynı | QR'yi dairedeki misafir kullanır; kurucu "bayrak olsun, unutturma" dedi | anahtar kapalı kalır |
| 4 | Konuşma durumu satırında teslim edilen cevap sayısı | Yazılmaz (Haiku: blokta "giden mesaj" sayısıyla çelişiyordu) | otomatik karşılama selam kuralında sayılır, cevap sayısında sayılmaz | — |
| 5 | Kör eval ilk sonucu (Luna `low`, 46 senaryo × 2 kol) | Satır bayrak kapalı kalır; son kodla 5.1 / Luna `low` / Luna `medium` tekrar koşulur | sızıntı / yanlış susturma / söz / selam tekrarı iki kolda 0; açık kolda beyan 33/33 (kapalı 32/33), belirsiz "yarın" sorusu daha net | — |
| 6 | QR'de "müsait değil" cevabı doluluk bilgisi verir mi (Haiku P2) | Kabul edilen risk: yalnız dairede kalan, cihazı bağlı misafire, aralık başına evet/hayır; ad / fiyat / kanal yok; takvimler senkronluyken aynı bilgi OTA'nın açık takviminde de görünür | anahtar zaten kapalı; açılırsa "müsait değil" yalnız kanalda bırakılabilir (tek satır) | `AI_VERIFIED_QR_ENABLED` kapalı |
| 7 | Luna 6.0 geçişi — ilk ölçüm (konuşma durumu 46×2 + kurucu 8×2; 5.1 / Luna none / low / medium) | Cevap + anlama için **Luna `low`** öneriyorum (güvenlik ölçüleri hepsinde 0; Luna `low` 5.1'den iyi: beyan 32/33 ↔ 30/33, çıkış saati 4/5 ↔ 3/5, belirsizde hedefli soru 1–2/6 ↔ 0/6; p50 4,1 sn ↔ 2,2 sn) — ayrıntı ve ikinci dalga `docs/olcum/LUNA-GECIS-2026-10-10.md` | kurucu "neredeyse her yerde Luna, reasoning'li" | env değeri; kod varsayılanı değişmedi |
