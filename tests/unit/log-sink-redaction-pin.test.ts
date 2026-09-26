import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// ---------------------------------------------------------------------------
// F10 (Codex 09-05) — MEKANİK PİN: sunucu tarafında ham hata `console.*`a verilmez.
//
// Kural (`src/lib/redact.ts`): hata nesnesi / `err.message` / `err.stack` / `cause` bir `console.*` çağrısına
// doğrudan girmez; `formatErrorForLog(err)` (alarm kurmayan log satırı, merkezî redaksiyon) ya da `reportError`
// (alarm) kullanılır. Bu pin TypeScript sözdizim ağacı üzerinde çalışır (metin taraması değil) ve YALNIZ çağrının
// argümanlarını görür: hatayı önce bir değişkene kopyalayıp onu basan kod buradan kaçar (bilinen sınır) — bilinen
// yazıcıların davranışı `tests/integration/log-sink-redaction.test.ts`te ayrıca sınanır.
// "use client" dosyaları kapsam dışı: tarayıcı konsoluna yazarlar, sunucu loguna değil.
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../../src");
const CONSOLE_METHODS = new Set(["error", "warn", "log", "info", "debug", "trace"]);
/** Argümanı redaksiyondan geçiren çağrılar — içleri güvenli sayılır. */
const REDACTORS = new Set(["formatErrorForLog", "redactSensitive", "scrubErr", "scrubForLog"]);
/** Hata taşıdığı varsayılan değişken adları (catch parametresi geleneği). */
const ERROR_NAMES = new Set(["err", "error", "e", "ex", "exception", "cause", "reason"]);
/** Hata metnini taşıyan özellikler. */
const ERROR_PROPS = new Set(["message", "stack", "cause", "error", "reason"]);

function containsRawError(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && REDACTORS.has(node.expression.text)) return false;
  if (ts.isPropertyAccessExpression(node)) {
    if (ERROR_PROPS.has(node.name.text)) return true;
    return containsRawError(node.expression);
  }
  if (ts.isIdentifier(node)) return ERROR_NAMES.has(node.text);
  return ts.forEachChild(node, (c) => (containsRawError(c) ? true : undefined)) ?? false;
}

/** Kaynak metindeki güvensiz `console.*` çağrıları ("satır: argüman" biçiminde). */
export function unsafeConsoleCalls(fileName: string, text: string): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const bad: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console" &&
      CONSOLE_METHODS.has(node.expression.name.text)
    ) {
      for (const arg of node.arguments) {
        if (containsRawError(arg)) {
          const line = sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1;
          bad.push(`${line}: ${arg.getText(sf).replace(/\s+/g, " ").slice(0, 140)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bad;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const isClientFile = (text: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(text);

describe("F10 — ham hata console.*'a verilmez (sözdizim ağacı pini)", () => {
  it("🚨 src/ içindeki sunucu dosyalarında güvensiz console çağrısı YOK", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(200); // yürüyüş gerçekten ağacı gördü (vakum koruması)
    const offenders: string[] = [];
    let serverFiles = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (isClientFile(text)) continue;
      serverFiles++;
      for (const b of unsafeConsoleCalls(f, text)) offenders.push(`${path.relative(SRC, f)}:${b}`);
    }
    expect(serverFiles).toBeGreaterThan(150);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("KONTROL (anti-vakum): tarayıcı gerçek ihlalleri yakalar, redaktörden geçeni geçirir", () => {
    const flagged = (code: string) => unsafeConsoleCalls("x.ts", code).length;
    expect(flagged(`try {} catch (err) { console.error("[x] failed", err); }`)).toBe(1);
    expect(flagged(`try {} catch (e) { console.warn(\`[x] \${e}\`); }`)).toBe(1);
    expect(flagged(`const r = { error: "x" }; console.error("[x]", r.error);`)).toBe(1);
    expect(flagged(`try {} catch (err) { console.error("[x]", err instanceof Error ? err.message : err); }`)).toBe(1);
    expect(flagged(`try {} catch (err) { console.log({ err }); }`)).toBe(1);
    expect(flagged(`try {} catch (err) { console.error(\`[x] :: \${formatErrorForLog(err)}\`); }`)).toBe(0);
    expect(flagged(`console.error("[x] failed", scrubErr(err));`)).toBe(0);
    expect(flagged(`console.warn(redactSensitive(\`[csp] \${line}\`));`)).toBe(0);
    expect(flagged(`console.error("App error: boom", res.status, detail);`)).toBe(0);
  });

  it("KONTROL: 'use client' dosyası tanınır (tarayıcı konsolu kapsam dışı)", () => {
    expect(isClientFile(`"use client";\nimport x from "y";`)).toBe(true);
    expect(isClientFile(`// yorum\n"use client";`)).toBe(true);
    expect(isClientFile(`import x from "y";\nconst s = "use client";`)).toBe(false);
  });
});
