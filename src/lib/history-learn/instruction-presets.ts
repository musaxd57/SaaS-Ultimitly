// ---------------------------------------------------------------------------
// DAİRE TALİMATI — HAZIR SEÇENEKLER (kurucu 10-15: "Müşteri, hazır seçeneklerden seçsin"). YAPRAK modül (veritabanı / sunucu içe
// aktarmaz — panel bileşeni de kullanır). Müşteri (host) serbest metin YAZMAZ; yalnız bu listeden açar / kapatır. Serbest metin yalnız
// operatörde (`propertyInstructionsAllowed`). Liste operatörün (kurucunun) yönettiği kapalı kümedir: hepsi üslup / anlatım tercihi —
// bilgi, para, güvenlik ya da kod konusu YOK. Yeni seçenek = bu listeye satır + testteki kapı pini (her metin `checkInstruction`dan
// geçer; isteme girerken de yeniden koşar).
//
// 🚨 Seçenek temel istem kurallarının YALNIZ İÇİNDE daraltır (Haiku 10-15 incelemesi, `prompts.ts` ile ölçüldü): "madde madde anlat"
// liste yasağıyla (BÖLÜM 10), "en fazla bir soru sor" gereksiz soru yasağıyla (BÖLÜM 11 — soru dayatıyordu; temel kural zaten en fazla
// bir soru der), "kapanış cümlesi yazma" zorunlu devir olgu cümlesiyle ("Mesajınız kaydedildi; ev sahibiniz görebilir.") çelişiyordu →
// kaldırıldı / yeniden yazıldı. "Giriş" sözcüğü kullanılmaz (giriş talimatı onaylanmamış rezervasyonda paylaşılmaz; "selamlama girişi"
// ile de karışıyordu). Adımlar yalnız bilgi tabanında VARSA anlatılır (genel bilgiden adım uydurulmaz).
// ---------------------------------------------------------------------------

export interface InstructionPreset {
  key: string;
  /** Ekrandaki ad (kısa). */
  label: string;
  /** Ekrandaki açıklama — ne değişir. */
  description: string;
  /** İsteme giren metin (talimat bloğuna aynen). */
  text: string;
}

export const INSTRUCTION_PRESETS: readonly InstructionPreset[] = [
  {
    key: "short",
    label: "Kısa cevap",
    description: "Cevaplar olabildiğince kısa olur.",
    text: "Cevapları olabildiğince kısa yaz; misafirin sorusu için gerekmeyen cümle ekleme.",
  },
  {
    key: "no_emoji",
    label: "Emoji kullanma",
    description: "Cevaplarda emoji olmaz.",
    text: "Cevaplarda emoji kullanma.",
  },
  {
    key: "simple_language",
    label: "Sade dil",
    description: "Kısa, basit cümleler. Yabancı misafiri çok olan daireler için.",
    text: "Kısa ve basit cümleler kur; deyim ve argo kullanma.",
  },
  {
    key: "device_steps",
    label: "Cihaz kullanımını adım adım anlat",
    description: "Bir cihazın nasıl kullanılacağı sorulunca bilgi tabanındaki adımlar sırayla anlatılır.",
    text: "Bir cihazın nasıl kullanılacağı sorulduğunda, bilgi tabanında adımlar varsa onları sırasıyla, kısa cümlelerle anlat; bilgi tabanında olmayan adım ekleme.",
  },
];

export const PRESET_KEYS: readonly string[] = INSTRUCTION_PRESETS.map((p) => p.key);

export function presetByKey(key: string): InstructionPreset | undefined {
  return INSTRUCTION_PRESETS.find((p) => p.key === key);
}
