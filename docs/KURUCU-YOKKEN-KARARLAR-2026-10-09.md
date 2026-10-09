# Kurucu yokken verdiğim kararlar (2026-10-09 gece →)

> Kurucu (10-09 gece): "Soru sormadan ilerle geçici olarak — kendi önerilerin, nasıl olmasını sen belirle, uygula; ben sana gelince neleri
> sorman gerekirken kendi önerin gibi yaptın yaz bana." Her satır: **normalde sorulacak soru · verdiğim karar · gerekçe · geri alma**.
> Canlı yok (Railway kapalı); yeni davranışlar KAPALI anahtar arkasında. Müşteriye giden metni değiştiren her şey anahtar açılmadan etkisiz.

| # | Normalde sorardım | Kararım | Gerekçe | Geri alma |
|---|---|---|---|---|
| 1 | Konuşma durumu satırının metni ("Konuşma aşaması … · teslim edilmiş cevap: N · son cevaptan bu yana X (yeni oturum)") | Yalnız OLGU yazılır, davranış talimatı yok (selam / kısa selam kuralı eklenmedi) | Kod selamı canlıda açık (`AI_CODE_GREETING_ENABLED`) — modele "yeni oturumda selam ver" demek kodun selam kuralıyla çakışırdı; önce kör eval etkisini ölçer | `AI_CONVERSATION_STATE_ENABLED` kapalı kalır |
| 2 | Kör eval yapılandırması | Önce hedef yapılandırma (cevap + anlama Luna `low`), sonra 5.1 ve Luna `medium` | Kurucu 10-09: Luna'ya geçiş + "reasoning farklarını dene" | — |
