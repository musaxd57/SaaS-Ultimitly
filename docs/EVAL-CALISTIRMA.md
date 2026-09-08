# Gerçek model eval'i — nasıl koşulur

> 🚨 **Bu ortamda (Claude konteyneri) KOŞULAMADI: `OPENAI_API_KEY` yok.** Harness hazır ve tek komutla
> çalışır; sonuçları koşan kişi paylaşınca `docs/olcum/eval-<tarih>.md` olarak repoya girer.
> Bu belgede yazan hiçbir sayı "ölçüldü" diye sunulmuyor — henüz ölçülmedi.

## Neden ayrı
Mevcut suite'teki QR testleri modeli **mock'lar**: ölçtükleri şey ürünün davranışı (devir mi cevap mı,
sayaçlar, sızıntı yok). Modelin **kendi cümlesinin** kalitesi orada ölçülmez ve ölçülüyormuş gibi
sunulmamalı (kurucu kuralı: mock testlerini gerçek eval'den ayır).

## 🔐 Anahtar Claude'a GÖSTERİLMEZ

Bu koşuyu **sen kendi makinende** yaparsın; anahtar bu sohbete, bu repoya ya da herhangi bir log'a
girmez. Kurallar:
- Anahtarı **sohbete yapıştırma** — ne tam, ne kısaltılmış.
- **Repoya yazma**: `.env` dosyası commit'lenmez (`.gitignore`'da), ama en güvenlisi hiç dosyaya
  yazmamak; komutun ortam değişkeni olarak ver.
- Terminal geçmişine düşmesin: PowerShell'de aşağıdaki blok anahtarı **gizli** okur ve iş bitince
  ortam değişkenini SİLER.
- Bana yalnız **üretilen rapor dosyasını** (`docs/olcum/eval-<tarih>.md`) ya da içeriğini yolla.
  O dosyada anahtar YOKTUR — yalnız soru, modelin cevabı, güven ve sonuç var.

### PowerShell (Windows — anahtar ekranda görünmez, sonra silinir)

```powershell
cd C:\yol\SaaS-Ultimitly          # repo klasörün
$secure = Read-Host 'OPENAI_API_KEY' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $env:RUN_REAL_EVAL  = '1'
  npx vitest run tests/eval
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Item Env:OPENAI_API_KEY, Env:RUN_REAL_EVAL -ErrorAction SilentlyContinue
}
```

### macOS / Linux
```bash
read -rs -p "OPENAI_API_KEY: " OPENAI_API_KEY; echo
RUN_REAL_EVAL=1 OPENAI_API_KEY="$OPENAI_API_KEY" npx vitest run tests/eval
unset OPENAI_API_KEY
```

**Ön koşul:** `npm ci` (bir kez) — eval veritabanı İSTEMEZ ama vitest kendi test PG'sini ayağa
kaldırır, o yüzden repo kurulu olmalı. Süre: 8 senaryo × ~2-5 sn.

## Kapılar

⚠️ Yukarıdaki bloklar anahtarı komut satırına YAZDIRMAZ; `OPENAI_API_KEY=sk-... npx ...` gibi bir
yazım anahtarı kabuk geçmişine ve süreç listesine düşürür — kullanma.

İki kapı birden gerekir: `RUN_REAL_EVAL=1` **ve** gerçek bir anahtar (20+ karakter, `test-` ile
başlamayan). Biri eksikse senaryolar **atlanır** — sahte bir "geçti" üretilmez. CI'da anahtar yoktur,
dolayısıyla orada da koşmaz; bu bilinçli (gerçek çağrı para harcar ve deterministik değildir).

Model seçimi `OPENAI_MODEL` ile; verilmezse ürünün varsayılanı kullanılır.

## Veri seti
`evals/qr-kb-coverage.json` — **sürümlü**, anonim, 8 senaryo. Gerçek misafir metni/adı YOKTUR.
Her senaryonun bir `why` alanı var: neyin neden ölçüldüğü yazılı.

| # | Ne ölçüyor |
|---|---|
| E1 | Boş bilgi tabanında somut iddia UYDURMUYOR mu (düşük güven → devir) |
| E2 | Kayıt varken cevap ona DAYANIYOR ve kaynak beyan ediliyor mu |
| E3 | Kayıt var diye KAPSAM DIŞI soruya "vardır" diyor mu |
| E4 | Yer tutucuyu (`[ŞİFRE]`) gerçek sanıp misafire gönderiyor mu |
| E5 | Bağlamda olmayan kapı kodunu uyduruyor mu |
| E6 | Türkçe olumsuz fiilli şikayeti ("sıcak su gelmiyor") doğru sınıflandırıyor mu — **ölçülmüş açık** |
| E7 | KB ile mülk ayarı ÇELİŞİRKEN kesin konuşuyor mu |
| E8 | Tek mesajdaki iki soruyu da yanıtlıyor ve iki kaynağı da beyan ediyor mu |

## Grader
**LLM grader YOK.** Her senaryo deterministik kontrol taşır: metin içerir/içermez, güven eşiği, beyan
edilen kaynaklar, rakam kalıbı. Bir modelin başka bir modeli puanlaması güvenlik kanıtı değildir.

Ek kapı: model çağrılamazsa (ağ/kota) `suggestReply` fallback'e düşer — o durumda koşu **geçersiz**
sayılır (`source === "openai"` assert'i), sessizce "geçti" denmez.

## Sonuç nereye yazılır
`docs/olcum/eval-<YYYY-MM-DD>.md` — her senaryo için modelin cevabı, güveni, beyan/doğrulanan kaynak
sayısı ve düşen kontroller. Dosya koşu tarafından ÜRETİLİR, elle yazılmaz.

## Ne zaman gerekir
- `QR_INFORMATIONAL_BAND_ENABLED` bayrağı **bu eval bitmeden AÇILMAZ** (kurucu kararı).
- Model değişiminden önce baseline, sonra kıyas.
- Prompt'a dokunan her turda.
