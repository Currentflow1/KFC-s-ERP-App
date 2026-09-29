"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroups } from "@/lib/navGroups";
import LogoutButton from "./LogoutButton";

export default function Header() {
  const pathname = usePathname();

  // Find the current page's label from the shared nav list
  const current = navGroups
    .flatMap((g) => g.links)
    .find((l) => pathname === l.href || pathname.startsWith(l.href + "/"));

  const isHome = pathname === "/dashboard";

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-4 bg-rose-950 px-6 py-3 border-b border-zinc-600 shadow-sm">
      {/* Left: title */}
      <Link href="/dashboard" className="min-w-0">
        <h1 className="text-white text-lg sm:text-xl font-bold tracking-tight truncate">
          Kristine Food Center Inventory System
        </h1>
      </Link>

      {/* Right: current page + buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {current && !isHome && (
          <span className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-800 text-sm text-zinc-200">
            <span>{current.symbol}</span>
            {current.label}
          </span>
        )}

        <Link
          href="/dashboard"
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium text-white transition-colors hover:bg-zinc-600 ${
            isHome ? "bg-zinc-600" : ""
          }`}
        >
          <span className="text-lg leading-none">🏠</span>
          Home
        </Link>

        <LogoutButton collapsed={false} />
      </div>
    </header>
  );
}