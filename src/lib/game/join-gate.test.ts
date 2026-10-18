import { describe, expect, it } from "vitest";
import { joinGateView } from "./join-gate";

const base = { loading: false, current: null, code: "ABC123", confirmed: false };

describe("joinGateView", () => {
  it("waits for the membership check before deciding", () => {
    expect(joinGateView({ ...base, loading: true, current: { code: "XYZ789", status: "lobby" } })).toBe("loading");
  });

  it("joins straight away outside any room", () => {
    expect(joinGateView(base)).toBe("join");
  });

  it("joins straight away when rejoining the same room", () => {
    expect(joinGateView({ ...base, current: { code: "ABC123", status: "lobby" } })).toBe("join");
  });

  it("confirms only for a live membership elsewhere", () => {
    expect(joinGateView({ ...base, current: { code: "XYZ789", status: "lobby" } })).toBe("confirm");
    expect(joinGateView({ ...base, current: { code: "XYZ789", status: "results" } })).toBe("confirm");
    expect(joinGateView({ ...base, current: { code: "XYZ789", status: "closed" } })).toBe("join");
  });

  it("joins once confirmed", () => {
    expect(joinGateView({ ...base, current: { code: "XYZ789", status: "lobby" }, confirmed: true })).toBe("join");
  });
});
