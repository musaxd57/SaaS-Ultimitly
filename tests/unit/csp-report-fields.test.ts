import { describe, it, expect } from "vitest";
import { CSP_INVALID, CSP_OTHER, cspDirectiveForLog, cspDispositionForLog, cspUrlForLog } from "@/lib/csp-report-fields";

// F09 (Codex 09-05): kimliksiz CSP rapor ucunun log alanları. Rota davranışı `tests/integration/csp-report-route.test.ts`.

describe("cspUrlForLog — origin + rota şablonu", () => {
  it("🚨 taşıyıcı ebeveynin ardındaki segment :token olur — harf-yalnız token da (genel kural onu 'ekran adı' sanardı)", () => {
    expect(cspUrlForLog("https://www.lixusai.com/c/abcdefabcdefabcdef")).toBe("https://www.lixusai.com/c/:token");
    // Ebeveyn büyük/küçük harf duyarsız eşleşir; "C" segmentinin kendisi genel kuralla :id olur (büyük harf).
    expect(cspUrlForLog("https://www.lixusai.com/C/abcdefabcdefabcdef/")).toBe("https://www.lixusai.com/:id/:token");
    expect(cspUrlForLog("https://www.lixusai.com/api/chat/abcdef")).toBe("https://www.lixusai.com/api/chat/:token");
    expect(cspUrlForLog("https://www.lixusai.com/api/calendar/abcdef.ics")).toBe("https://www.lixusai.com/api/calendar/:token");
    expect(cspUrlForLog("https://www.lixusai.com//c//abcdef")).toBe("https://www.lixusai.com/c/:token");
  });

  it("ekran adı kalır; rakam / büyük harf / alt çizgi / yüzde kodu taşıyan segment :id olur", () => {
    expect(cspUrlForLog("https://www.lixusai.com/settings/billing")).toBe("https://www.lixusai.com/settings/billing");
    expect(cspUrlForLog("https://www.lixusai.com/inbox/cmf8x2k9q0001abcd")).toBe("https://www.lixusai.com/inbox/:id");
    expect(cspUrlForLog("https://www.lixusai.com/properties/Abc")).toBe("https://www.lixusai.com/properties/:id");
    expect(cspUrlForLog("https://www.lixusai.com/x/a_b")).toBe("https://www.lixusai.com/x/:id");
    expect(cspUrlForLog("https://www.lixusai.com/x/ay%C5%9Fe")).toBe("https://www.lixusai.com/x/:id");
    expect(cspUrlForLog("https://www.lixusai.com/")).toBe("https://www.lixusai.com/");
    expect(cspUrlForLog("https://cdn.example/sdk/x.js")).toBe("https://cdn.example/sdk/x.js");
    expect(cspUrlForLog("https://cdn.example/main-app-8a7b.js")).toBe("https://cdn.example/:id");
  });

  it("query, fragment ve kullanıcı bilgisi hiç okunmaz", () => {
    expect(cspUrlForLog("https://u:SECRET@evil.example/a.js?k=Q_SECRET#F_SECRET")).toBe("https://evil.example/a.js");
  });

  it("🚨 segment tavanı: en fazla 6 segment + '…'", () => {
    const url = `https://evil.example/${Array.from({ length: 50 }, () => "aa").join("/")}`;
    expect(cspUrlForLog(url)).toBe("https://evil.example/aa/aa/aa/aa/aa/aa/…");
  });

  it("ws/wss de origin + şablon", () => {
    expect(cspUrlForLog("wss://rt.example/socket/abc123")).toBe("wss://rt.example/socket/:id");
  });

  it("🚨 içerik taşıyabilen şemalar yalnız şema adıyla; kapalı küme dışı şema 'invalid'", () => {
    expect(cspUrlForLog("data:text/html;base64,U0VDUkVU")).toBe("data:");
    expect(cspUrlForLog("blob:https://www.lixusai.com/0b2c-uuid")).toBe("blob:");
    expect(cspUrlForLog("chrome-extension://abcdefghijklmnop/inject.js")).toBe("chrome-extension:");
    expect(cspUrlForLog("about:blank")).toBe("about:");
    expect(cspUrlForLog("ayse-yilmaz:05551234567")).toBe(CSP_INVALID);
  });

  it("🚨 URL olmayan metin ASLA olduğu gibi dönmez", () => {
    expect(cspUrlForLog("Ayse Yilmaz 0555 123 45 67")).toBe(CSP_INVALID);
    expect(cspUrlForLog("/c/abcdef")).toBe(CSP_INVALID);
  });

  it("CSP anahtar kelimeleri kapalı kümeden, küçük harfe inerek", () => {
    for (const kw of ["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink", "self", "data", "blob"]) {
      expect(cspUrlForLog(kw), kw).toBe(kw);
    }
    expect(cspUrlForLog("INLINE")).toBe("inline");
    expect(cspUrlForLog("inline-ish")).toBe(CSP_INVALID);
  });

  it("boş / metin olmayan değer boş döner (log varsayılanı çağıranda)", () => {
    expect(cspUrlForLog(undefined)).toBe("");
    expect(cspUrlForLog("   ")).toBe("");
    expect(cspUrlForLog(42)).toBe("");
    expect(cspUrlForLog({ href: "https://x" })).toBe("");
  });
});

describe("cspDirectiveForLog — kapalı küme", () => {
  it("meşru directive'ler aynen; CSP2 biçiminde ilk sözcük", () => {
    for (const d of ["default-src", "script-src", "script-src-elem", "style-src-attr", "img-src", "connect-src", "frame-ancestors", "form-action", "trusted-types"]) {
      expect(cspDirectiveForLog(d), d).toBe(d);
    }
    expect(cspDirectiveForLog("script-src 'self' https://cdn.example")).toBe("script-src");
    expect(cspDirectiveForLog("Script-Src")).toBe("script-src");
  });

  it("🚨 bilinmeyen / sahte / uzun değer 'other'", () => {
    expect(cspDirectiveForLog("script-src;DROP")).toBe(CSP_OTHER);
    expect(cspDirectiveForLog("Ayse Yilmaz")).toBe(CSP_OTHER);
    expect(cspDirectiveForLog("x".repeat(5000))).toBe(CSP_OTHER);
    expect(cspDirectiveForLog("")).toBe("");
    expect(cspDirectiveForLog(null)).toBe("");
  });
});

describe("cspDispositionForLog — kapalı küme", () => {
  it("enforce / report aynen, başka her şey 'other', yok → ''", () => {
    expect(cspDispositionForLog("enforce")).toBe("enforce");
    expect(cspDispositionForLog("REPORT")).toBe("report");
    expect(cspDispositionForLog("Ayse")).toBe(CSP_OTHER);
    expect(cspDispositionForLog(undefined)).toBe("");
  });
});
