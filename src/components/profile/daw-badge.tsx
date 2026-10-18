import { cn } from "@/components/ui/cn";
import { dawName, normalizeDaws } from "@/lib/profile/daw-selection";
import type { DawSlug } from "@/lib/profile/daws";
import { DawLogo } from "./daw-logo";

export function DawBadge({ slug, className }: { slug: DawSlug; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong pr-3 pl-2 text-[12px] font-medium whitespace-nowrap text-fg",
        className,
      )}
    >
      <DawLogo slug={slug} className="h-3.5 w-3.5" />
      {dawName(slug)}
    </span>
  );
}

export function DawList({ daws, className }: { daws: readonly unknown[] | null | undefined; className?: string }) {
  const slugs = normalizeDaws(daws);
  if (!slugs.length) return null;
  return (
    <ul aria-label="DAWs" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {slugs.map((slug) => (
        <li key={slug}>
          <DawBadge slug={slug} />
        </li>
      ))}
    </ul>
  );
}
