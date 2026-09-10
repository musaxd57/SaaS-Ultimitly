# KAPANDI (2026-09-10) — Türkçe şikayet sınıflandırmasında olumsuz fiil boşluğu (bulgu 2026-09-08)

> **Durum 2026-09-10: KOD düzeyinde kapandı (yerel commit; push kurucu kararı).** Aşağıdaki ölçüm tablosu
> bulgunun o günkü hâlidir; yeni sözleşme ve kanıt "Kapanış" bölümünde. Bulgu metni tarihsel doğruluk için
> DEĞİŞTİRİLMEDİ.

> Nasıl bulundu: V1 QR canlı testi için örnek cümle seçilirken `classifyFallback` ölçüldü ve plandaki
> "Sıcak su gelmiyor, duş soğuk." cümlesinin `general` döndüğü görüldü. **Test cümlesini değiştirmek bu
> eksikliği KAPATMAZ** (Codex, 09-08): cümle değişikliği yalnız testin sessizce yanlış-yeşil olmasını önler;
> açığın kendisi burada AÇIK kalır. Düzeltme YAPILMADI (ayrı tur: kelime ağı değişikliği GOLDEN SET koşmayı
> ve dil paritesi kuralını gerektirir).

## Ölçüm (`src/lib/ai/fallback.ts` · `classifyFallback`, 2026-09-08)
| Girdi | Sonuç | Güven |
|---|---|---|
| "Sıcak su yok." | `complaint` | 0.7 |
| "No hot water." | `complaint` | 0.7 |
| **"Sıcak su gelmiyor, duş soğuk."** | **`general`** | 0.3 |
| **"Su akmıyor."** | **`general`** | 0.3 |
| **"Isıtma gelmiyor."** | **`general`** | 0.3 |
| **"Elektrikler gitti."** | **`general`** | 0.3 |
| **"Kapı açılmıyor."** | **`general`** | 0.3 |
| "Klima bozuk, çalışmıyor." | `complaint` | 0.7 |
| "Klimadan soğuk hava gelmiyor." | `amenity` | 0.55 |
| "İnternet gelmiyor." | `wifi` | 0.55 |

## Örüntü
Kelime ağı `çalışmıyo` / `bozuk` / `yok` kalıplarını yakalıyor; Türkçede en az onlar kadar yaygın olan
**olumsuz fiil biçimlerini** (`gelmiyor`, `akmıyor`, `açılmıyor`, `gitti`) yakalamıyor. Aynı şikayet, fiili
değişince sınıf değiştiriyor ("Sıcak su **yok**" → complaint; "Sıcak su **gelmiyor**" → general).
Dil paritesi de bozuk: İngilizce listede `no hot water` ve **`no heating`** var, Türkçe karşılığı
("ısıtma gelmiyor") yok — CLAUDE.md'deki "`SAFETY_CRITICAL_WORDS` ↔ `KEYWORDS.complaint` dil kapsamı paralel"
kuralıyla çelişiyor.

## Etki (kapsam dürüstçe)
1. **V1 sinyali:** `general` sinyal ÜRETMEZ (gürültü sayılır) → bu cümlelerle gelen gerçek şikayetler mülk
   hafızasına düşmez, örüntü sayacına girmez.
2. **AI güvenlik kapısı:** `classifyFallback` yalnız **çapraz kontrol/veto** tarafında kullanılır; asıl
   sınıflandırmayı model yapar (`source == openai`). Yani bu boşluk tek başına "şikayet oto-yanıtlandı"
   demek DEĞİLDİR — ama kelime ağının sağladığı ikinci savunma bu cümlelerde devrede olmaz.
3. **Fallback yolu (model yoksa/başarısızsa):** sınıflandırma tamamen kelime ağına düşer; orada bu cümleler
   `general` kalır.

## Düzeltme yapılmadı — nedeni ve tur şartı
Kelime ağına dokunmak `tests/unit/golden-scenarios.test.ts` (~105 senaryo) koşmayı, yeni sınıfa **hem tehdit
hem övgü-tuzağı** senaryosu eklemeyi ve dil paritesini birlikte gözden geçirmeyi gerektirir (CLAUDE.md kuralı).
Ayrıca `gelmiyor` gibi ekler olumsuzlama guard'larıyla (`REQUEST_NEGATIONS`, `hasUnnegatedProblemWord`)
etkileşir → "sorun yok / şikayetim yok" gibi olumlu kapanışları yanlışlıkla şikayet saymamak için ölçüm ister.
Bu, V1 canlı doğrulama turunun kapsamı dışındadır.

## Kalan iş (sahibi: AI kalite turu)
- [x] Olumsuz fiil ailesini (`gelmiyor`, `akmıyor`, `açılmıyor`, `gitti`, `kesildi`…) tesis
      adlarıyla birlikte değerlendiren kural + iki yönlü golden senaryolar. (`çekmiyor` BİLEREK dışarıda ↓)
