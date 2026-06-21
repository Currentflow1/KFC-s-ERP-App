"use client";

import { useEffect, useState } from "react";
import { flushQueue, pendingCount, sanitizePendingChanges } from "@/lib/sync";
import Sidebar from "@/components/Sidebar";

export default function ProtectedLayout({ children }) {
  const [pending, setPending] = useState(0);
  const [online,  setOnline]  = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setOnline(navigator.onLine);

    async function bootFlush() {
      // Re-sanitize any UNSYNCED pending_changes rows before every flush
      // attempt — not just once. Rows queued before sanitizeInventoryRow()
      // existed (or by any future bug that slips a merged/display-only
      // field like _pendingIncoming into a payload) would otherwise retry
      // and fail against Supabase forever, since their `synced` flag can
      // never flip to 1. This is cheap and a no-op on already-clean rows,
      // so it's safe to run unconditionally on every boot and reconnect.
      await sanitizePendingChanges();

      const count = await pendingCount();
      setPending(count);
      if (navigator.onLine && count > 0) {
        setSyncing(true);
        await flushQueue();
        const remaining = await pendingCount();
        setPending(remaining);
        setSyncing(false);
      }
    }
    bootFlush();

    async function handleOnline() {
      setOnline(true);
      await sanitizePendingChanges();
      const count = await pendingCount();
      if (count > 0) {
        setSyncing(true);
        await flushQueue();
        const remaining = await pendingCount();
        setPending(remaining);
        setSyncing(false);
      }
    }

    function handleOffline() { setOnline(false); }

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-zinc-900 text-white">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">

        {/* Offline banner */}
        {!online && (
          <div className="bg-amber-500 text-amber-900 text-xs font-medium px-4 py-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-900 inline-block shrink-0" />
            You are offline. Changes are saved locally and will sync when wifi returns.
            {pending > 0 && (
              <span className="ml-auto shrink-0">{pending} pending</span>
            )}
          </div>
        )}

        {/* Syncing banner */}
        {syncing && (
          <div className="bg-blue-600 text-white text-xs font-medium px-4 py-2 flex items-center gap-2">
            <span className="animate-pulse w-1.5 h-1.5 rounded-full bg-white inline-block shrink-0" />
            Syncing {pending} local change{pending !== 1 ? "s" : ""} to server…
          </div>
        )}

        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}