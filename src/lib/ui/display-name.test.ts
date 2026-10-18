import { describe, expect, it } from "vitest";
import { displayName } from "./display-name";

describe("displayName", () => {
  it("prefers the display name, then the username, then the fallback", () => {
    expect(displayName({ display_name: "Wilba ✨", username: "wilba" })).toBe("Wilba ✨");
    expect(displayName({ display_name: "  ", username: "wilba" })).toBe("wilba");
    expect(displayName({ username: null })).toBe("Unknown player");
    expect(displayName(null, "Someone")).toBe("Someone");
  });
});
