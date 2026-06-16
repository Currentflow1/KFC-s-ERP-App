"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthLandingPage() {
  const router = useRouter();

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      router.replace("/dashboard");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="flex flex-col items-center gap-2 text-center">

        <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-3xl shadow-md">
          📦
        </div>

        <h1 className="text-3xl font-bold text-slate-800">Inventory System</h1>
        <p className="text-sm text-slate-500">Secure access required to continue.</p>

        <button
          onClick={() => router.push("/login")}
          className="mt-6 flex items-center gap-2 rounded-md bg-blue-600 px-8 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          Sign In
        </button>

      </div>
    </div>
  );
}