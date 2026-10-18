"use client";

import { createContext, use, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cellClass, columnTemplates, type ListColumn } from "@/lib/ui/list-columns";
import { cn } from "./cn";
import { Eyebrow } from "./card";
import { SkeletonGroup, SkeletonText } from "./skeleton";

const ColumnsContext = createContext<ListColumn[] | null>(null);

export function ListTable({ columns, children, className }: { columns: ListColumn[]; children: ReactNode; className?: string }) {
  const { base, sm } = columnTemplates(columns);
  return (
    <ColumnsContext value={columns}>
      <div
        className={cn("grid grid-cols-(--cols) gap-x-4 sm:grid-cols-(--cols-sm)", className)}
        style={{ "--cols": base, "--cols-sm": sm } as CSSProperties}
      >
        <div className="col-span-full grid grid-cols-subgrid items-center border-b border-line px-2 pb-3">
          {columns.map((column, i) => (
            <Eyebrow key={i} className={cellClass(column)}>
              {column.label}
            </Eyebrow>
          ))}
        </div>
        <List className="col-span-full grid grid-cols-subgrid">{children}</List>
      </div>
    </ColumnsContext>
  );
}

export function List({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("divide-y divide-line", className)} {...rest} />;
}

export function ListRow({
  thumb,
  title,
  subtitle,
  cells,
  trailing,
  className,
  onClick,
  active,
}: {
  thumb?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  cells?: ReactNode[];
  trailing?: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const columns = use(ColumnsContext);
  const main = (
    <span className="flex min-w-0 items-center gap-3.5">
      {thumb}
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">{title}</span>
        {subtitle && <span className={cn("text-[13px] text-muted", typeof subtitle === "string" && "truncate")}>{subtitle}</span>}
      </span>
    </span>
  );
  return (
    <li
      className={cn(
        "items-center px-2 py-3",
        columns ? "col-span-full grid grid-cols-subgrid" : "grid gap-4",
        active && "bg-white/[0.04]",
        className,
      )}
    >
      {onClick ? (
        <button onClick={onClick} className="-m-1 min-w-0 rounded-lg p-1 text-left transition hover:bg-white/[0.04]">
          {main}
        </button>
      ) : (
        main
      )}
      {cells?.map((cell, i) => (
        <span key={i} className={cn("min-w-0 text-sm tabular-nums", columns?.[i + 1] && cellClass(columns[i + 1]))}>
          {cell}
        </span>
      ))}
      {trailing}
    </li>
  );
}

export function Thumb({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-raised text-muted", className)}>
      {children}
    </span>
  );
}

const SKELETON_TITLE_WIDTHS = ["w-40", "w-32", "w-48", "w-36", "w-28", "w-44"];

export function ListTableSkeleton({
  columns,
  rows,
  thumb,
  subtitle,
  cellWidths = [],
  label = "Loading",
}: {
  columns: ListColumn[];
  rows: number;
  thumb?: ReactNode;
  subtitle?: ReactNode;
  cellWidths?: string[];
  label?: string;
}) {
  return (
    <SkeletonGroup label={label}>
      <ListTable columns={columns}>
        {Array.from({ length: rows }, (_, i) => (
          <ListRow
            key={i}
            thumb={thumb}
            title={<SkeletonText className={SKELETON_TITLE_WIDTHS[i % SKELETON_TITLE_WIDTHS.length]} />}
            subtitle={subtitle}
            cells={columns
              .slice(1)
              .map((column, c) =>
                column.label ? <SkeletonText key={c} className={cn(cellWidths[c] ?? "w-8", column.align === "end" && "ml-auto", column.align === "center" && "mx-auto")} /> : null,
              )}
          />
        ))}
      </ListTable>
    </SkeletonGroup>
  );
}
