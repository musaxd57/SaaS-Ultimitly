// ---------------------------------------------------------------------------
// KARAR DÜĞMESİ KİMLİKLERİ — SAF (tasarım §3.10, dilim 3). WhatsApp düğmesinin yükü (şablon hızlı yanıtı / etkileşimli düğme kimliği):
//   · seçim:   `hd.<karar>.<sürüm>.<a|d>`                     — "Karar bekliyor" şablonundaki [Onayla] / [Reddet]
//   · önizleme: `hd.<karar>.<sürüm>.<a|d>.<olgu izi>.<send|cancel>` — önizlemedeki [Gönder] / [Gönderme]
// Sır DEĞİLDİR: yetki her zaman gönderen numaranın bağlantısından ve kartın işletmesinden denetlenir; sürüm eski düğmenin yeni karta
// basmasını, olgu izi (önizlemedeki kartın `decisionFactsHash`i) kontrol listesi değiştikten sonra eski önizlemenin gönderilmesini engeller.
// Meta düğme kimliği sınırı 256 karakter; en uzun biçim ~70.
// ---------------------------------------------------------------------------

export type DecisionButtonAction = "approve" | "decline";

export type DecisionButton =
  | { step: "choose"; decisionId: string; version: number; action: DecisionButtonAction }
  | { step: "send" | "cancel"; decisionId: string; version: number; action: DecisionButtonAction; factsHash: string };

const RE = /^hd\.([a-z0-9]{8,40})\.(\d{1,9})\.([ad])(?:\.([0-9a-f]{24})\.(send|cancel))?$/;

export function decisionButtonId(b: DecisionButton): string {
  const base = `hd.${b.decisionId}.${b.version}.${b.action === "approve" ? "a" : "d"}`;
  return b.step === "choose" ? base : `${base}.${b.factsHash}.${b.step}`;
}

export function parseDecisionButton(id: string): DecisionButton | null {
  const m = RE.exec(id);
  if (!m) return null;
  const decisionId = m[1]!;
  const version = Number(m[2]);
  const action: DecisionButtonAction = m[3] === "a" ? "approve" : "decline";
  if (m[4] === undefined) return { step: "choose", decisionId, version, action };
  return { step: m[5] as "send" | "cancel", decisionId, version, action, factsHash: m[4]! };
}
