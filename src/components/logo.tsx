import Image from "next/image";
import { cn } from "./ui/cn";

function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/logo.svg"
      alt=""
      width={size}
      height={size}
      unoptimized
      className={cn("shrink-0 rounded-md", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function Logo({ className, wordmarkClassName }: { className?: string; wordmarkClassName?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={cn("text-[15px] font-bold tracking-tight", wordmarkClassName)}>Beathoven</span>
    </span>
  );
}
