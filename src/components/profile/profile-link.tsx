"use client";

import { ExternalLink } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { outboundLinkPath } from "@/lib/profile/link";
import { checkProfileLink, type LinkCheck } from "@/lib/profile/link-check";
import { linkHostname } from "@/lib/ui/profile-link";

type Check = LinkCheck | { status: "loading" };

const TITLES: Record<Check["status"], string> = {
  loading: "You're leaving Beathoven",
  ready: "You're leaving Beathoven",
  removed: "This link was removed",
  unavailable: "Can't check this link",
  none: "No link",
};

export function ProfileLink({ username, linkUrl, className }: { username: string; linkUrl: string | null | undefined; className?: string }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [removed, setRemoved] = useState(false);
  const request = useRef<AbortController | null>(null);
  const hostname = linkHostname(linkUrl);
  if (!hostname || (removed && check === null)) return null;

  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setCheck({ status: "loading" });
    checkProfileLink(username, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setCheck(result);
        if (result.status === "removed" || result.status === "none") setRemoved(true);
      },
      () => undefined,
    );
  }

  function close() {
    request.current?.abort();
    request.current = null;
    setCheck(null);
  }

  function proceed() {
    if (check?.status !== "ready") return;
    window.open(check.url, "_blank", "noopener,noreferrer");
    close();
  }

  return (
    <>
      <a
        href={outboundLinkPath(username)}
        target="_blank"
        rel="nofollow ugc"
        onClick={open}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-fg underline-offset-4 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:underline hover:opacity-80",
          className,
        )}
      >
        <span className="truncate">{hostname}</span>
        <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
      </a>
      <Dialog open={check !== null} onClose={close} title={check ? TITLES[check.status] : undefined} className="max-w-lg">
        {check && <LinkCheckBody check={check} username={username} />}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant={check?.status === "ready" || check?.status === "loading" ? "ghost" : "outline"} onClick={close}>
            {check?.status === "ready" || check?.status === "loading" ? "Cancel" : "Close"}
          </Button>
          {(check?.status === "ready" || check?.status === "loading") && (
            <Button variant="primary" onClick={proceed} disabled={check.status !== "ready"} loading={check.status === "loading"}>
              Continue
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}

function LinkCheckBody({ check, username }: { check: Check; username: string }) {
  if (check.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="text-sm text-muted">Checking this link is safe…</p>
        <div className="h-[74px] animate-pulse rounded-xl border border-line bg-raised" />
      </div>
    );
  }
  if (check.status === "ready") {
    return (
      <div className="flex animate-fade-in flex-col gap-4">
        <p className="text-sm text-muted">This link was added by {username}. Only continue if you trust it.</p>
        <div className="flex flex-col gap-1.5 rounded-xl border border-line px-4 py-3">
          <p className="text-xl font-semibold break-all">{check.hostname}</p>
          <p className="font-mono text-xs break-all text-muted">{check.url}</p>
        </div>
      </div>
    );
  }
  const body = {
    removed: "It was flagged as unsafe, so it's been taken off this profile.",
    unavailable: "We couldn't check this link right now. Try again in a minute.",
    none: `${username} hasn't added a link.`,
  }[check.status];
  return <p className="animate-fade-in text-sm text-muted">{body}</p>;
}
