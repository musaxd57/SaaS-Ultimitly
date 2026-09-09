# Host analizi baseline — basit graf sorguları, sentetik veri (2026-09-09)

> Veri: `tests/helpers/graph-synthetic.ts` (40 konaklama, şablon mesajlar, sinyal/görev kural tabanlı; GERÇEK misafir metni YOK).
> Altın cevaplar üreticiden. LightRAG/HippoRAG tarafı ONAY sonrası aynı `messages[]` + `HOST_QUESTIONS` ile eklenir (tasarım §6.2).

| Tohum | Sinyal (30g) | H1 kategori→konaklama | H2 kanıt sınıfı | H2 çeldirici (bağsız sayılan / üretilen) | H3 konuşma-bağlı (graf / altın) | H4 cihaz/varlık |
|---|---|---|---|---|---|---|
| 7 | 14 | ✅ birebir | ✅ birebir | 3 / 3 | 0 / 0 | CEVAPLANAMAZ (beklenen) |
| 11 | 12 | ✅ birebir | ✅ birebir | 4 / 4 | 3 / 3 | CEVAPLANAMAZ (beklenen) |
| 23 | 19 | ✅ birebir | ✅ birebir | 4 / 4 | 7 / 7 | CEVAPLANAMAZ (beklenen) |

## Sorular
- **H1** Son 30 günde hangi sorun kategorileri tekrar etti ve kaç FARKLI konaklamada? — gerek: kategori → farklı konaklama sayısı
- **H2** Tekrar eden sorunlardan hangileri için görev açılmadı, hangileri açık, hangileri tamamlandı? — gerek: kategori → kanıt sınıfı; YALNIZ bildirime bağlı görev sayılır, başka konaklamanın eski işi sayılmaz
- **H3** Konaklamaya yalnız konuşma üzerinden bağlanan bildirim kaç tane? — gerek: sinyal → konuşma → konaklama çözümü
- **H4** Hangi CİHAZ/konu (klima, sıcak su, wifi…) en çok bildirildi? — gerek: kapalı-küme kategorinin ÖTESİ — mesaj METNİNDEN varlık; basit graf CEVAPLAYAMAZ, LightRAG hedefi

## Okuma
- H1–H3 DB-gerçek ilişkilerle tam; LLM'e ihtiyaç yok. H4 (mesaj metninden cihaz) LightRAG/HippoRAG'ın tek aday katkısı; ölçüm onay sonrası, sentetik metinle.
- H2 görev kanıtı YALNIZ bildirime bağlı görevlerden (mesaj bağı = observed, konaklama+kategori = inferred); başka konaklamanın tamamlanmış işi (çeldirici) `unlinkedTasks` olarak AYRI görünür, sınıfı değiştirmez (Codex 09-09).
- Basit grafın maliyeti sıfır model çağrısı; kenarlar kaynak+zaman taşır; 'doğrulanmış arıza' hiçbir dalda üretilmez.
