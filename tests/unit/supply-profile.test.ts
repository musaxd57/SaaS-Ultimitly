import { describe, it, expect } from "vitest";
import { parseSupplyProfile, serializeSupplyProfile, detectSupplyRequest } from "@/lib/supply";

describe("parseSupplyProfile", () => {
  it("keeps known keys with positive integer quantities", () => {
    expect(parseSupplyProfile('{"carsaf_takimi":2,"cop_poseti":3}')).toEqual({
      carsaf_takimi: 2,
      cop_poseti: 3,
    });
  });

  it("drops unknown keys, zeros, negatives, and non-numbers", () => {
    expect(
      parseSupplyProfile('{"carsaf_takimi":2,"bilinmeyen":9,"sabun":0,"kahve":-1,"cay":"x"}'),
    ).toEqual({ carsaf_takimi: 2 });
  });

  it("is tolerant of null / empty / malformed JSON", () => {
    expect(parseSupplyProfile(null)).toEqual({});
    expect(parseSupplyProfile("")).toEqual({});
    expect(parseSupplyProfile("not json")).toEqual({});
    expect(parseSupplyProfile("[1,2,3]")).toEqual({});
  });

  it("clamps quantities to 999", () => {
    expect(parseSupplyProfile('{"su":100000}')).toEqual({ su: 999 });
  });
});

describe("serializeSupplyProfile", () => {
  it("stores only positive known quantities", () => {
    const json = serializeSupplyProfile({ carsaf_takimi: 2, sabun: 0, bilinmeyen: 5 });
    expect(JSON.parse(json!)).toEqual({ carsaf_takimi: 2 });
  });

  it("returns null for an empty / all-zero profile (clears the column)", () => {
    expect(serializeSupplyProfile({})).toBeNull();
    expect(serializeSupplyProfile({ sabun: 0, kahve: 0 })).toBeNull();
    expect(serializeSupplyProfile(null)).toBeNull();
  });

  it("round-trips through parse", () => {
    const json = serializeSupplyProfile({ carsaf_takimi: 2, banyo_havlusu: 4, cop_poseti: 2 });
    expect(parseSupplyProfile(json)).toEqual({ carsaf_takimi: 2, banyo_havlusu: 4, cop_poseti: 2 });
  });
});

describe("detectSupplyRequest", () => {
  it("detects an explicit extra-towel request (+1)", () => {
    expect(detectSupplyRequest("Bir havlu daha alabilir miyiz?")).toEqual([{ itemKey: "banyo_havlusu", qty: 1 }]);
    expect(detectSupplyRequest("could we get an extra towel?")).toEqual([{ itemKey: "banyo_havlusu", qty: 1 }]);
    expect(detectSupplyRequest("fazladan çarşaf rica edebilir miyim")).toEqual([{ itemKey: "carsaf_takimi", qty: 1 }]);
  });

  it("detects multiple distinct extras in one message", () => {
    const out = detectSupplyRequest("ekstra havlu ve nevresim alabilir miyiz");
    expect(out).toContainEqual({ itemKey: "banyo_havlusu", qty: 1 });
    expect(out).toContainEqual({ itemKey: "nevresim", qty: 1 });
  });

  it("does NOT fire without an explicit extra signal (praise / neutral)", () => {
    expect(detectSupplyRequest("havlular çok temiz ve güzel, teşekkürler")).toEqual([]);
    expect(detectSupplyRequest("çarşaflar nerede acaba?")).toEqual([]);
    expect(detectSupplyRequest("wifi şifresi nedir?")).toEqual([]);
  });

  it("does NOT fire on an extra signal with no linen item", () => {
    expect(detectSupplyRequest("bir kahve daha alabilir miyim")).toEqual([]);
  });
});
