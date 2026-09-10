# ONAY PAKETİ — Yer tutucu çıktı vetosu (E4, 4. gerçek koşu) — UYGULANMADI

> Durum: **öneri**, kod değişikliği YOK. Kurucu onayı olmadan uygulanmaz (P5 ailesi: gönderim kapısına yeni veto =
> güvenlik politikası değişikliği). Kaynak: 4. gerçek koşu (09-09), Codex ikinci tur.

## Ölçülen bugünkü davranış (kanıt)

- Bilgi tabanında hazır şablon doldurulmadan kayıtlı: `Notlar: "Wi-Fi şifresi: [ŞİFRE]"` (kb-manager hazır
  şablonu köşeli parantezli alan taşır; kayıt rotasında yer tutucu kontrolü yok).
- Model taslağı (gerçek koşu): **"Wi-Fi şifresi kayıtlarımda [ŞİFRE] olarak görünüyor…"** — intent `wifi`,
  riskLevel `none`, riskType yok, güven **0.95**, beyan 1 / doğrulanan 0.
- Gerçek QR rotası (`tests/integration/qr-draft-vs-delivered.test.ts`, DB'li, model mock'lu, aynı girdiler):
  ürün bu metni misafire **döndürüyor**. Kapı geçiyor çünkü 0.95 ≥ 0.75, intent devir kümesinde değil, risk yok;
  `unsourced_claim` yalnız 0.45–0.75 bandında bakılır ve "[ŞİFRE]" rakam/saat/kod kalıbı değildir. (Test ortamı
  çıktısı; canlı teslimat kanıtı değil.)
- Kanal oto-yanıtı (`passesAutoReplySafetyGate`): aynı taslak aynı gerekçeyle geçer (kelime ağı/risk/injection
  vetosu yer tutucuya bakmaz).

Bugün uygulanmış olan tek şey **istem tarafı**: bloğa giren kalemde yer tutucu varsa `packKnowledgeBase` koddan
`[NOT] DOLDURULMAMIŞ YER TUTUCU … gerçek değer DEĞİLDİR` yazar. Bu modelin davranışını iyileştirir ama garanti
değildir; veto olmadan "[ŞİFRE]" hâlâ gidebilir.

## Önerilen değişiklik (somut)

**Tek yüklem, tek kaynak:** `src/lib/ai/placeholders.ts` (yeni, saf): `kbPlaceholderTokens` (bugün `prompts.ts`te)
buraya taşınır + `replyPlaceholderTokens(text)` = `[…]`/`<…>`/`{…}`/`___` içinde harf (tests/helpers'taki
`placeholderMentions` ile aynı sınıf; testte parite pini).

1. **QR yolu** (`src/app/api/chat/[token]/route.ts` `evaluateEscalation` — devir kararı ORADA, `guest-chat.ts`
   yalnız devir METNİNİ verir): model taslağında yer tutucu belirteci varsa → `{ escalate: true, reason }`
   (fonksiyon boolean DEĞİL, gerekçeli nesne döndürür). Kapalı kümeye yeni değer `placeholder_in_draft` İKİ
   yerde: `EscalationReason` birliği (route.ts) + `src/lib/risk-events.ts` içindeki `REASONS` kümesi (modül-içi
   `const`, dışa aktarılmaz; `clampTo` tanımadığı gerekçeyi düşürür — eklenmezse RiskEvent gerekçesiz yazılır);
   migration YOK (kolon string). Misafire `escalationReply()` gider ("kaydedildi; ev sahibiniz görebilir"); host
   e-postası/rozet mevcut devir akışıyla aynı. Sıra: güvenlik dallarının (intent/riskType/kelime ağı/injection/
   model risk) ARDINDA, bant kontrolünden ÖNCE — böylece yer tutucu HER güvende ve bant kapalıyken de gitmez
   (bugün `unsourced_claim` yalnız `QR_INFORMATIONAL_BAND_ENABLED` açıkken ve 0.45–0.75 bandında bakılır; E4'ün
   0.95 güveni o dala hiç girmez).
2. **Kanal oto-yanıtı** (`src/lib/automation.ts` `passesAutoReplySafetyGate`): aynı yüklem → `false`; skip
   gerekçesi mevcut `low_confidence_or_risky` kovasında kalır (yeni kova = raporlar/inbox etiketleri değişir; ilk
   dilimde YOK) ama `RiskEvent` `placeholder_in_draft` yazar (teşhis).
3. **Inbox önerisi / Ayarlar testi:** veto YOK (host görür, düzeltir); test kartı "otomatik gitmezdi" der
   (`wouldAutoSend` zaten kapıyı çağırıyor → kendiliğinden doğru).
4. **Kayıt anında uyarı (UI, ayrı):** `kb-manager` şablon kaydında köşeli parantezli alan kaldıysa sarı uyarı;
   engel YOK (host bilerek kaydedebilir). Rota tarafında engel önermiyorum (A5 "yer tutucu sessizce yutulmaz"
   ilkesiyle uyumlu: görünür kalsın).

## Test planı (K2)

- Kırmızı-önce: `qr-draft-vs-delivered` E4 satırı `expect(out.reply).toContain("[ŞİFRE]")` → veto sonrası
  `escalationReply()`; aynı dosyada karşı örnek: yer tutucusuz aynı güvenle cevap YİNE gider (aşırı uygulama yok).
- Golden set: `[ŞİFRE]`, `<adres>`, `{isim}`, `____` içeren taslaklar için hem tehdit hem övgü-tuzağı
  ("Şifre: [ŞİFRE]" düşer; "Adım [1] ve [2]" düşmez; "Merhaba {isim}" düşer).
- Parite: `replyPlaceholderTokens` ↔ `placeholderMentions` aynı sınıf (iki yönlü pin).
- Kapalı küme pini: `ESCALATION_REASONS` yeni değer; RiskEvent sayımı (`placeholder_in_draft`) canlıda teşhis.
- Mutasyon: yüklemi kapatma, sınıfı daraltma ({} hariç), sıralamayı bant sonrasına alma — hepsi yakalanmalı.

## Yan etkiler / riskler

- **Yanlış pozitif:** misafire meşru köşeli parantezli metin gitmesi çok nadir (madde imi "[1]" harf şartıyla
  dışarıda). `{isim}` ikamesi QR yolunda YAPILMIYOR → karşılama şablonu `{isim}` içeren mülkte QR cevabı
  devredebilir; bu bugün zaten bir kusur (misafire "{isim}" gidiyor olabilir) — vetoyla görünür olur, önce
  ikame paritesi (QR'a `fillPlaceholders`) istenebilir: ayrı küçük iş, veto ile aynı turda önerilir.
- **Politika:** yeni veto = gönderim kapısı değişikliği; `docs/TEST-EVIDENCE-CONTRACT.md` K2 + golden set +
  iki yönlü senaryo + gerçek eval koşusu (öncesi/sonrası) şart. Migration YOK, ücretli servis YOK.
- **Ölçek:** yüklem O(n) regex, 4.000 karakter tavanında ihmal edilebilir.

## Karar noktaları (kurucu)

1. Veto QR + kanal (önerilen) mı, yalnız QR mı?
2. `{isim}` sınıfı vetoya dahil mi (önerilen: evet) — QR ikame paritesiyle birlikte mi?
3. Kayıt anında UI uyarısı aynı turda mı?
