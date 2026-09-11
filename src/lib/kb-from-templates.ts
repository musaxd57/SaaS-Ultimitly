// ---------------------------------------------------------------------------
// KNOWLEDGE HUB — ŞABLONLARDAN KB ÖNERİSİ (kurucu kararı, 09-11).
//
// Kurucu, "AI'yı boş bilgiyle açtırma" KAPISINI REDDETTİ ve doğru çözümü söyledi:
//   *"zorunlu olmasın; adam platformunu bağladığında hemen otomatik mesajlarından,
//    şablonundan veya kendi yazdığı cevaptan görsün, böylece otomatik bulmuş olur"*
//
// 🚨 ÖLÇÜLEN BOŞLUK: `MessageTemplate` misafire AYNEN gider ve **modelden HİÇ
// GEÇMEZ** (CLAUDE.md: "Şablonlar modelden GEÇMEZ"). Yani host "Wi-Fi bilgisi"
// şablonu yazmışsa bilgi SİSTEMDE VARDIR ama asistan onu KULLANAMAZ — misafir
// "Wi-Fi şifresi nedir?" diye sorduğunda ürün devreder. Bu modül o boşluğu
// kapatır: şablonu KB ÖNERİSİNE çevirir, host onaylarsa asistan da kullanır.
//
// 🚨 SAF: LLM YOK, DB YOK, AĞ YOK, MIGRATION YOK. Girdi listeler, çıktı ÖNERİ.
// Hiçbir şey kaydetmez. Kabul `POST /api/kb` yolundan gider (host_manual/approved).
// ---------------------------------------------------------------------------

import { kbPlaceholderTokens } from "./ai/prompts";
import { TEMPLATE_VAR_SOURCE } from "./template-apply";

export const TEMPLATE_SUGGESTION_MAX_CHARS = 2_000;

/**
 * Şablon kategorisi → KB kategorisi.
 *
 * 🚨 LİSTE ÇOK DAR VE HER DIŞARIDA KALANIN ÖLÇÜLMÜŞ GEREKÇESİ VAR. Bu bacak
 * KALICI BİLGİ üretir (asistan onu gerçek sanar), o yüzden yön fail-closed:
 *
 *  · `complaint_response` — şikâyet yanıtı BİLGİ DEĞİL, tek bir misafire verilen
 *    KARARDIR (Bacak B'deki `NON_KNOWLEDGE` gerekçesinin aynısı); kalıcı kural
 *    sanılırsa ürün yanlış söz verir.
 *  · `checkin`/`checkout` — bu şablonlar neredeyse her zaman SAAT içerir
 *    ("Girişiniz 15:00'ten sonra") ve giriş/çıkış saati bir MÜLK ALANIDIR. KB'ye
 *    ikinci kopya çıkarmak ÇİFT KOPYA YASAĞIDIR; dahası iki kaynak çelişirse
 *    retrieval'ın çelişki koruması devreye girer ve misafire saat SÖYLENMEZ —
 *    yani var olmayan bir çelişki YARATIP ürünü kötüleştirirdik (E7 gerçek
 *    koşuda tam bu davranışı gösterdi: çelişkide kesin saat yok, devir var).
 *    ⚠️ Giriş TALİMATI (kapı kodu, kat, asansör) gerçek bilgidir; onu almak için
 *    saat cümlesini ayıklayan ayrı bir tur gerekir — bu dilimde YOK.
 *  · 🚨 `welcome` — SIR KAPISINI ZAYIFLATIR (inceleme ajanı, 09-11). Karşılama
 *    metni rutin olarak kapı kodu/Wi-Fi taşır; aynı metin `wifi`/`checkin`
 *    kategorisindeyken QR'da İKİ bacaktan (kategori listesi `QR_SECRET_CATEGORIES`
 *    + içerik sezgiseli `withoutSecretKbItems`) elenir, `welcome` kategorisinde
 *    YALNIZ içerik sezgiselinden. Sezgisel bilinçli olarak DAR (4–8 hane bitişik
 *    kalıp); harfle yazılmış bir kod kategori bacağının duracağı yerde geçer.
 *    Kategori seçimini bir ÖNERİ mekanizmasının yapması bu farkı görünmez kılar.
 *  · 🚨 `general` — ölçüldü: gerçek içerik NEZAKET İSKELESİ ("Mesajınızı aldım,
 *    en kısa sürede dönüş yapacağım"). Bu KB'ye girerse model MAKBUZSUZ SÖZÜ
 *    onaylı bilgi olarak okur — 09-09'da `prompts.ts`ten TAM BU SINIF silinmişti;
 *    KB üzerinden geri girmesi `actionReceipt`in göremediği bir arka kapıdır.
 *
 * Genişletme bir ÖLÇÜM sorusudur (gerçek host şablonlarında bilgi oranı), tahmin
 * değil. Bugünkü iki kategori misafirin EN SIK sorduğu iki konudur.
 */
