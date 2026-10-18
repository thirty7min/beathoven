import { ExternalLink } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { outboundLinkPath } from "@/lib/profile/link";
import { linkHostname } from "@/lib/ui/profile-link";

export function ProfileLink({ username, linkUrl, className }: { username: string; linkUrl: string | null | undefined; className?: string }) {
  const hostname = linkHostname(linkUrl);
  if (!hostname) return null;
  return (
    <a
      href={outboundLinkPath(username)}
      target="_blank"
      rel="nofollow ugc"
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-fg underline-offset-4 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:underline hover:opacity-80",
        className,
      )}
    >
      <span className="truncate">{hostname}</span>
      <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
    </a>
  );
}
