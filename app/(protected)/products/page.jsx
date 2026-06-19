"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import Link from "next/link";

export default function ProductsPage() {
  const [tab, setTab] = useState("finished");
  const [finished, setFinished] = useState([]);
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function fetchData() {
    const supabase = createClient();
    setLoading(true);
    const [{ data: fin }, { data: rawMat }] = await Promise.all([
      supabase.from("finished_products_static").select("*").order("created_at", { ascending: false }),
      supabase.from("raw_materials_static").select("*").order("created_at", { ascending: false }),
    ]);
    setFinished(fin || []);
    setRaw(rawMat || []);
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  function handleTabChange(t) { setTab(t); setSearch(""); }

  async function deleteFinished(id) {
    const supabase = createClient();
    if (!confirm("Delete this finished product?")) return;
    await supabase.from("finished_products_static").delete().eq("id", id);
    fetchData();
  }

  async function deleteRaw(id) {
    const supabase = createClient();
    if (!confirm("Delete this raw material?")) return;
    await supabase.from("raw_materials_static").delete().eq("id", id);
    fetchData();
  }

  const q = search.toLowerCase();

  const filteredFinished = finished.filter((p) =>
    (p.name || "").toLowerCase().includes(q) ||
    (p.category_name || "").toLowerCase().includes(q) ||   // ← fixed
    (p.unit_of_measurement || "").toLowerCase().includes(q)
  );

  const filteredRaw = raw.filter((m) =>
    (m.name || "").toLowerCase().includes(q) ||
    (m.category_name || "").toLowerCase().includes(q) ||   // ← fixed
    (m.supplier_contact || "").toLowerCase().includes(q) || // ← fixed
    (m.unit_of_measurement || "").toLowerCase().includes(q)
  );

  const filtered = tab === "finished" ? filteredFinished : filteredRaw;

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      <div className="flex justify-between items-start mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage finished goods and raw materials inventory</p>
        </div>
        <Link
          href={tab === "finished" ? "/products/finished/new" : "/products/raw/new"}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          + {tab === "finished" ? "New Product" : "New Material"}
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex gap-1">
          <button onClick={() => handleTabChange("finished")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "finished" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}`}>
            Finished Products
          </button>
          <button onClick={() => handleTabChange("raw")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "raw" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}`}>
            Raw Materials
          </button>
        </div>

        <div className="w-px h-5 bg-gray-200" />

        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === "finished" ? "Search by name, category, or unit…" : "Search by name, category, supplier, or unit…"}
          className="text-black w-full max-w-sm border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {search && (
          <button onClick={() => setSearch("")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Clear</button>
        )}

        {!loading && (
          <span className="ml-auto text-xs text-gray-400 shrink-0">
            {filtered.length} {filtered.length === 1 ? "item" : "items"}
          </span>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        {tab === "finished" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Category</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Qty / Unit</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">UOM</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td className="px-4 py-4 text-sm text-gray-400" colSpan="6">Loading…</td></tr>
              ) : filteredFinished.length === 0 ? (
                <tr><td className="px-4 py-8 text-sm text-gray-400 text-center" colSpan="6">
                  {search ? `No products matching "${search}"` : "No finished products yet"}
                </td></tr>
              ) : filteredFinished.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 text-gray-500">{p.category_name}</td>
                  <td className="px-4 py-3 text-gray-500">{p.quantity_per_unit}</td>
                  <td className="px-4 py-3 text-gray-500">{p.unit_of_measurement}</td>
                  <td className="px-4 py-3">
                    {p.discontinued ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> Discontinued
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link href={`/products/finished/${p.id}`} className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors">Edit</Link>
                      <button onClick={() => deleteFinished(p.id)} className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Category</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Supplier</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Qty / Unit</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">UOM</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td className="px-4 py-4 text-sm text-gray-400" colSpan="7">Loading…</td></tr>
              ) : filteredRaw.length === 0 ? (
                <tr><td className="px-4 py-8 text-sm text-gray-400 text-center" colSpan="7">
                  {search ? `No materials matching "${search}"` : "No raw materials yet"}
                </td></tr>
              ) : filteredRaw.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-3 text-gray-500">{m.category_name}</td>
                  <td className="px-4 py-3 text-gray-500">{m.supplier_contact}</td>
                  <td className="px-4 py-3 text-gray-500">{m.quantity_per_unit}</td>
                  <td className="px-4 py-3 text-gray-500">{m.unit_of_measurement}</td>
                  <td className="px-4 py-3">
                    {m.discontinued ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> Discontinued
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link href={`/products/raw/${m.id}`} className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors">Edit</Link>
                      <button onClick={() => deleteRaw(m.id)} className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}