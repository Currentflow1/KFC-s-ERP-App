"use client";

import { useState } from "react";

const LOW_STOCK_THRESHOLD = 100;

export default function InventoryTable({ items, loading, onSelect }) {
  const [search, setSearch] = useState("");

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;

  const filtered = items.filter((i) =>
    i.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="overflow-x-auto">

      {/* Search */}
      <div className="flex items-center gap-3 p-3 border-b border-gray-200 bg-gray-50">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="text-black w-full max-w-xs border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-black text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400 shrink-0">
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
        </span>
      </div>

      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Beginning</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">In</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Out</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Current</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actual</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Loss</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filtered.length === 0 ? (
            <tr>
              <td colSpan="8" className="px-4 py-8 text-sm text-gray-400 text-center">
                {search ? `No items matching "${search}"` : "No data found"}
              </td>
            </tr>
          ) : (
            filtered.map((i) => {
              const lowStock = Number(i.current_bal) < LOW_STOCK_THRESHOLD;

              return (
                <tr
                  key={i.id}
                  className={`hover:bg-gray-50 transition-colors ${lowStock ? "bg-red-50/60" : ""}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {i.name}
                    {lowStock && (
                      <span className="ml-2 text-xs font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-md">
                        Low stock
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{i.beg_bal}</td>
                  <td className="px-4 py-3 text-green-600">{i.incoming_bal}</td>
                  <td className="px-4 py-3 text-red-600">{i.outgoing_bal}</td>
                  <td className={`px-4 py-3 ${lowStock ? "text-red-600 font-semibold" : "text-gray-700"}`}>
                    {i.current_bal}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{i.actual_bal}</td>
                  <td className="px-4 py-3 text-orange-600">{i.loss}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onSelect(i)}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
                    >
                      Manipulate
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}