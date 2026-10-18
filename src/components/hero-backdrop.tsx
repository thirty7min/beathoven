import type { CSSProperties } from "react";

export const GRID = {
  base: "#0b0b0b",
  lineOpacity: 0.07,
  lineWidth: 1,
  cell: 48,
  fadeCenterY: "45%",
  fadeStart: "15%",
  fadeEnd: "75%",
};

const line = `rgb(255 255 255 / ${GRID.lineOpacity})`;
const mask = `radial-gradient(ellipse at 50% ${GRID.fadeCenterY}, #000 ${GRID.fadeStart}, transparent ${GRID.fadeEnd})`;

const gridStyle: CSSProperties = {
  backgroundImage: `linear-gradient(to right, ${line} ${GRID.lineWidth}px, transparent ${GRID.lineWidth}px), linear-gradient(to bottom, ${line} ${GRID.lineWidth}px, transparent ${GRID.lineWidth}px)`,
  backgroundSize: `${GRID.cell}px ${GRID.cell}px`,
  backgroundPosition: "center center",
  maskImage: mask,
  WebkitMaskImage: mask,
};

export function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundColor: GRID.base }}>
      <div className="absolute inset-0" style={gridStyle} />
    </div>
  );
}
