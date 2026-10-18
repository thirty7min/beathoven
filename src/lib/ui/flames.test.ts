import { describe, expect, it } from "vitest";
import {
  BADGE_BORDER_PX,
  COLD,
  EDGE_AA_PX,
  EDGE_FADE,
  FIRE_BOX,
  FLAME_BANDS,
  FLAME_PALETTE,
  FLAME_HALF_LIFE_MS,
  MAX_FIRE_DPR,
  PHASE_PERIOD,
  advancePhase,
  approach,
  approachLevel,
  badgeEdge,
  createFlameShape,
  fireBoxStyle,
  fireBufferSize,
  fireMounted,
  flameLevel,
  coronaLength,
  flameReach,
  rimHeat,
  flameShape,
  glslColor,
  glslFloat,
  hexToRgb,
  isCold,
  type FlameShape,
} from "./flames";

const shape = (fire: number) => flameShape(fire);

describe("flameLevel", () => {
  it("goes from a cold puff of smoke to a number fully ablaze", () => {
    const levels = [1, 2, 3, 4, 5].map(flameLevel);
    expect(levels[0]).toMatchObject({ fire: 0, embers: 0 });
    expect(levels[0].smoke).toBeGreaterThan(0);
    expect(levels[1].smoke).toBeGreaterThan(0);
    for (let i = 1; i < 5; i++) {
      expect(levels[i].fire).toBeGreaterThan(levels[i - 1].fire);
      expect(levels[i].embers).toBeGreaterThanOrEqual(levels[i - 1].embers);
    }
    expect(levels[4]).toEqual({ fire: 0.42, smoke: 0, embers: 0.35 });
    expect(levels[3].fire).toBeLessThan(levels[4].fire);
    expect(levels[1].fire).toBeLessThan(levels[4].fire / 4);
  });

  it("clamps and rounds, and is cold without a score", () => {
    expect(flameLevel(9)).toBe(flameLevel(5));
    expect(flameLevel(0)).toBe(flameLevel(1));
    expect(flameLevel(3.6)).toBe(flameLevel(4));
    expect(flameLevel(null)).toBe(COLD);
    expect(flameLevel(Number.NaN)).toBe(COLD);
    expect(isCold(COLD)).toBe(true);
    expect(isCold(flameLevel(1))).toBe(false);
  });
});

describe("fireMounted", () => {
  it("has no fire surface for a blank, own or disabled dial", () => {
    expect(fireMounted(COLD, false, true)).toBe(false);
    expect(fireMounted(flameLevel(null), false, false)).toBe(false);
  });

  it("mounts as soon as there is fire or smoke to draw", () => {
    for (const score of [1, 2, 3, 4, 5]) expect(fireMounted(flameLevel(score), false, true)).toBe(true);
    expect(fireMounted(flameLevel(1), false, false)).toBe(true);
  });

  it("stays mounted while a live flame fades out, then lets go", () => {
    expect(fireMounted(COLD, true, true)).toBe(true);
    expect(fireMounted(COLD, true, false)).toBe(false);
  });
});

describe("approach", () => {
  it("halves the distance every half-life regardless of frame rate", () => {
    expect(approach(0, 1, FLAME_HALF_LIFE_MS)).toBeCloseTo(0.5);
    let stepped = 0;
    for (let i = 0; i < 4; i++) stepped = approach(stepped, 1, FLAME_HALF_LIFE_MS / 4);
    expect(stepped).toBeCloseTo(0.5);
  });

  it("settles exactly on the target and can be interrupted mid-way", () => {
    expect(approach(0.999, 1, 16)).toBe(1);
    const halfway = approach(0, 1, FLAME_HALF_LIFE_MS);
    const reversed = approach(halfway, 0, 16);
    expect(reversed).toBeLessThan(halfway);
    expect(reversed).toBeGreaterThan(0);
  });

  it("eases a whole level in place", () => {
    const current = { ...COLD };
    const result = approachLevel(current, flameLevel(5), FLAME_HALF_LIFE_MS);
    expect(result).toBe(current);
    expect(current.fire).toBeCloseTo(flameLevel(5).fire / 2);
    for (let i = 0; i < 60; i++) approachLevel(current, flameLevel(5), 16);
    expect(current).toEqual(flameLevel(5));
  });
});

