# Olay yönetimi, SLO ve felaket kurtarma (10-21, altyapı envanteri madde 55 · 63–65 · 83–85 · 109–111)

Tek sayfa: bir şey bozulduğunda nereye bakılır, ne zaman "bozuk" sayılır, nasıl geri alınır, sonra ne yazılır. Ayrıntılı runbook'lar
aşağıda bağlı; burası dizindir. Kapsam: tek Railway servisi + tek PostgreSQL (bugünkü kurulum).

## 1. Hizmet hedefleri (SLO) ve ölçüleri (SLI)

Hedefler bugünkü sinyallerden ölçülebilir olanlarla sınırlıdır. Ölçülemeyen hedef yazılmaz.

| Hizmet | SLI (nasıl ölçülür) | SLO (hedef, 30 gün) | Hata bütçesi (30 gün) |
|---|---|---|---|
| Uygulama erişilebilir | `/api/health` 200 oranı (dış izleyici, 5 dk aralık) | %99,5 | ~3,6 saat kesinti |
| Senkron canlı | `/api/health?strict=1` `sync=ok` oranı (`lastSyncAgeSec` ≤ 900) | %99 | ~7,2 saat bayat senkron |
| Kuyruk ilerliyor | `?strict=1` `queue` ≠ `stalled` (vadesi gelmiş satır 15 dk'dan fazla beklemiyor) | %99 | ~7,2 saat |
| Misafir mesajı ev sahibine düşüyor | Riskli / tutulan mesaj için uyarı e-postası kuyruğa girdi (olay günlüğü `OperationalEvent`) | ölçüm yok → hedef YOK | — |

**Bütçe bitince:** yeni özellik yayını durur, yalnız güvenilirlik düzeltmesi yayınlanır. Bütçe ay başında sıfırlanır.

⚠️ İlk iki SLI'yı ölçen dış izleyici BUGÜN YOK (kurulum kurucu kararı: `TASARIM-2026-10-21-altyapi-111-envanter.md` soru 1). Kurulana
kadar SLO yalnız hedeftir, ölçüm değildir.

## 2. Olay sırasında: ilk 15 dakika

1. **Ne bozuk?** `/api/health` (DB) → `/api/health?strict=1` (senkron + kuyruk) → `/api/health?live=1` (süreç ayakta mı; DB'ye
   dokunmaz). `live` 200 ama `/api/health` 503 ise sorun veritabanında. Yeniden başlatmak çözmez.
2. **Uyarılar:** `ERROR_ALERT_EMAIL` kutusu (bağlam başına 10 dk'da bir e-posta) · Sentry (`SENTRY_DSN` ayarlıysa) · operatör paneli
   → Operasyon Teşhisi → takip numarasıyla olay araması.
3. **Misafir tarafını durdur (gerekirse):** `AUTO_REPLY_ENABLED=0` (kuyruktaki otomatik mesajlar da durur) · QR için `GUEST_CHAT_ENABLED`
   kaldır. Bayrak kaldırmak geri alınabilir, kod geri almaktan önce gelir.
4. **Kayıt:** saat, belirti, alınan önlem, takip numaraları. Postmortem buradan yazılır (§5).

### Olay türüne göre runbook

| Belirti | Runbook |
|---|---|
| Yükleme / depolama hatası | `docs/UPLOAD-FAIL-CLOSED-RUNBOOK.md` |
| Zafiyet kapısı kırmızı (CI) | `docs/ZAFIYET-KAPISI-ZAMANLAYICI-RUNBOOK.md` |
| Migration / şema geçişi | `docs/MIGRATION_CUTOVER.md`, `docs/MIGRATION-MANIFEST.md` |
| `*-undecryptable` alarmı | önce salt-okuma teşhis `scripts/diagnose-hospitable-tokens.ts`, SONRA satır silme (CLAUDE.md). **ENCRYPTION_KEY rotasyonu ASLA** |
| Hospitable 402 / bağlantı | kurucu org aboneliği 402 bilinen durum (veri donmuş, hata değil). Diğer işletmeler: bağlantı kartı |
| Kuyruk takıldı (`queue_stalled`) | `/sent/queue` (outbox operasyonu) → satırın durumu; `failed` / `review` elle yeniden dene |
| Paddle webhook / ödeme kayması | `docs/RAILWAY-ACILIS-2026-10-15.md` (uzlaştırma adımları) |
| Railway duraklatma / geri açma | `docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md`, `docs/RAILWAY-ACILIS-2026-10-15.md` |

## 3. Geri alma

- **Bayrak geri alma (önce bu):** ilgili `*_ENABLED` env'ini kaldır → yeni işler eski yola döner. Bayrakların listesi ve ne yaptıkları:
  `docs/RAILWAY-ACILIS-2026-10-15.md`.
- **Kod geri alma:** Railway → Deployments → önceki başarılı yayın → Redeploy. Dal oto-yayın açık: geri alınan sürümün üstüne yeni push
  gelirse o yayınlanır. Kalıcı geri alma = dalda `git revert` + CI yeşil.
- **Migration geri alınmaz** (yalnız ileri). Geri alınan kod yeni kolonları okumaz; yeni kolonlar nullable / varsayılanlı eklendiği için
  eski kod çalışır (kural: dolu tabloya required-no-default / drop / unique EKLENMEZ). Veri bozan migration'da tek yol §4 geri yükleme.

## 4. Yedek ve felaket kurtarma

| | Hedef | Bugün |
|---|---|---|
| RPO (kabul edilen veri kaybı) | 24 saat | Elle yedek (`scripts/ops-backup-prod.ps1`); otomatik günlük yedek YOK → kurucu kararı (envanter soru 2) |
| RTO (hizmetin geri gelmesi) | 4 saat | Geri yükleme provası 0,7 sn (`scripts/ops-restore-drill.ps1`, 09-19); yeni servis + env kurulumu elle |
| Prova sıklığı | ayda bir + migration'lı her yayından önce | son prova 09-19 |

Kurallar: migration içeren yayından önce taze `pg_dump` (CLAUDE.md). Anahtar (`ENCRYPTION_KEY`) kasada, DB yedeğinden AYRI tutulur. Prod
dökümü yerel geliştirmeye YÜKLENMEZ. Tek bölge / tek DB bilinen ve kabul edilmiş risktir (çok bölge ölçekte değer üretmez).

## 5. Postmortem şablonu (her müşteriyi etkileyen olaydan sonra, 48 saat içinde)

Dosya: `docs/POSTMORTEM-YYYY-AA-GG-<kisa-ad>.md`. Suçlama yok; sistem ve süreç anlatılır. Misafir adı / mesajı / kişisel veri YAZILMAZ
(takip numarası yeterli).

```
# Postmortem — <başlık> (<tarih>)
Etki: kim, ne kadar süre, kaç mesaj / işletme (sayı; kimlik yok)
Zaman çizelgesi (UTC): ilk belirti · fark edilme · önlem · düzelme
Kök neden: teknik zincir (neden 5 kez)
Neden fark edilmedi / geç fark edildi: hangi uyarı yoktu
Ne iyi gitti:
Eylemler: [ ] düzeltme (sahip, tarih) · [ ] test / pin · [ ] uyarı / SLO güncellemesi
Hata bütçesine etkisi: <dakika>
```

Önceki kök neden yazıları (şablon öncesi): `docs/EVAL-BULGULARI-2026-09-09-kok-neden-ve-duzeltme-plani.md`,
`docs/DENETIM-2026-09-23-alarm-seli-ve-guvenlik-turu.md`.

## 6. Nöbet

Bugün tek kişi (kurucu) + uyarı e-postası. Hedef: dış izleyici (§1) telefona bildirim gönderir. Kritik uyarı (acil misafir mesajı) zaten
ev sahibine ayrı e-postayla gider ve operatör nöbetine bağlı değildir. Ekip büyüyünce: haftalık nöbet sırası + 15 dk ilk yanıt hedefi
(kritik), 4 saat (diğer).
