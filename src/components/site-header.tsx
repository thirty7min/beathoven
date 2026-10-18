"use client";

import Link from "next/link";
import { Logo } from "./logo";
import { VolumeControl } from "./volume-control";
import { UserMenu } from "./user-menu";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur-md">
      <div className="flex h-14 w-full items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0 rounded-lg" aria-label="Beathoven home">
          <Logo />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <VolumeControl />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
