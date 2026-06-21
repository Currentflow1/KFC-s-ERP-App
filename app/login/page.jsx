"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (signInError) {
      setError("Incorrect email or password. Please try again.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">

        {/* Card — same surface treatment as the inventory tables: white,
            border-gray-200, rounded-lg, shadow-sm */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">

          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-3">
              <span className="text-2xl leading-none">📦</span>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  KFC's Inventory App
                </h1>
                <p className="text-sm text-gray-500 mt-0.5">Sign in to continue</p>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="px-6 py-6">
            <form onSubmit={handleLogin} className="flex flex-col gap-4">

              <div className="flex flex-col gap-1">
                <label htmlFor="email" className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="text-black border border-gray-200 rounded-md px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="password" className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="text-black w-full border border-gray-200 rounded-md px-3 py-2 pr-14 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 transition-colors select-none"
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60"
              >
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <span className="inline-block animate-spin">↻</span>
                    Signing in…
                  </span>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          </div>

          <div className="px-6 pb-5">
            <p className="text-xs text-gray-400 text-center">
              Access is managed by your administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}