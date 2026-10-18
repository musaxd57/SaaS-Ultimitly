# Hazır yamalar — durum (10-18, gece-4 S10-12)

Ölçüm: her yama için `git apply --check` (uygulanabilir mi) ve `git apply -R --check` (zaten ağaçta mı); "uygulanamıyor" tek başına "yerine
konuldu" demek değildir — akıbet ayrıca git geçmişinden doğrulandı (sha sütunu).

| Yama | Durum | Kanıt |
|---|---|---|
| `2026-10-07-U17-otopark-tahsisi.patch` | **BEKLİYOR** (kurucu kararı; 10-08 Sabah Kararları 63–68 listesi) — temiz uygulanıyor | `git apply --check` ✓ |
| `2026-10-07-U29-f06-dogrulanamayan-oturum.patch` | **BEKLİYOR** (kurucu kararı; 10-08 Sabah Kararları 63–68 listesi) — temiz uygulanıyor | `git apply --check` ✓ |
| `2026-10-15-anlama-ariza-kullanim-ayrimi.patch` | **BEKLİYOR** (kurucu kararı) — temiz uygulanıyor | `git apply --check` ✓ |
| `2026-10-18-T1-talimat-yok-silici-basit-is.patch` | **BEKLİYOR (seçenek B — kurucunun 10-18 cevabıyla zayıf kaldı)** — `KURUCU-SORULARI.md` §T1 | `git apply --check` ✓ |
| `2026-10-18-T1-talimat-yok-tam-tutma.patch` | **BEKLİYOR (seçenek A — önerilen)**: silici cevap yolundan çıkar, "talimatımız yok" taşıyan cevabın tamamı tutulur — `KURUCU-SORULARI.md` §T1 | `git apply --check` ✓ · ilgili 3 dosya 170 test yeşil · yamasız 3 kırmızı · tip + lint temiz |
| `2026-10-14-G1-G1b-anlama-otomatik-mesaj-baglami.patch` | UYGULANDI (ana dalda) | `git apply -R --check` ✓ · `e30ca727` |
| `2026-10-13-G1-anlama-otomatik-mesaj-etiketi.patch` | YERİNE GEÇTİ — G1-G1b yamasının içinde | `e30ca727` |
| `2026-10-07-U39-paddle-tutar.patch` | YENİDEN YAZILDI (kurucu 10-16 S1) | `4cc0e608` |
| `2026-10-07-U42-odeme-tarafi.patch` | YENİDEN YAZILDI (kurucu 10-16 S2) | `95dac9db` |
| `2026-10-15-U42-basit-alarm.patch` | YENİDEN YAZILDI (aynı karar) | `95dac9db` |
| `2026-10-07-Y5-gorev-tekillestirme.patch` | YENİDEN YAZILDI (idempotency kabul testleri: tekilleştirme anahtarı cihaz) | `a449309e` |
| `2026-10-09-migration-60-…patch` | UYGULANDI (migration 60) | `docs/MIGRATION-MANIFEST.md` |
| `2026-10-14-KB-istek-kimligi-migration-65.patch` | UYGULANDI (migration 67 olarak) | `docs/MIGRATION-MANIFEST.md` |
| `faz2-2026-10-16/` | KISMEN — 69–75 numaralarıyla farklı içerik ana dalda; `M-defter`, `M-kb-surum`, `M-odeme-niyeti` kurucu soruları bekliyor | `docs/MIGRATION-MANIFEST.md` §2 |

Uygulanmış / yerine geçmiş yamalar silinmedi (iz kalsın); karar verirken yalnız **BEKLİYOR** satırlarına bakın.
