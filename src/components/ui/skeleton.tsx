import type { HTMLAttributes } from "react";
import { AVATAR_SIZES, type AvatarSize } from "./avatar";
import { cn } from "./cn";

const PULSE = "animate-pulse bg-raised motion-reduce:animate-none";

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span aria-hidden className={cn("block shrink-0", PULSE, className)} {...rest} />;
}

export function SkeletonText({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-lh max-w-full items-center", className)}>
      <span className={cn("h-[0.7em] w-full rounded", PULSE)} />
    </span>
  );
}

export function SkeletonAvatar({ size = "md", className }: { size?: Exclude<AvatarSize, "fluid">; className?: string }) {
  const px = AVATAR_SIZES[size];
  return <Skeleton className={cn("rounded-full", className)} style={{ width: px, height: px }} />;
}

export function SkeletonGroup({ label = "Loading", className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className} {...rest}>
      {children}
    </div>
  );
}
