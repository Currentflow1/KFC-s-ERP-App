// lib/useUserRole.js
"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabaseClient";

export function useUserRole() {
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (active) { setRole(null); setLoading(false); }
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (active) {
        setRole(data?.role ?? null);
        setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [supabase]);

  return { role, isAdmin: role === "admin", isStaff: role === "staff", loading };
}