- [x] Dil paritesi denetimi: İngilizce listedeki her kritik ifadenin Türkçe karşılığı var mı (`no heating`).
- [x] Ölçüm: yanlış-pozitif riski ("sorun yok", "şikayetim yok", "eksik bir şey yok") golden sette pinli.

## Kapanış (2026-09-10)

**Sözleşme** (`src/lib/ai/fallback.ts` `KEYWORDS.complaint`, "TÜRKÇE OLUMSUZ FİİL BOŞLUĞU" bloğu): kalıplar
**ÇAPALI** — tesis adı + olumsuz fiil ("su gelmiyor", "ısıtma gelmiyor", "elektrikler gitti", "kapı açılmıyor",
"sigorta attı", "bozuldu"…). Çıplak `gelmiyor / gitti / kesildi / su yok / arıza / yanmıyor` listeye GİRMEDİ;
her biri için tuzak cümle pinli ("Yarın gelmiyoruz", "Plaja gittik", "Eksik bir şey yok", "Hiçbir arıza
yaşamadık"). Elektrik kesintisi hiçbir dilde yoktu → TR + EN eklendi; DE/FR/ES/RU/AR elektrik paritesi **borç**
(ayrı tur, CLAUDE.md açık işler).

| Girdi | 09-08 | 09-10 |
|---|---|---|
| "Sıcak su gelmiyor, duş soğuk." | `general` | `complaint` (sinyal complaint/negative/0.7) |
| "Su akmıyor." | `general` | `complaint` |
| "Isıtma gelmiyor." | `general` | `complaint` |
| "Elektrikler gitti." | `general` | `complaint` |
| "Kapı açılmıyor." | `general` | `complaint` (riskType `safety_emergency` — kilitli-kalma ağı önce gelir, ikisi de veto) |
| "Klimadan soğuk hava gelmiyor." | `amenity` | `complaint` |
| "İnternet gelmiyor." | `wifi` | `wifi` (**bilinçli**: bilgi tabanından yanıtlanır) |
| "Yarın gelmiyoruz, ertesi gün geleceğiz." | `general` | `general` (tuzak, pinli) |

**Bilinçli kararlar:** (1) `İnternet gelmiyor` / `wifi çekmiyor` complaint DEĞİL — 08-07 gerekçesi geçerli
(complaint = oto-yanıt kapanır; wifi sorusu KB'den cevaplanır). (2) Övgü tuzağı olarak seçilen cümleler
mevcut ağlarla çakışmayacak biçimde ölçüldü: "Kapı kolayca açıldı" `SAFETY_CRITICAL_WORDS` kilitli-kalma ağına
("kapı … açıl…"), "kapı kodu" `checkin`/`access_security`ye takılır — bu ağlar bu turda GEVŞETİLMEDİ; tuzak
"Giriş çok kolaydı, teşekkürler." oldu. (3) ASCII ikizi yazılmadı: `includesAnyFold` kelimeyi de
`foldTurkishAscii`den geçirir ("kapi acilmiyor" girdisi "kapı açılmıyor" kalıbıyla eşleşir, test-pinli);
eski satırlardaki ikizler dosya geleneği, işlevsel değil.

**Kanıt:** `tests/unit/complaint-negative-verbs.test.ts` (bu tablo + tuzaklar + EN paritesi + V1 sinyal) ·
`tests/unit/golden-scenarios.test.ts` "TÜRKÇE OLUMSUZ FİİL ŞİKÂYETLERİ (09-10)" (tehdit + övgü-tuzağı çiftleri)
· `tests/integration/qr-draft-vs-delivered.test.ts` "E6 KELİME AĞI İKİNCİ SAVUNMA" (model `general/none/0.9`
dese bile gerçek QR rotası devreder, `RiskEvent.reason = keyword_escalated`). Mutasyon: 13/13 yakalandı
(8 kaldırma + 5 aşırı-uygulama: çıplak `gelmiyor/gitti/arıza/yok` ve `internet gelmiyor`), kontrol koşusu
önce/sonra yeşil. İlk turda "tek imlâyı sil" mutantı hayatta kaldı → ASCII ikizi kaldırılınca EŞDEĞER mutant
olduğu anlaşıldı (kaçak değil), `bozuldu` için gerçek kapsama boşluğu bulundu → "Buzdolabı bozuldu." eklendi.

**Kapsam dürüstlüğü:** bu düzeltme kelime ağının İKİNCİ SAVUNMASINI onarır; modelin `general` dediği bir
şikâyeti artık QR ve oto-yanıt kapıları yakalar, V1 sinyali üretilir. Model yolundaki sınıflandırma kalitesi
(modelin kendisi) bu turda ÖLÇÜLMEDİ (gerçek koşu kurucunundur).
