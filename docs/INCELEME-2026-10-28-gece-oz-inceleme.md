# Öz-inceleme (ajansız, satır satır) — 2026-10-28 gece

> Kurucu: "işlerinin tamamı bittikten sonra sen kendin agent çalıştırmadan yaptıklarına çok derin satır satır dosyaları incele, acele etme".
> Kapsam: bugünün kaynak değişiklikleri (28 dosya, `git diff` 10-28 sabah → gece). Her bulgu kodla doğrulandı; düzeltilenler testli.

## Düzeltilenler

| # | Dosya | Bulgu | Düzeltme |
|---|---|---|---|
| Ö1 | `channels/airbnb-message-policy.ts` | İmzadaki "Instagram: @lalekonaklama" ve çıplak alan adı ("lalekonaklama.com") iletişim değeri sayılmıyordu (`containsContactValue` metin içi yanlış pozitif için bilinçli dar) → onaysız Airbnb konuşmasında imzayla gidiyordu; Airbnb sosyal medya hesabını ve bağlantıyı da engeller. | Yalnız İMZA SATIRINDA iki biçim daha: kullanıcı adı (`@…`, e-posta değil) ve yaygın uzantılı çıplak alan adı. "Lale Apt. 2", "Dr. A. Yılmaz" kalır. 3 yeni test, 3 mutant öldürüldü. |
| Ö2 | `semantic/structured-call.ts` | Yorum "zaman aşımı olmayan ağ hatası yeniden denenir" diyordu; gövde okunurken kopan bağlantı ise denenmiyor (kod doğru, yorum eksik). | Yorum: gövde okunurken kopan bağlantı bilinçli olarak geçici sayılmaz (sağlayıcı cevabı üretip ücretlendirmiş olabilir). |
| Ö3 | `tests/unit/part-reader-retry.test.ts` | Mutasyon R5 yaşıyordu: ikinci deneme "kalan süre" yerine tam tavanla koşsa da test fark etmiyordu (ilk hata anında geliyordu). | İlk hatanın 800 ms'de geldiği süre testi (toplam ≈ 2.000 ms; tam tavanla ≈ 2.800 ms). |
| Ö4 | `tests/unit/gate-evidence.test.ts` | Mutasyon L4 yaşıyordu: dil kapısı cevapsız ÖNCEKİ mesajları iz olarak okumasa da test geçiyordu ("Danke!" ile birleşik metinde kod zaten emindi). | Son mesajı iz taşımayan ("OK?") vaka. |

Mutasyon toplamı: 31/31 öldürüldü (4.11 · 4.12 · 4.13 · 4.14 · dil kapısı; ilk koşu 26/28 → iki test güçlendirildi + 3 yeni mutant).

## Bilinen sınırlar (düzeltilmedi, gerekçeli)

| # | Yer | Sınır | Neden bırakıldı |
|---|---|---|---|
| S1 | `kb-export.ts` | İçeriğinde "## Notlar" gibi başlık biçiminde satır olan kalem dışa aktarılıp yeniden yüklenince o satırdan bölünür (içe aktarıcı başlık sanır). | Ev sahibinin elle "#" ile başlayan satır yazması seyrek; çözüm (kaçış işareti) içe aktarıcının da değişmesini ister → ayrı dilim. Veri kaybı yok (bölünür, silinmez). |
| S2 | `embeddings/vector-store.ts` | `KB_TABLE_HEADER` açılıp kapanınca aynı kalemin iki farklı parça metninin satırları birlikte durur (anahtar = girdi özeti). | Okuma girdi özetiyle eşleştiği için yanlış vektör okunmaz; yalnız depolama. Kalem sürümü değişince temizlenir. |
| S3 | `automation.ts` 4.12 | Doğrulanmış parça muafiyeti yalnız kanal oto-cevabında; QR kapısının kendi güven eşiği değişmedi. | Kurucunun 4.12 sorusu kanal örneğiyle soruldu; QR'ı genişletmek ayrı karar. |
| S4 | `semantic/understand.ts` 4.13 | Ücret eki ile anlama katmanı "IBAN gönderin, transferi ödeyeyim" mesajını ödeme + transfer olarak ikiye bölüp transfer fiyatını gönderebiliyor (canlı ölçüm c-02). | Kurucuya soru (karar sayfası 4.13-b) — müşteriye giden metin. |
| S5 | `semantic/absence-judge.ts` 4.13 | Okuyucunun "yalnız fiyat söylemek ödeme değildir" satırı gerçek modelle ÖLÇÜLMEDİ (OpenAI kredisi bitti). | Satır ücret kuralı anahtarının arkasında (kapalı); açmadan önce `airbnb-fee-statements.json` + `airbnb-message-policy.json` ölçülecek. |

## İncelenip sorun bulunmayanlar (kısa)

- `structured-call.ts` yeniden deneme: kalıcı arıza önce sınıflanıyor; `Retry-After` 3 sn tavanlı; ikinci deneme kalan süreyle; zaman aşımı denenmiyor.
- `vector-store.ts`: zaman sınırlı okumada `Promise.race` geç gelen reddi yutuyor (işlenmemiş ret yok); sürüm kilidi (`FOR SHARE`) düzenleme
  yarışını kapatıyor; bozuk satır silinip eksik sayılıyor; temizlik saat değil sürüm eşitliğiyle.
- `chunker.ts` tablo başlığı: CRLF, satır ortasından başlayan parça, tablo içi sahte ayıraç, başlık satırında başlayan parça testli.
- `kb/export` · `kb/template`: yönetici / sahip, bürünmede kapalı, ücretli paket kapısı, saatte 10, denetim kaydı metinsiz, dosya adı ASCII.
- `automation.ts` imza: pencere bir kez hesaplanıyor; kapı, taslak ve gönderilen gövde aynı imzayı görüyor; nezaket cevabı ev sahibinin
  kendi metnindeki değeri çıkarmıyor (yarım cümle olmasın) → gövde denetimi tutuyor.
- `language-signal.ts gateGuestLanguage`: kod eminse kodun hükmü; model yalnız misafirin metninde izi olan dili bildirebilir.
