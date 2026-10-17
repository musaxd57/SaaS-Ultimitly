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
| 68 | `68_kb_copy_source_and_commitment_request_id` | KB `copiedFromId/copiedContentHash` (D2) + `GuestCommitment.clientRequestId` (D3) | kurucu ONAYLADI (10-16), origin, prod YOK | boş kolon + kısmi tekil |
| 69 | `69_outbox_conversation_status_index` | `MessageOutbox(conversationId, status)` dizini (I3; hazır yamadaki tek kolonlu `M-outbox-dizin` yerine bileşik — sorgular konuşma + durumla süzer) | kurucu ONAYLADI (10-17 "migration yapalım"), yerel commit → itilince origin | yalnız dizin (küçük tablo, düz `CREATE INDEX`) |
| 70 | `70_kb_superseded_at` | `KnowledgeBaseItem.supersededAt` (L2 "eskisinin yerine koy" zamanı; `supersededById` zaten vardı) | kurucu ONAYLADI (10-17), yerel commit → itilince origin | boş kolon |
| 71 | `71_message_channel_sender_role` | `Message.channelSenderRole` (L5: kanalın bildirdiği gönderen rolü — misafir / ev sahibi / kanal otomasyonu / tanınmayan) | kurucu ONAYLADI (10-17), yerel commit → itilince origin | BÜYÜK tabloya boş kolon (PG 11+ meta-veri, yeniden yazım yok, dizin yok) |
| 72 | `72_signup_network_trace` | `Organization.trialIdentityReusedAt` (K1-B işaret; deneme bitirilmez) + `SignupNetworkTrace` (kayıt ağı izi: HMAC özet, ham IP yok, 90 gün; anahtar KAPALI) | kurucu ONAYLADI (10-17 "B + IP"), yerel commit → itilince origin | boş kolon + yeni tablo |

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
| `M-outbox-dizin` | `MessageOutbox(conversationId)` dizini (yalnız maliyet) | O1 Seçenek A (davranış artık dizinden bağımsız) | ✅ YAZILDI → **69** (bileşik `conversationId, status`; kurucu I3 onayı 10-17). Hazır yamadaki SQL artık uygulanmaz |


Önerilen sıra (hazır yamadaki klasör adları; numara yalnız `prisma/migrations/` altında klasör oluşunca kesinleşir): `m_kb_surum` ·
`m_oncelik` · `m_bildirim` · `m_defter` · `m_iade` · `m_odeme_niyeti` (73'ten itibaren, yazıldıkça). Tasarım + sorular: `docs/TASARIM-2026-10-16-faz2-migration-paketleri.md`.
⚠️ 10-17: 69–72 numaraları S2 paketine gitti (I3 dizini · L2 `supersededAt` · L5 `channelSenderRole` · K1 kayıt ağı izi). Hazır yama belgelerindeki "69 m_outbox_dizin / 70 m_kb_surum" ve
S2 tasarımındaki "76–79" numaraları ESKİ ÖNERİDİR; `M-kb-surum` artık 70 DEĞİL. L2'nin `M-kb-surum` ile ilişkisi: bağımsız; `M-kb-surum` yazılırsa
L2'nin iki yeni yazıcısı (yerine koyma: eski kalemi pasifleştirme + yeni kalem) de sürüm artırır (S2 tasarımı §L2).
