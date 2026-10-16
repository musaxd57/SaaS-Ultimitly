# Migration manifesti (TEK güncel kaynak — 10-16, Codex C4 üzerine)

> Kural: numara YALNIZ `prisma/migrations/<NN>_<ad>` klasörü oluşunca verilir. Belgelerde henüz yazılmamış paketler ADLA anılır
> (`M-defter`, `M-odeme-niyeti` …). Uygulanmış (ya da itilmiş) migration ASLA yeniden adlandırılmaz / düzenlenmez. Migration içeren push =
> taze `pg_dump` + kurucu açık onayı. Canlı (prod) en son: **58** (Railway 10-02 akşamından beri kapalı; açılışta `migrate deploy` 59→ sonu uygular).

## 1. Repodaki migration'lar (gerçek klasörler)

| No | Klasör | İçerik (özet) | Durum | Dolu tabloya risk |
|---|---|---|---|---|
| 58 | `58_automated_message_send` | otomatik mesaj gönderim kaydı (K7) | origin + PROD | — |
| 59 | `59_decision_requests` | `DecisionRequest` (karar motoru, anahtar kapalı) | origin, prod YOK | yeni tablo |
| 60 | `60_channel_listing_ai_trace` | ChannelListing + sourcePlatform + yapay zekâ izi + kalite konsolu | origin, prod YOK | yeni tablo / boş kolon |
| 61 | `61_trial_identity` | TrialIdentity + muafiyet + trialEndReason | origin, prod YOK | yeni tablo / boş kolon |
| 62 | `62_guest_commitment` | GuestCommitment (misafir sözü) | origin, prod YOK | yeni tablo |
| 63 | `63_operational_event` | OperationalEvent + CheckoutConsent.correlationId | origin, prod YOK | yeni tablo / boş kolon |
| 64 | `64_operational_event_delete_guard` | silme koruma tetikleyicisi | origin, prod YOK | tetikleyici |
| 65 | `65_history_learn` | Geçmişten öğren (4 yeni tablo) | origin, prod YOK | yeni tablo |
| 66 | `66_property_instruction_by_operator` | `PropertyInstruction.byOperator` | origin, prod YOK | varsayılanlı kolon |
| 67 | `67_kb_client_request_id` | KB `clientRequestId` + (mülk, kimlik) tekil | origin, prod YOK | boş kolon + kısmi tekil |
| 68 | `68_kb_copy_source_and_commitment_request_id` | KB `copiedFromId/copiedContentHash` (D2) + `GuestCommitment.clientRequestId` (D3) | kurucu ONAYLADI (10-16), itildi mi: bu dosyanın yanındaki git geçmişine bak | boş kolon + kısmi tekil |

## 2. Hazırlanan / önerilen paketler (NUMARASIZ — sıra yayın anında)

| Ad | Ne | Neden (kurucu kararı / bulgu) | Durum |
|---|---|---|---|
| `M-defter` | ortak işlem defteri (işlem kimliği, kapsam, içerik parmak izi, durum, sonuç bağı) + elle gönderim kalıcı kimliği | S1 + S2 (10-16) | ✅ hazır yama (`docs/hazir-yamalar/faz2-2026-10-16/`, sıfır fark doğrulandı) — kurucu soruları bekliyor |
| `M-kb-surum` | `KnowledgeBaseItem.version` (atomik koşullu güncelleme) | S5 (10-16) | ✅ hazır yama (`docs/hazir-yamalar/faz2-2026-10-16/`, sıfır fark doğrulandı) — kurucu soruları bekliyor |
| `M-odeme-niyeti` | satın alma niyeti başına tek açık Paddle işlemi (`transactionId` ile ödeme ekranı) | Codex C1 — iki sekme = iki tahsilat bugün mümkün | ✅ hazır yama (SQL) — kod Paddle sandbox denemesinden sonra |
| `M-iade` | iade / ters ibraz düzeltme kayıtları (asıl fatura değişmez) | Ödeme S3 (10-16) | ✅ hazır yama (`docs/hazir-yamalar/faz2-2026-10-16/`, sıfır fark doğrulandı) — kurucu soruları bekliyor |
| `M-bildirim` | görev ataması / yeni rezervasyon bildirimi kalıcı kuyruğu | O2 + Codex C2 | ✅ hazır yama (SQL) |
| `M-oncelik` | `Task.prioritySource` (yapay zekâ / ev sahibi) + "öncelik belirsiz" işareti | arıza önceliği (10-16) | ✅ hazır yama (SQL) — Faz 3 kararından sonra |
| `M-takip` | takip numarası 2. dilim sütunları (`OperationalEvent.subjectId/parentId` …) | takip numarası tasarımı | ⚠️ eski belgelerde "67/68" deniyordu — yanlış, numarasız |
| `M-kart` | kartlı deneme kapısı (`trialGate`, `TrialRiskAssessment`) | deneme kötüye kullanımı tasarımı | ⚠️ eski belgede "68" — yanlış; Codex C3 durum çelişkisi düzeltilmeden yazılmaz |
| `M-outbox-dizin` | `MessageOutbox(conversationId)` dizini (yalnız maliyet) | O1 Seçenek A (davranış artık dizinden bağımsız) | ✅ hazır yama (SQL) — kurucu onayı bekliyor (I3) |


Önerilen sıra (hazır yamadaki klasör adları; numara yalnız `prisma/migrations/` altında klasör oluşunca kesinleşir): 69 `m_outbox_dizin` · 70 `m_kb_surum` ·
71 `m_oncelik` · 72 `m_bildirim` · 73 `m_defter` · 74 `m_iade` · 75 `m_odeme_niyeti`. Tasarım + sorular: `docs/TASARIM-2026-10-16-faz2-migration-paketleri.md`.
