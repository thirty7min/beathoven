import Link from "next/link";
import { cn } from "@/components/ui/cn";

const LINK_CLASS = "underline underline-offset-2 transition-colors hover:text-fg";

export function LegalNotice({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted", className)}>
      By continuing, you agree to the{" "}
      <Link href="/terms" target="_blank" className={LINK_CLASS}>
        Terms
      </Link>{" "}
      and{" "}
      <Link href="/privacy" target="_blank" className={LINK_CLASS}>
        Privacy Policy
      </Link>
      .
    </p>
  );
}
