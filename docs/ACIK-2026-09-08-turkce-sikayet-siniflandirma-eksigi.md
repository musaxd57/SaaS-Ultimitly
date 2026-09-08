# AÇIK BULGU — Türkçe şikayet sınıflandırmasında olumsuz fiil boşluğu (2026-09-08)

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
- [ ] Olumsuz fiil ailesini (`gelmiyor`, `akmıyor`, `açılmıyor`, `çekmiyor`, `gitti`, `kesildi`…) tesis
      adlarıyla birlikte değerlendiren kural + iki yönlü golden senaryolar.
- [ ] Dil paritesi denetimi: İngilizce listedeki her kritik ifadenin Türkçe karşılığı var mı (`no heating`).
- [ ] Ölçüm: yanlış-pozitif riski ("sorun yok", "şikayetim yok", "eksik bir şey yok") golden sette pinli.
