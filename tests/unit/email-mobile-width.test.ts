import { describe, it, expect } from "vitest";
import {
  complaintEscalationEmail,
  decisionPendingEmail,
  hostReplyWaitingEmail,
  qrEscalationEmail,
  reservationCreatedEmail,
  taskAssignedEmail,
  trialEndedEmail,
  trialEndingSoonEmail,
} from "@/lib/email-templates";
import { identityEmailShell } from "@/lib/email-shell";

// ---------------------------------------------------------------------------
// E-postalar telefonda ekrana sığar (görsel inceleme 10-22, Chromium'da 390 / 320 px ölçüldü): ev sahibi bildirimleri 632 px (uzun bağlantılı
// misafir mesajıyla 1.387 px), kimlik e-postaları 512 px genişliğindeydi. Sebep: kart tablosunun CSS'i `width:600px;max-width:100%` (ya da
// yalnız `width="600"` niteliği) — tablo düzeninde sabit CSS genişliği hücrenin en küçük genişliği olur, `max-width:100%` kazanamaz. Doğru
// desen ("akışkan melez"): Outlook için `width="600"` NİTELİĞİ + CSS `width:100%;max-width:600px`; içerik hücresi uzun sözcüğü böler.
// ---------------------------------------------------------------------------

const prop = { name: "Lale", address: null, city: "İstanbul" };
const convo = { id: "c1", guestIdentifier: "Misafir", channel: "airbnb", priority: "standard" };
const HOST_EMAILS: Array<[string, string]> = [
  ["görev atandı", taskAssignedEmail({ id: "t1", title: "Temizlik", type: "cleaning", priority: "standard", status: "todo" }, { name: "Ayşe", email: "a@b.c" }, prop)],
  ["şikâyet", complaintEscalationEmail(convo, "Klima çalışmıyor", prop, "Lale")],
  ["cevap bekliyor", hostReplyWaitingEmail(convo, "Wi-Fi şifresi?", prop, "Lale")],
  ["karar bekliyor", decisionPendingEmail({ title: "13:00 erken giriş", dayLabel: null, guestIdentifier: "Misafir", propertyName: "Lale", orgName: "Lale", panelUrl: "https://x.test/inbox/c1" })],
  ["yeni rezervasyon", reservationCreatedEmail({ id: "r1", guestName: "Misafir", arrivalDate: new Date(), departureDate: new Date(), channel: "airbnb", status: "confirmed" }, prop)],
  ["deneme bitiyor", trialEndingSoonEmail(3, "https://x.test/settings")],
  ["deneme bitti", trialEndedEmail("https://x.test/settings")],
  ["QR devri", qrEscalationEmail("Lale", "ai_escalated", "https://x.test/guest-chats/x")],
];

describe("ev sahibi e-postaları telefonda sığar", () => {
  for (const [name, html] of HOST_EMAILS) {
    it(`${name}: kart Outlook niteliği + akışkan CSS genişliği; içerik uzun sözcüğü böler`, () => {
      const card = /<table width="600"[^>]*>/.exec(html)?.[0] ?? "";
      expect(card, "kart tablosu").not.toBe("");
      expect(card).toContain("width:100%;max-width:600px");
      // Eski desen telefonda 600 px'te kalıyordu — geri gelmesin.
      expect(card).not.toMatch(/(^|[;"])\s*width:600px/);
      expect(html).toMatch(/overflow-wrap:anywhere/);
      // Outlook (Word motoru) `max-width` okumaz: yalnız onun gördüğü sabit 600 px "hayalet tablo" kartı sarar (Haiku 10-22).
      expect(html).toMatch(/<!--\[if mso\]><table role="presentation" width="600"[^>]*><tr><td><!\[endif\]-->\s*<table width="600"/);
      expect(html).toContain("<!--[if mso]></td></tr></table><![endif]-->");
    });
  }
});

describe("kimlik e-postası kabuğu telefonda sığar", () => {
  it("iç tablo `width=\"480\"` niteliği + CSS `width:100%;max-width:480px`", () => {
    const html = identityEmailShell({ heading: "Doğrulayın", intro: "Merhaba", action: { label: "Doğrula", url: "https://x.test/#t=a" }, footnote: "Not" });
    // Biçimli iç tablo (Outlook'un hayalet tablosu `style` taşımaz — onu atla).
    const inner = /<table role="presentation" width="480"[^>]*style="[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
    expect(inner, "iç tablo").not.toBe("");
    expect(inner).toContain("width:100%;max-width:480px");
    expect(inner).not.toMatch(/(^|[;"])\s*width:480px/);
    expect(html).toMatch(/<!--\[if mso\]><table role="presentation" width="480"[^>]*><tr><td><!\[endif\]-->\s*<table role="presentation" width="480"/);
    expect(html).toContain("<!--[if mso]></td></tr></table><![endif]-->");
  });
});
