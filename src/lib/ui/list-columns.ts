export type ColumnAlign = "start" | "center" | "end";

export type ListColumn = {
  label?: string;
  width: string;
  smWidth?: string;
  align?: ColumnAlign;
  fromSm?: boolean;
};

const ALIGN: Record<ColumnAlign, string> = { start: "text-left", center: "text-center", end: "text-right" };

export function columnTemplates(columns: ListColumn[]): { base: string; sm: string } {
  return {
    base: columns
      .filter((c) => !c.fromSm)
      .map((c) => c.width)
      .join(" "),
    sm: columns.map((c) => c.smWidth ?? c.width).join(" "),
  };
}

export function cellClass(column: ListColumn): string {
  return [ALIGN[column.align ?? "start"], column.fromSm ? "hidden sm:block" : ""].filter(Boolean).join(" ");
}
