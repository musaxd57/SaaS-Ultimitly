import { selectKbForPrompt as selectProduction, type KbSelectInput, type KbSelectResult } from "@/lib/ai/retrieval/select";
import type { KbChunkSource } from "@/lib/ai/retrieval/chunker";
import { KB_RETRIEVAL_MAX_CHUNKS } from "@/lib/ai/limits";

// ---------------------------------------------------------------------------
// Seçim MEKANİĞİ testleri için seçici (09-23). Üretimde küçük-KB eşiği legacy tavanıdır (30 kalem,
// 6k içinde tamamı gider — `docs/olcum/kb-retrieval-parafraz-2026-09-23.md`). Mekanik testlerin
// fikstürleri 13–25 kalemdir; o eşikle hiç seçim yapılmaz ve test ETTİĞİ şeye ulaşamaz. Bu sarmal
// ESKİ eşiği (`maxChunks`, varsayılan 12) AÇIKÇA verir — üretim yolunun geri kalanı birebir aynıdır.
// Üretim eşiğinin kendisi `kb-retrieval-small-kb.test.ts`te sınanır.
// ---------------------------------------------------------------------------
export function selectKbForPrompt<T extends KbChunkSource>(input: KbSelectInput<T>): KbSelectResult<T> {
  return selectProduction({ fullSetMaxItems: input.maxChunks ?? KB_RETRIEVAL_MAX_CHUNKS, ...input });
}
