import Image from "next/image";
import { cn } from "./cn";

const TINTS = ["#2a2a2a", "#333333", "#3d3d3d", "#262626", "#303030", "#383838"];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const SIZES = { xs: 24, sm: 32, md: 40, lg: 48, editor: 72, xl: 96 } as const;

export function Avatar({
  name,
  url,
  seed,
  size = "md",
  className,
}: {
  name: string;
  url?: string | null;
  seed?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const px = SIZES[size];
  const base = cn("relative inline-flex shrink-0 overflow-hidden rounded-full", className);
  if (url) {
    return (
      <span className={cn(base, "bg-raised")} style={{ width: px, height: px }}>
        <Image src={url} alt="" width={px} height={px} unoptimized className="block size-full max-w-none object-cover" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(base, "flex items-center justify-center font-semibold text-white/90")}
      style={{ width: px, height: px, fontSize: Math.max(10, px * 0.4), backgroundColor: TINTS[hash(seed ?? name) % TINTS.length] }}
    >
      {name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
