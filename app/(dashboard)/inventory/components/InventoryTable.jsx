"use client";

import { useState } from "react";

const LOW_STOCK_THRESHOLD = 100;

export default function InventoryTable({ items, loading, onSelect }) {
  const [search, setSearch] = useState("");

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>;

  const filtered = items.filter((i) =>
    i.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="bg-white border rounded-lg overflow-x-auto">

      {/* SEARCH */}
      <div className="p-3 border-b bg-gray-50">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products..."
          className="border px-3 py-2 rounded w-full max-w-xs"
        />
      </div>

      <table className="w-full text-sm min-w-[900px]">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-3 text-left">Name</th>
            <th className="p-3 text-left">Beginning</th>
            <th className="p-3 text-left">In</th>
            <th className="p-3 text-left">Out</th>
            <th className="p-3 text-left">Current</th>
            <th className="p-3 text-left">Actual</th>
            <th className="p-3 text-left">Loss</th>
            <th className="p-3 text-left">Action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan="8" className="p-4 text-gray-500">No data found</td></tr>
          ) : (
            filtered.map((i) => {
              const lowStock = Number(i.current_bal) < LOW_STOCK_THRESHOLD;

              return (
                <tr
                  key={i.id}
                  className={`border-t hover:bg-gray-50 ${lowStock ? "bg-red-50" : ""}`}
                >
                  <td className="p-3 font-medium">
                    {i.name}
                    {lowStock && (
                      <span className="ml-2 text-xs font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded">
                        Low stock
                      </span>
                    )}
                  </td>
                  <td className="p-3">{i.beg_bal}</td>
                  <td className="p-3 text-green-600">{i.incoming_bal}</td>
                  <td className="p-3 text-red-600">{i.outgoing_bal}</td>
                  <td className={`p-3 ${lowStock ? "text-red-600 font-semibold" : ""}`}>
                    {i.current_bal}
                  </td>
                  <td className="p-3">{i.actual_bal}</td>
                  <td className="p-3 text-orange-600">{i.loss}</td>
                  <td className="p-3">
                    <button onClick={() => onSelect(i)} className="bg-blue-600 text-white px-3 py-1 rounded">
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