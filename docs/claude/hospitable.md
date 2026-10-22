# Hospitable

> CLAUDE.md'den 2026-10-23'te AYNEN taşındı (kurucu 10-22 gece: "her turda okumak yerine gerektiğinde oku"). Bu dosyadaki kurallar
> CLAUDE.md'deki kadar BAĞLAYICIDIR. Hospitable / OAuth / senkron / webhook işinden ÖNCE oku.

## Güncel (kurucu 10-22 gece, ekran görüntüsüyle)
- **OAuth uygulaması PRODUCTION onaylı:** Partner Portal (partners.hospitable.com) → Clients → "Lixus AI" yeşil onaylı. Redirect adresi
  `https://www.lixusai.com/api/hospitable/oauth/callback` (kodda tek kaynak `HOSPITABLE_OAUTH_REDIRECT_URI`; prod'da yalnız bu tam adres —
  `docs/history/CLAUDE-2026-07.md` 07-20). Müşteri bağlantısının ANA yolu OAuth; PAT yalnız yedek.
- **Webhook'lar açılabilir (henüz KULLANILMIYOR):** Portal → Settings → Webhooks → "Create webhook": URL + olay türleri (Reservations ·
  Properties · Review · Messages · Integration Disconnected · Owner Statements · Owner Statement Transactions). Bugün veri 2 dk'lık
  senkronla ÇEKİLİYOR (`SystemLock` "scheduled-sync"). Webhook alıcısı kurmak YENİ bir sistemdir → önce kurucuya sorulur (imza doğrulaması,
  tekrar / sıra güvenliği, ingest sözleşmesi `recordIngestEvent` üzerinden; çekirdek sağlayıcı semantiği istemez).
- **Yön:** amaç Hospitable'dan AYRILMAK (Airbnb Direct + Booking.com, `docs/claude/yol-plani.md`). Hospitable'a özgü yeni ekran / özellik
  YAPILMAZ (kurucu 09-23); bağlantı sağlığı gibi yüzeyler sağlayıcıdan bağımsız `ChannelConnection` üzerine kurulur.

## Eski not (07-02 → 10-22, aynen)
Amaç: Lixus müşterisine "sadece-API" paketi (~$7/daire) → $29/ay Hospitable engelini kaldırmak. Gerçekler:
API yalnız ücretli planlarda; Hospitable partnerlerden OAuth vendor flow bekliyor (bizde ana yol; PAT
fallback: my.hospitable.com → Apps → API access → Access tokens, Read+Write). Patrick (07-02): Connect
kapandı, public API+OAuth tek yol, white-label şimdilik yok ("trafik gösterince pilot"); "tek ana hesap →
çoklu host" property-manager modeli mümkün (tenant izolasyonu yeniden tasarım ister — kullanıcı onayı).
Partner Portal partners.hospitable.com. Dürtme yok.
