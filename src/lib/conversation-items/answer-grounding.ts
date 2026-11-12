// ---------------------------------------------------------------------------
// CEVAPLANAN İSTEĞİN DAYANAĞI — kaba ama kodla okunan ön şart (S3 ölçümü 11-12; saf).
//
// Ölçüm (`docs/olcum/live-pipeline-2026-11-12-…-held-pet-unknown-dev-…`): evcil hayvan isteği ev sahibine bırakılmışken yanındaki soru
// bilgi tabanında YOKSA cevap modeli 5 denemenin 5'inde cevap uydurdu ("Dairede ütü bulunmaktadır." · "Kahvaltı servisi bulunmuyor." ·
// marketin mesafesini eczaneye yazdı) ve cevap bütün kapılardan geçti: güven yüksek, kaynak beyanı var, "150 metre" bilgi tabanında
// geçiyor (ama marketin). Aynı sorular TEK BAŞINA sorulunca 5/5 tutuluyor. Bugün bu taslakları evcil hayvan kemeri tesadüfen tutuyor;
// kemer daralınca (S3) misafire giderdi.
//
// Kural: cevaplandığı beyan edilen HER isteğin konusu, modele gösterilen kaynaklardan en az birinde geçmeli — bilgi tabanı kalemi
// (`answer-binding.sourceMentionsNeed`: cevap parçaları doğrulayıcısının AYNI konu okuması) ya da, giriş / çıkış saati sorusunda, mülkün
// kendi alanı. Geçmiyorsa istek dayanaksız cevaplanmıştır → çağıran cevabı TUTAR. Bu bir ÖN ŞARTTIR (konu hiç yoksa cevap uydurmadır);
// konu varken değerin doğru aktarıldığını sınamaz — o, cevap parçaları kipinin işidir (`ai/answer-parts.ts`).
//
// 🚨 KABA (Opus 11-12, kodla doğrulandı): `sourceMentionsNeed` bilerek geniş bir ön süzgeçtir — isteğin TEK bir sözcüğü ya da kaba sözlük
// konusu herhangi bir kalemde geçince "dayanak var" der. Kahvaltı sorusu "restoran önerileri" kalemiyle, "mutfakta mikrodalga" sorusu
// "mutfakta bulaşık makinesi" kalemiyle, Wi-Fi HIZI sorusu Wi-Fi şifresi kalemiyle dayanaklı sayılır. Bu yüzden TEK BAŞINA güvence
// değildir: çağıran dal ayrıca kodun doğruladığı cevap parçalarını şart koşar (`automation.ts`); burası onun ucuz, ek kemeridir.
// ---------------------------------------------------------------------------

import { sourceMentionsNeed } from "@/lib/ai/answer-binding";
import type { ItemKind } from "./core";

export interface GroundingNeed {
  ref: string;
  /** İsteğin türü (plan sırasından okunur); bilinmiyorsa yalnız bilgi tabanına bakılır. */
  kind?: ItemKind;
  /** İsteğin kendi sözcükleri (`topic-absence.needTerms`) ve sözlük konuları. */
  terms: readonly string[];
  topics: readonly string[];
}

/** Cevabı bilgi tabanından değil mülkün kendi alanından gelen türler → o alan doluysa dayanak vardır. */
const PROPERTY_FIELD_OF: Partial<Record<ItemKind, "checkIn" | "checkOut">> = { checkin_time: "checkIn", checkout_time: "checkOut" };

/**
 * Cevaplandığı beyan edilen isteklerden DAYANAKSIZ olanların kimlikleri (boş = hepsinin konusu bir kaynakta geçiyor). Tanınmayan kimlik
 * dayanaksız sayılır (bilinmiyor = tut). Saf; kalem sayısı × istek sayısı kadar doğrusal okuma.
 */
export function ungroundedAnsweredRefs(input: {
  needs: readonly GroundingNeed[];
  answeredRefs: readonly string[];
  /** Modele giden bilgi tabanı kalemlerinin metni (`kbFactsOf`). */
  kbFacts: readonly string[] | null | undefined;
  /** Mülkün giriş / çıkış saati alanları. */
  stayTimes?: { checkIn?: string | null; checkOut?: string | null } | null;
}): string[] {
  const facts = (input.kbFacts ?? []).filter((f) => typeof f === "string" && f.trim() !== "");
  const out: string[] = [];
  for (const ref of input.answeredRefs) {
    const need = input.needs.find((n) => n.ref === ref);
    if (!need) {
      out.push(ref);
      continue;
    }
    const field = need.kind ? PROPERTY_FIELD_OF[need.kind] : undefined;
    if (field && (input.stayTimes?.[field] ?? "").trim() !== "") continue;
    if (facts.some((f) => sourceMentionsNeed(f, need.terms, need.topics))) continue;
    out.push(ref);
  }
  return out;
}
