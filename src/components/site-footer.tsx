"use client";

import Link from "next/link";
import { useOnlineCount } from "./presence-provider";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/about", label: "About" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

export function SiteFooter() {
  const online = useOnlineCount();
  return (
    <footer className="border-t border-line bg-page">
      <div className="flex min-h-12 w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-[13px] sm:px-6">
        <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Footer">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="font-medium text-muted uppercase transition hover:text-fg">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-muted uppercase tabular-nums">
          <span className="flex items-center gap-2">
            Online: {online ?? "–"}
            <span className={online ? "h-2 w-2 rounded-full bg-online" : "h-2 w-2 rounded-full bg-subtle"} aria-hidden />
          </span>
          <span>v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