export const TEMPLATE_CATEGORY_TO_KB: Readonly<Record<string, string>> = {
  wifi: "wifi",
  rules: "rules",
};

/**
 * Şablon DEĞİŞKENLERİ (`{{…}}`) — KB'ye OLDUĞU GİBİ TAŞINAMAZ.
 *
 * 🚨 ÖLÇÜLDÜ (inceleme ajanı, 09-11): `kbPlaceholderTokens` yalnız `[…]`, `<…>`
 * ve `___` sınıfını tanır; `{{…}}` HİÇBİR kapıya takılmaz. Yani bu bacak
 * düzeltilmeden önce varsayılan Wi-Fi şablonunu "Wi-Fi bilgileriniz: {{wifiInfo}}"
 * diye ONAYLI BİLGİ yapıyordu ve model bunu misafire söyleyecek gerçek sanıyordu.
 *
 * İki kural:
 *  · `{{guestName}}` → `{isim}` ÇEVRİLİR. Tek parantez sınıfı ürünün KENDİ
 *    belirtecidir ve DÖRT yüzeyde de çözülür (`kb-placeholders.ts`); bilgi
 *    kaybı yok, karşılığı var.
 *  · BAŞKA HER `{{…}}` → şablon TAMAMEN REDDEDİLİR. `{{wifiInfo}}`,
 *    `{{checkInTime}}`, `{{propertyName}}` bilgi DEĞİL, başka bir kayda
 *    İŞARETÇİDİR — `{{wifiInfo}}` tam olarak KB'nin wifi kalemine işaret eder,
 *    yani o şablondan üretilen kalem KENDİNE atıf yapardı. İşaretçi taşıyan
 *    şablonun kendi başına anlattığı bir gerçek yoktur.
 */
const TEMPLATE_VAR_G = new RegExp(TEMPLATE_VAR_SOURCE, "g");
/**
 * 🚨 FAIL-CLOSED SÜPÜRGE (inceleme ajanı 09-11): yukarıdaki kalıp `\w`
 * kullanıyor ve `\w` ASCII'dir — `{{misafirAdı}}` (ı), `{{property.name}}` (.),
 * `{{guest-name}}` (-) HİÇBİRİ eşleşmiyordu, yani "başka her `{{…}}` REDDEDİLİR"
 * kuralı tam da tanımadığı biçimlerde FAIL-OPEN'dı ve o metin ONAYLI BİLGİ olup
 * misafire ham gidebiliyordu. Çevrimden SONRA hâlâ `{{` varsa şablon düşer.
 */
