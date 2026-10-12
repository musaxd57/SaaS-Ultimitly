import { describe, it, expect } from "vitest";
import React, { useState } from "react";
import { treeText } from "../helpers/tree-text";

// ---------------------------------------------------------------------------
// `treeText` yardımcısının kendi pini (DENETIM 08-09 #36, 10-12 gece). Eskiden yalnız altı prop adı toplanıyordu → açılamayan (hook'lu /
// istemci) bileşene başka bir prop'la giden kişisel veri, sayfa testlerinin `not.toContain` iddialarına GÖRÜNMEZDİ (iddia boşa geçerdi).
// ---------------------------------------------------------------------------

/** Hook'lu bileşen: React dışında çağrılınca patlar → yardımcı onu AÇAMAZ, yalnız prop'larını görür (istemci bileşeni gibi). */
function HookCard(props: { guestName?: string; data?: unknown; "aria-label"?: string }) {
  const [x] = useState(0);
  return React.createElement("div", null, String(x), props.guestName);
}
const Pure = (props: { heading: string }) => React.createElement("h2", null, props.heading);
const h = React.createElement;

describe("treeText — metin taşıyan bütün prop'lar", () => {
  it("🚨 açılamayan bileşene düz prop'la giden ad toplanır", () => {
    expect(treeText(h(HookCard, { guestName: "Ayşe Yılmaz" }))).toContain("Ayşe Yılmaz");
  });

  it("🚨 açılamayan bileşenin nesne prop'undaki dizeler toplanır (istemciye serileşir)", () => {
    const text = treeText(h(HookCard, { data: { guest: { name: "Mehmet Kaya", phone: "+90 555" } }, items: [{ t: "Not" }] } as never));
    expect(text).toContain("Mehmet Kaya");
    expect(text).toContain("+90 555");
    expect(text).toContain("Not");
  });

  it("erişilebilirlik etiketi toplanır", () => {
    expect(treeText(h("button", { "aria-label": "Ayşe'ye yaz" }, "Gönder"))).toContain("Ayşe'ye yaz");
  });

  it("açılabilen saf bileşenin çıktısı toplanır (eski davranış korunur)", () => {
    expect(treeText(h(Pure, { heading: "Başlık" }))).toContain("Başlık");
  });

  it("KONTROL: sınıf / bağlantı / kimlik gibi öznitelikler METİN DEĞİL — toplanmaz", () => {
    const text = treeText(h("a", { href: "/inbox/abc", className: "text-red-600", id: "x1" }, "Aç"));
    expect(text).toBe("Aç");
  });
});