describe("flameShape", () => {
  it("grows taller, wider and faster with intensity", () => {
    const low = shape(0.2);
    const high = shape(1);
    expect(high.height).toBeGreaterThan(low.height);
    expect(high.width).toBeGreaterThan(low.width);
    expect(high.speed).toBeGreaterThan(low.speed);
  });

  it("keeps the tallest, widest tongue inside the canvas so nothing clips", () => {
    const reach = flameReach(shape(flameLevel(5).fire));
    expect(reach.top).toBeLessThanOrEqual(FIRE_BOX.top - EDGE_FADE);
    expect(reach.side).toBeLessThanOrEqual(FIRE_BOX.right - EDGE_FADE);
    expect(reach.side).toBeLessThanOrEqual(-FIRE_BOX.left - EDGE_FADE);
  });

  it("hides the flame when cold", () => {
    expect(shape(0).opacity).toBe(0);
    expect(shape(1).opacity).toBe(1);
    expect(shape(5)).toEqual(shape(1));
  });

  it("lights the badge with the fire and nothing when cold", () => {
    expect(shape(0)).toMatchObject({ glow: 0, rim: 0, front: 0, tint: 0 });
    expect(shape(1)).toMatchObject({ glow: 1, rim: 1, front: 1, tint: 1 });
    const [two, three, four, five] = [2, 3, 4, 5].map((score) => shape(flameLevel(score).fire));
    expect(two.rim).toBeGreaterThan(0);
    expect(four.front).toBe(0);
    expect(five.front).toBeGreaterThan(0);
    expect(five.front).toBeLessThan(0.1);
    expect(four.glow).toBeGreaterThan(three.glow);
    expect(five.glow).toBeLessThan(0.5);
    expect(five.tint).toBeLessThan(five.glow);
  });

  it("writes into the given object", () => {
    const out: FlameShape = createFlameShape();
    expect(flameShape(0.5, out)).toBe(out);
  });
});

describe("advancePhase", () => {
  it("scrolls by speed and wraps on the noise period", () => {
    expect(advancePhase(1, 500, 2)).toBeCloseTo(2);
    expect(advancePhase(PHASE_PERIOD - 0.5, 1000, 1)).toBeCloseTo(0.5);
  });
});

describe("fire canvas", () => {
  it("renders at reduced resolution with the device pixel ratio capped", () => {
    expect(fireBufferSize(100, 120, 1)).toEqual({ width: 60, height: 72 });
    expect(fireBufferSize(100, 120, 3)).toEqual(fireBufferSize(100, 120, MAX_FIRE_DPR));
    expect(fireBufferSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
  });

  it("frames the badge with room above for the flames", () => {
    expect(fireBoxStyle({ left: -1, right: 1, bottom: -1, top: 1 })).toEqual({ left: "0%", top: "0%", width: "100%", height: "100%" });
    const box = fireBoxStyle();
    expect(box.left).toBe(`${((FIRE_BOX.left + 1) / 2) * 100}%`);
    const [left, top, width, height] = [box.left, box.top, box.width, box.height].map(parseFloat);
    const reach = flameReach(shape(flameLevel(5).fire));
    expect(left + width).toBeCloseTo(100 - left);
    expect(-top).toBeGreaterThanOrEqual(((reach.top - 1) / 2) * 100);
    expect(-left).toBeGreaterThanOrEqual(((reach.side - 1) / 2) * 100);
    expect(top + height).toBeGreaterThan(100);
    expect(-top).toBeGreaterThan(top + height - 100);
  });
});

describe("flat flame style", () => {
  it("posterises into rising bands, one colour each", () => {
    expect(FLAME_BANDS).toHaveLength(FLAME_PALETTE.length);
    for (let i = 1; i < FLAME_BANDS.length; i++) expect(FLAME_BANDS[i]).toBeGreaterThan(FLAME_BANDS[i - 1]);
    expect(FLAME_BANDS[0]).toBeGreaterThan(0);
    expect(FLAME_BANDS.at(-1)).toBeLessThan(rimHeat(flameLevel(5).fire));
    expect(FLAME_BANDS.at(-1)).toBeGreaterThan(rimHeat(flameLevel(4).fire));
  });

  it("turns hex colours into shader literals", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(glslColor("#ffffff")).toBe("vec3(1.000, 1.000, 1.000)");
    expect(glslFloat(3)).toBe("3.0");
    expect(glslFloat(0.25)).toBe("0.25");
  });
});

describe("corona", () => {
  it("wraps the badge in a rounded burn instead of a single spire", () => {
    const blaze = shape(flameLevel(5).fire);
    const top = coronaLength(blaze, 1);
    const shoulder = coronaLength(blaze, Math.SQRT1_2);
    const side = coronaLength(blaze, 0);
    expect(side).toBeGreaterThan(top * 0.5);
    expect(shoulder).toBeGreaterThan(side);
    expect(top).toBeGreaterThanOrEqual(shoulder);
    expect(coronaLength(blaze, -1)).toBe(0);
    const reach = flameReach(blaze);
    expect(reach.top / reach.side).toBeLessThan(1.5);
  });

  it("grows from a rim lick at 2 to the fullest burn at 5", () => {
    const lengths = [2, 3, 4, 5].map((score) => coronaLength(shape(flameLevel(score).fire), 0.5));
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThan(lengths[i - 1]);
  });
});

describe("badgeEdge", () => {
  const width = 48 * (FIRE_BOX.right - FIRE_BOX.left);

  it("cuts the back fire at the inside of the badge border so flames cover it", () => {
    const edge = badgeEdge(width, width * 2);
    expect(edge.cut).toBeCloseTo(1 - BADGE_BORDER_PX / 48);
    expect(edge.aa).toBeCloseTo(EDGE_AA_PX / 48);
  });

  it("never anti-aliases narrower than one rendered pixel", () => {
    expect(badgeEdge(width, width * 0.3).aa).toBeCloseTo(1 / 0.3 / 48);
  });

  it("falls back to a hairline edge before layout", () => {
    expect(badgeEdge(0, 0)).toEqual({ cut: 1, aa: 0.03 });
  });
});
