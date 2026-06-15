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
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      router.replace("/dashboard");
    }
  }

  function goToLogin() {
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">

      <h1 className="text-3xl font-bold mb-2">
        Inventory System
      </h1>

      <p className="text-gray-500 mb-6">
        Secure access required
      </p>

      <button
        onClick={goToLogin}
        className="bg-blue-600 text-white px-6 py-3 rounded"
      >
        Login
      </button>

    </div>
  );
}