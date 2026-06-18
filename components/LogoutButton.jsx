"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient"; // adjust path as needed

export default function LogoutButton({ collapsed = false }) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="
        flex items-center gap-3 p-2 rounded
        hover:bg-zinc-600 text-zinc-300 hover:text-white
        w-full transition-colors text-left
      "
    >
      <span className="text-lg leading-none">🚪</span>
      {!collapsed && <span className="text-sm">Log out</span>}
    </button>
  );
}