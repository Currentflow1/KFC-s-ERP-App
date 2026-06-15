"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = [
    { label: "Dashboard", href: "/dashboard", symbol: "📊" },
    { label: "Suppliers", href: "/suppliers", symbol: "🤝" },
    { label: "Categories", href: "/categories", symbol: "🗂️" },
    { label: "Products", href: "/products", symbol: "📦" },
    { label: "Inventory", href: "/inventory", symbol: "📋" },
  ];

  return (
    <aside
      className={`bg-zinc-700 min-h-screen p-3 transition-all duration-300 ${
        open ? "w-64" : "w-16"
      }`}
    >
      <div className="flex p-1 items-center justify-between">
        {open && (
          <h1 className="text-white text-2xl font-bold ml-4">
            Sidebar
          </h1>
        )}

        <button
          onClick={() => setOpen(!open)}
          className="text-white font-bold text-xl mr-2 p-2 rounded hover:bg-zinc-600"
        >
          ☰
        </button>
      </div>

      <hr className="text-white" />

      <nav className="flex flex-col mt-6 gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`p-2 rounded hover:bg-zinc-600 ${
              pathname === link.href
                ? "bg-zinc-600 text-white"
                : "text-white"
            }`}
          >
            {open ? link.label : link.symbol}
          </Link>
        ))}
      </nav>
    </aside>
  );
}