# Hazır yamalar — durum (10-23 gece; önceki: 10-18, gece-4 S10-12)

Ölçüm: her yama için `git apply --check` (uygulanabilir mi) ve `git apply -R --check` (zaten ağaçta mı); "uygulanamıyor" tek başına "yerine
konuldu" demek değildir — akıbet ayrıca git geçmişinden doğrulandı (sha sütunu).

| Yama | Durum | Kanıt |
|---|---|---|
| `2026-10-23-migration-85-dogrulanmis-cevap-tekrari-golge.patch` | **BEKLİYOR** (kurucu onayı: migration 85 — yeni tablo `VerifiedAnswer`, yalnız GÖLGE kip `AI_ANSWER_REUSE_SHADOW_ENABLED`; misafire bu tablodan hiçbir şey gitmez; push öncesi taze `pg_dump`) — Opus güvenlik F7 + **Opus 85 incelemesi (11 bulgu) + Haiku 3. tur (10 bulgu) 10-23 gece düzeltmeleriyle**: kayda misafir metni girmez (kapalı sözcük listesi; ad / sayı / sır değeri / tanınmayan sözcük → kayıt yok), bağımsız teyit misafir (rezervasyon) başına + koşullu güncelleme, söyleyiş farkı uyuşmazlık değil, parmak izi süzülmemiş kalemlerden, anahtardan bağımsız saatlik süpürge (90 gün + kaynağı silinmiş / değişmiş kalem), demo sıfırlama, gönderim yolunu en çok 2,5 sn bekletir, aday tavanı 10 (kararlı önce) | `git apply --check` ✓ (`d9f369f5` üstüne — gece sonu etiket / doğrulayıcı düzeltmeleriyle yeniden kuruldu, çakışma yalnız test dosyasında, ikisi de korundu) · taze PG'de sıfır sapma (`prisma migrate diff` boş — migration değişmedi) · ilgili DB testleri 95/95 + birim 116/116; yeniden kurulumdan sonra 6 dosya 187/187 |
| `2026-10-07-U17-otopark-tahsisi.patch` | **BEKLİYOR** (kurucu kararı; 10-08 Sabah Kararları 63–68 listesi) — temiz uygulanıyor | `git apply --check` ✓ |
| `2026-10-07-U29-f06-dogrulanamayan-oturum.patch` | **BEKLİYOR** (kurucu kararı; 10-08 Sabah Kararları 63–68 listesi) — temiz uygulanıyor | `git apply --check` ✓ |
| `2026-10-22-U4-misafire-gorunen-ad.patch` | UYGULANDI (kurucu 10-22 akşam: "U4'ü push edebilirsin"; migration 83 — Railway açılışında önce taze yedek, `docs/RAILWAY-ACILIS-2026-10-15.md` 1. adım) | ana dalda · örnek yazı "Kat 2 Daire 3" |
| `2026-10-15-anlama-ariza-kullanim-ayrimi.patch` | **BEKLİYOR** (kurucu kararı) — temiz uygulanıyor | `git apply --check` ✓ |
| `2026-10-18-T1-talimat-yok-silici-basit-is.patch` | **GEÇERSİZ (10-21)** — kurucu "B" tarifini daha geniş kurallarla verdi; ana dalda dayanak şartıyla uygulandı (`07aac0bd`), bu yama UYGULANMAYACAK — `KURUCU-SORULARI.md` §T1 | `git apply --check` ✓ |
| `2026-10-18-T1-talimat-yok-tam-tutma.patch` | **GEÇERSİZ (10-21)** — kurucu A yerine B'yi seçti (ana dalda `07aac0bd`); bu yama UYGULANMAYACAK — `KURUCU-SORULARI.md` §T1 | `git apply --check` ✓ · ilgili 3 dosya 170 test yeşil · yamasız 3 kırmızı · tip + lint temiz |
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
