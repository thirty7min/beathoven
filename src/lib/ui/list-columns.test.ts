import { describe, expect, it } from "vitest";
import { cellClass, columnTemplates, type ListColumn } from "./list-columns";

const columns: ListColumn[] = [
  { label: "Producer", width: "minmax(0,1fr)" },
  { label: "Wins", width: "3.5rem", smWidth: "5rem", align: "end" },
  { label: "Ties", width: "5rem", align: "end", fromSm: true },
  { label: "Battles", width: "3.5rem", smWidth: "5rem", align: "end" },
];

describe("columnTemplates", () => {
  it("drops small-screen-hidden columns from the base template only", () => {
    expect(columnTemplates(columns)).toEqual({
      base: "minmax(0,1fr) 3.5rem 3.5rem",
      sm: "minmax(0,1fr) 5rem 5rem 5rem",
    });
  });
});

describe("cellClass", () => {
  it("aligns and hides cells the same way for header and rows", () => {
    expect(cellClass(columns[0])).toBe("text-left");
    expect(cellClass(columns[1])).toBe("text-right");
    expect(cellClass(columns[2])).toBe("text-right hidden sm:block");
    expect(cellClass({ width: "2rem", align: "center" })).toBe("text-center");
  });
});