const ANY_DOUBLE_BRACE = /\{\{[^}]*\}\}|\{\{/;
/** KB tarafında karşılığı olan tek şablon değişkeni. */
const CONVERTIBLE_VARS: Readonly<Record<string, string>> = { guestName: "{isim}" };

export interface TemplateSource {
  id: string;
  /** `null` = org geneli (tüm mülkler için yazılmış). */
  propertyId: string | null;
  category: string;
  title: string;
  body: string;
  language?: string | null;
  isActive: boolean;
}

export interface ExistingKbItem {
  propertyId: string;
  category: string;
}

export interface PropertyRef {
  id: string;
  name: string;
}

export interface KbSuggestionFromTemplate {
  propertyId: string;
  propertyName: string;
  category: string;
  title: string;
  content: string;
  language: string;
  /** Şablonun kendisi (iz; host "bu nereden geldi" diye sorabilir). */
  sourceTemplateId: string;
  /** Org geneli bir şablondan mı türedi (host'a açıkça söylenir). */
  fromOrgWide: boolean;
}

export interface TemplateSuggestionOptions {
  /**
   * Org'un kendi dili. Aynı mülk+kategoriye düşen İKİ şablon varsa (ürün TR+EN
   * çiftleri ile geliyor) bu dildeki tercih edilir — ikisini birden önermek
   * host'a aynı bilgiden İKİ kalem yaptırırdı ve çelişirlerse retrieval'ın
   * çelişki koruması misafire hiçbir şey söylemezdi.
   */
  preferredLanguage?: string;
}

/** Kelime sınırında keser (ortadan bölmez). */
function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/**
 * Şablon gövdesini KB içeriğine çevirir; çevrilemiyorsa `null` (şablon düşer).
 * Tek geçiş + callback (değerdeki `$&` kalıpları özel anlam kazanmasın).
 */
export function templateBodyToKbContent(body: string): string | null {
  let rejected = false;
  const converted = body.replace(TEMPLATE_VAR_G, (whole, key: string) => {
    const mapped = Object.hasOwn(CONVERTIBLE_VARS, key) ? CONVERTIBLE_VARS[key] : undefined;
    if (mapped === undefined) {
      rejected = true;
      return whole;
    }
    return mapped;
  });
  if (rejected) return null;
  // Tanınmayan/bozuk biçimli çift parantez → fail-closed.
  if (ANY_DOUBLE_BRACE.test(converted)) return null;
  // Doldurulmamış alan sınıfı (`[ŞİFRE]`/`<adres>`/`___`) → uydurma değer riski.
  if (kbPlaceholderTokens(converted).length > 0) return null;
  return converted;
}

/**
 * Şablonlardan KB önerileri üretir.
 *
 * Kurallar (hepsi test-pinli):
 *  · yalnız AKTİF şablon, kategori allowlist'te olmalı (fail-closed)
 *  · 🚨 hedef mülkte O KATEGORİDE zaten AI'nın OKUYABİLDİĞİ kalem varsa
 *    ÖNERİLMEZ — ürün host'a bildiği şeyi tekrar sormaz ve çift kopya üretmez.
 *    (Çağıran, onaysız taslağı `existingKb`'ye KOYMAMALI: asistan taslağı
 *    okuyamaz, yani o kategori hâlâ boştur.)
 *  · 🚨 aynı mülk+kategoriye düşen İKİNCİ şablon ÖNERİLMEZ (TR/EN çifti)
 *  · 🚨 `{{…}}` şablon değişkeni taşıyan gövde REDDEDİLİR (`{{guestName}}`
 *    hariç — o `{isim}`'e çevrilir), doldurulmamış `[ŞİFRE]` sınıfı da
 *  · mülke bağlı şablon → o mülk; org geneli şablon → O KATEGORİYİ EKSİK olan
 *    her mülk (boşluğu dolduran yön; dolu mülke dokunmaz)
 */
export function buildKbSuggestionsFromTemplates(
  templates: readonly TemplateSource[],
  existingKb: readonly ExistingKbItem[],
  properties: readonly PropertyRef[],
  options: TemplateSuggestionOptions = {},
): KbSuggestionFromTemplate[] {
  const preferred = (options.preferredLanguage ?? "tr").toLowerCase();
  const have = new Set(existingKb.map((k) => `${k.propertyId}|${k.category}`));
  const nameById = new Map(properties.map((p) => [p.id, p.name]));
  const out: KbSuggestionFromTemplate[] = [];

  // Org dilindeki şablon önce denenir; ilk gelen (property, category) yuvasını
  // kapatır. Sıra bunun DIŞINDA korunur (çağıranın `createdAt` sırası).
  // 🚨 ÖZGÜLLÜK ÖNCE, SONRA DİL (inceleme ajanı 09-11): org geneli şablon önce
  // işlenirse tüm mülklerin yuvasını kapatır ve MÜLKE ÖZEL şablon bir daha
  // önerilemez. ÖLÇÜLDÜ: org geneli "Wi-Fi bilgisini ev sahibinizden isteyiniz"
  // + Daire 3'e özel "Ağ: Daire3_5G, şifre 8821" → host'a GENEL metin gösteriliyor,
  // doğru olan hiç görünmüyordu. Sonuç yaratma sırasına bağlıydı, yani rastgele.
  const ordered = [...templates].sort(
    (a, z) =>
      (a.propertyId ? 0 : 1) - (z.propertyId ? 0 : 1) ||
      langRank(a.language, preferred) - langRank(z.language, preferred),
  );

  for (const t of ordered) {
    if (!t.isActive) continue;
    const category = TEMPLATE_CATEGORY_TO_KB[t.category];
    if (!category) continue;
    const body = (t.body ?? "").trim();
    if (!body) continue;
    const content = templateBodyToKbContent(body);
    if (content === null) continue;

    const targets = t.propertyId ? [t.propertyId] : properties.map((p) => p.id);
    for (const propertyId of targets) {
      // TEK kapı: hem "zaten KB'de var" hem "bu turda başka şablon kapattı" hem
      // de kapsam dışı mülk (`nameById`) buradan elenir.
      const slot = `${propertyId}|${category}`;
      if (have.has(slot)) continue;
      const propertyName = nameById.get(propertyId);
      if (propertyName === undefined) continue; // org dışı / filtre dışı mülk
      have.add(slot);
      out.push({
        propertyId,
        propertyName,
        category,
        title: clip(t.title || "Bilgi", 300),
        content: clip(content, TEMPLATE_SUGGESTION_MAX_CHARS),
        language: t.language || "tr",
        sourceTemplateId: t.id,
        fromOrgWide: t.propertyId === null,
      });
    }
  }

  // Deterministik sıra: mülk, sonra kategori.
  out.sort((a, z) => a.propertyId.localeCompare(z.propertyId) || a.category.localeCompare(z.category));
  return out;
}

function langRank(language: string | null | undefined, preferred: string): number {
  return (language ?? "tr").toLowerCase() === preferred ? 0 : 1;
}
