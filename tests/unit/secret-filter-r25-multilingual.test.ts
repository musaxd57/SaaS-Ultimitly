import { describe, it, expect } from "vitest";
import { qrReplyHasDoorCode, redactDoorCodes, withoutQrSecretKbItems, withoutSecretKbItems } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// SIR SÜZGECİ — "PIN" / İtalyanca / Almanca bileşik / keyless (10-28 gece, Opus ikinci dilim R25; kurucu kararı 10-11 K7: QR'da erişim
// kodu ASLA). Ölçüldü: "The PIN for the front door is 2468.", "Der Türcode lautet 4590.", "Il codice della porta è 4590.", "Keyless: 4590"
// bilgi tabanı süzgecinden de QR çıktı taramasından da geçiyordu — ev sahibi kodu "Genel" bir kaleme İngilizce / Almanca / İtalyanca
// yazdıysa QR'ı okutan herkes alabilirdi. Kök neden: "kod sözcüğü + kapı adı + değer" kalıbının kod sözcüklerinde "pin" / "codice", kapı
// adlarında "porta / portone / ingresso" yoktu; Almanca bitişik bileşik ("Türcode") hiçbir kalıbın sözcük sınırına uymuyordu; "keyless" kilit
// adı değildi. Süzgeç KISITLAYICIDIR (yalnız eler) — ikiz listesi aynı sözcüklerin sır OLMAYAN kullanımlarının elenmediğini pinler.
// ---------------------------------------------------------------------------

const dropped = (content: string, title = "Bilgi") => withoutSecretKbItems([{ title, content }]).length === 0;
const droppedQr = (content: string, category = "general") => withoutQrSecretKbItems([{ category, title: "Bilgi", content }]).length === 0;

const LEAKS = [
  "The PIN for the front door is 2468.",
  "PIN for the main entrance: 2468",
  "Der Türcode lautet 4590.",
  "Haustürcode: 4590",
  "Wohnungstür-Code 4590",
  "Zugangscode 4590",
  "Der Torcode ist 4590.",
  "Il codice della porta è 4590.",
  "Codice del portone: 4590",
  "Il codice dell'ingresso è 4590",
  "Keyless: 4590",
  "Keyless entry lock 4590",
];

const TWINS = [
  // aynı sözcükler, sır yok
  "Drop a pin on the map: Lale Sok. 1453",
  "Il codice postale della porta è 34710",
  "Porta Nuova 1234 metro durağına yürüme mesafesinde.",
  "Keyless entry is available; the code is sent on arrival day by the host.",
  "Torbalı 1500 TL",
  "Adres: Lale Sokak 1453, Kadıköy",
  "Acil durumda 112'yi arayın.",
];

describe("R25 — çok dilli kapı kodu (sızıntılar)", () => {
  it("🚨 bilgi tabanı süzgeci (kanal: rezervasyon öncesi + QR) eler", () => {
    for (const s of LEAKS) expect(dropped(s), s).toBe(true);
  });
  it("🚨 QR kalem süzgeci eler", () => {
    for (const s of LEAKS) expect(droppedQr(s), s).toBe(true);
  });
  it("🚨 QR çıktı taraması kodu yakalar (değer bilgi tabanında geçse de)", () => {
    for (const s of LEAKS) expect(qrReplyHasDoorCode(s, [s]), s).toBe(true);
  });
  it("🚨 geçmiş maskesi değeri gizler", () => {
    expect(redactDoorCodes("The PIN for the front door is 2468.")).not.toContain("2468");
    expect(redactDoorCodes("Der Türcode lautet 4590.")).not.toContain("4590");
    expect(redactDoorCodes("Il codice della porta è 4590.")).not.toContain("4590");
  });
});

describe("R25 — ikizler (aşırı-uygulama kontrolü: sır olmayan kullanım elenmez)", () => {
  it("bilgi tabanı süzgeci ikizleri ELEMEZ", () => {
    for (const s of TWINS) expect(dropped(s), s).toBe(false);
  });
  it("QR çıktı taraması ikizleri kod SAYMAZ", () => {
    for (const s of TWINS) expect(qrReplyHasDoorCode(s, []), s).toBe(false);
  });
  it("Wi-Fi kalemi QR'a girmeye devam eder (Wi-Fi şifresi QR'da verilir — kurucu K7)", () => {
    expect(droppedQr("Wi-Fi: LaleNet / şifre 12345678", "wifi")).toBe(false);
    expect(droppedQr("Wi-Fi ağına bağlanmak için 12345678 girin.", "wifi")).toBe(false);
  });
});
