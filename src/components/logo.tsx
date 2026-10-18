import Image from "next/image";
import { cn } from "./ui/cn";

const HEIGHT = 28;
const LOCKUP_WIDTH = Math.round((HEIGHT * 156) / 40);

export function Logo({ className, collapse = false }: { className?: string; collapse?: boolean }) {
  return (
    <span className={cn("flex items-center", className)}>
      <Image
        src="/brand/beathoven.svg"
        alt="Beathoven"
        width={LOCKUP_WIDTH}
        height={HEIGHT}
        unoptimized
        priority
        className={cn("shrink-0", collapse && "hidden sm:block")}
        style={{ width: LOCKUP_WIDTH, height: HEIGHT }}
      />
      {collapse && (
        <Image
          src="/brand/logo.svg"
          alt="Beathoven"
          width={HEIGHT}
          height={HEIGHT}
          unoptimized
          className="shrink-0 sm:hidden"
          style={{ width: HEIGHT, height: HEIGHT }}
        />
      )}
    </span>
  );
}
