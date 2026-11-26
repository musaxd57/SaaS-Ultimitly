# 10-29 gece taslakları (DERLENMEZ — `.txt`)

Oturum 10-29 21:20 UTC'de kullanım sınırına çarptı, 03:35'te döndü; aşağıdaki kod yazıldı ama ağaca alınıp test EDİLEMEDİ. Sabah oturumu
buradan devam eder (kırmızı-önce → mutasyon → tam kapı). Tasarımlar: `docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md` ve
`takvim-taslak/TASARIM-takvim-coklu.md` (iş akışının Türkçe tasarımı, aynen).

- `k1029a-taslak/` — K-1029-A/B/C: yedi dilli ev sahibine başvurma dedektörü (`absence.ts`'e eklenecek), süzgeç yeniden yazımı, "cevaplandı"
  kuralı (`conversation-items/host-contact-settle.ts`), C1–C4 test tabloları.
- `takvim-taslak/` — çoklu takvim saf yerleşim kütüphanesi (`src/lib/calendar/timeline.ts`), yükleyici (`load.ts`), 2.000 rastgele vakalık
  kâhin testi.
