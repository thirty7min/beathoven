import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAME_STYLE,
  FLAME_STYLES,
  TONGUES,
  chooseFlameStyle,
  emberColor,
  emberRate,
  heatColor,
  heatGlow,
  heatLevel,
  nextFlameStyle,
  spawnEmber,
  stepEmber,
  tongueScale,
  type FlameStyle,
} from "./flame-styles";

describe("flame style choice", () => {
  it("prefers the URL, then the saved choice, then the default", () => {
    expect(chooseFlameStyle("embers", "heat")).toBe("embers");
    expect(chooseFlameStyle("nope", "heat")).toBe("heat");
    expect(chooseFlameStyle(null, "junk")).toBe(DEFAULT_FLAME_STYLE);
    expect(DEFAULT_FLAME_STYLE).toBe("classic");
  });

  it("cycles through every style and wraps", () => {
    let style: FlameStyle = FLAME_STYLES[0];
    const seen = new Set<FlameStyle>([style]);
    for (let i = 0; i < FLAME_STYLES.length; i++) {
      style = nextFlameStyle(style);
      seen.add(style);
    }
    expect(seen.size).toBe(FLAME_STYLES.length);
    expect(style).toBe(FLAME_STYLES[0]);
  });
});

describe("heat", () => {
  it("scales 1 to 5 and is cold without a score", () => {
    expect(heatLevel(null)).toBe(0);
    expect(heatLevel(1)).toBe(0);
    expect(heatLevel(3)).toBe(0.5);
    expect(heatLevel(5)).toBe(1);
  });

  it("heats the number from white to orange to blue-white", () => {
    expect(heatColor(1)).toBe("#f5f5f5");
    expect(heatColor(3)).toBe("#ff9a3c");
    expect(heatColor(5)).toBe("#d6e6ff");
    expect(heatColor(null)).toBe("currentColor");
    expect(heatGlow(1)).toBe(0);
    expect(heatGlow(5)).toBe(1);
  });
});

describe("sticker tongues", () => {
  it("grows from one tongue to all three as the rating rises", () => {
    const visible = (score: number) => TONGUES.filter((t) => tongueScale(heatLevel(score), t.from) > 0).length;
    expect(visible(1)).toBe(0);
    expect(visible(2)).toBe(1);
    expect(visible(4)).toBe(3);
    expect(tongueScale(1, 0)).toBe(1);
  });
});

describe("embers", () => {
  it("spawns more sparks the hotter the rating", () => {
    expect(emberRate(null)).toBe(0);
    expect(emberRate(1)).toBe(0);
    expect(emberRate(5)).toBeGreaterThan(emberRate(3));
  });

  it("rises from the top of the badge and burns out", () => {
    const ember = spawnEmber(1, () => 0.5);
    expect(ember.y).toBeGreaterThan(0.9);
    const startY = ember.y;
    let alive = true;
    let steps = 0;
    while (alive && steps < 1000) {
      alive = stepEmber(ember, 16);
      steps++;
    }
    expect(ember.y).toBeGreaterThan(startY);
    expect(alive).toBe(false);
  });

  it("cools from white-yellow to red as it ages", () => {
    expect(emberColor(0)).toBe("#fff4c4");
    expect(emberColor(1)).toBe("#f0461b");
  });
});
