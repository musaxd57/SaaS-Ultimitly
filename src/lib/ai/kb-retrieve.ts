import type { KbChunkSource } from "@/lib/ai/retrieval/chunker";
import { selectKbForPrompt, type KbSelectInput, type KbSelectResult } from "@/lib/ai/retrieval/select";
import { prepareSemanticScores } from "@/lib/ai/embeddings/semantic-retrieval";

// ---------------------------------------------------------------------------
// BİLGİ SEÇİMİ — YÜZEYLERİN TEK GİRİŞİ (09-23).
//
// Dört AI yüzeyi (oto-yanıt, QR, inbox öneri, Ayarlar testi) bunu çağırır; bu da TEK boğaz
// `selectKbForPrompt`i. Aradaki tek iş anlamsal hazırlıktır (ağ çağrısı burada, seçici SAF ve
// SENKRON kalır). Anahtar (`KB_SEMANTIC_RETRIEVAL`) kapalıyken sonuç `selectKbForPrompt(input)`
// ile BİREBİR aynıdır ve kanıta yeni alan girmez (davranışsal pin).
// ---------------------------------------------------------------------------

export async function retrieveKbForPrompt<T extends KbChunkSource>(input: KbSelectInput<T>): Promise<KbSelectResult<T>> {
  const sem = await prepareSemanticScores(input);
  const result = selectKbForPrompt(sem.bySubquery ? { ...input, semanticBySubquery: sem.bySubquery } : input);
  if (sem.status === "off" || !result.evidence) return result;
  return { ...result, evidence: { ...result.evidence, sem: sem.status, semMs: sem.ms } };
}
