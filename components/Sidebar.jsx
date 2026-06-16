"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const groups = [
    {
      label: "Overview",
      links: [
        { label: "Dashboard", href: "/dashboard", symbol: "📊" },
      ],
    }, {
      label: "Operations",
      links: [
        { label: "Inventory",     href: "/inventory",     symbol: "📋" },
        { label: "Orders",        href: "/orders",        symbol: "🛒" },
        { label: "Transactions",  href: "/transactions",  symbol: "🔄" },
      ],
    }, {
      label: "Master Data",
      links: [
        { label: "Categories", href: "/categories", symbol: "🗂️" },
        { label: "Suppliers",   href: "/suppliers",  symbol: "🤝" },
        { label: "Products",    href: "/products",   symbol: "📦" },
        { label: "Employees",   href: "/employees",  symbol: "👨🏻‍💼" },
      ],
    },
  ];

  return (
    <aside
      className={`bg-zinc-700 min-h-screen p-3 transition-all duration-300 ${
        open ? "w-64" : "w-16"
      }`}
    >
      <div className="flex p-1 items-center justify-between">
        {open && (
          <h1 className="text-white text-2xl font-bold ml-4">Menu</h1>
        )}
        <button
          onClick={() => setOpen(!open)}
          className="text-white font-bold text-xl mr-2 p-2 rounded hover:bg-zinc-600"
        >
          ☰
        </button>
      </div>

      <hr className="border-zinc-500 mb-2" />

      <nav className="flex flex-col mt-2 gap-4">
        {groups.map((group) => (
          <div key={group.label}>

            {/* Group label — only visible when expanded */}
            {open && (
              <p className="text-zinc-400 text-xs uppercase tracking-widest px-2 mb-1">
                {group.label}
              </p>
            )}

            <div className="flex flex-col gap-1">
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 p-2 rounded hover:bg-zinc-600 text-white ${
                    pathname === link.href ? "bg-zinc-600" : ""
                  }`}
                >
                  <span className="text-lg leading-none">{link.symbol}</span>
                  {open && <span className="text-sm">{link.label}</span>}
                </Link>
              ))}
            </div>

            {/* Divider between groups */}
            <hr className="border-zinc-600 mt-3" />
          </div>
        ))}
      </nav>
    </aside>
  );
}