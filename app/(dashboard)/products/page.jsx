"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

export default function ProductsPage() {
  const [tab, setTab] = useState("finished");
  const [finished, setFinished] = useState([]);
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function fetchData() {
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

  // Reset search when switching tabs
  function handleTabChange(t) {
    setTab(t);
    setSearch("");
  }

  async function deleteFinished(id) {
    if (!confirm("Delete this finished product?")) return;
    await supabase.from("finished_products_static").delete().eq("id", id);
    fetchData();
  }

  async function deleteRaw(id) {
    if (!confirm("Delete this raw material?")) return;
    await supabase.from("raw_materials_static").delete().eq("id", id);
    fetchData();
  }

  const q = search.toLowerCase();

  const filteredFinished = finished.filter((p) =>
    (p.name || "").toLowerCase().includes(q) ||
    (p.category_id || "").toLowerCase().includes(q) ||
    (p.unit_of_measurement || "").toLowerCase().includes(q)
  );

  const filteredRaw = raw.filter((m) =>
    (m.name || "").toLowerCase().includes(q) ||
    (m.category_id || "").toLowerCase().includes(q) ||
    (m.supplier_contact || "").toLowerCase().includes(q) ||
    (m.unit_of_measurement || "").toLowerCase().includes(q)
  );

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-sm text-gray-500">Manage finished goods and raw materials inventory</p>
      </div>

      {/* TABS */}
      <div className="flex space-x-2 mb-4">
        <button
          onClick={() => handleTabChange("finished")}
          className={`px-4 py-2 rounded-lg border ${
            tab === "finished" ? "bg-blue-600 text-white border-blue-600" : "bg-white"
          }`}
        >
          Finished Products
        </button>
        <button
          onClick={() => handleTabChange("raw")}
          className={`px-4 py-2 rounded-lg border ${
            tab === "raw" ? "bg-blue-600 text-white border-blue-600" : "bg-white"
          }`}
        >
          Raw Materials
        </button>
      </div>

      {/* SEARCH */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            tab === "finished"
              ? "Search by name, category, or unit…"
              : "Search by name, category, supplier, or unit…"
          }
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* CONTENT */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 text-gray-500">Loading…</div>
        ) : tab === "finished" ? (
          <>
            <div className="flex justify-between p-4 border-b">
              <h2 className="font-semibold">Finished Products</h2>
              <Link href="/products/finished/new" className="bg-blue-600 text-white px-3 py-2 rounded-lg">
                + Add Product
              </Link>
            </div>

            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left p-4">Name</th>
                  <th className="text-left p-4">Category</th>
                  <th className="text-left p-4">Qty/Unit</th>
                  <th className="text-left p-4">UOM</th>
                  <th className="text-left p-4">Status</th>
                  <th className="text-right p-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFinished.length === 0 ? (
                  <tr>
                    <td className="p-4 text-gray-500" colSpan="6">
                      {search ? `No finished products matching "${search}"` : "No finished products found"}
                    </td>
                  </tr>
                ) : (
                  filteredFinished.map((p) => (
                    <tr key={p.id} className="border-t hover:bg-gray-50">
                      <td className="p-4 font-medium">{p.name}</td>
                      <td className="p-4">{p.category_id}</td>
                      <td className="p-4">{p.quantity_per_unit}</td>
                      <td className="p-4">{p.unit_of_measurement}</td>
                      <td className="p-4">
                        {p.discontinued
                          ? <span className="text-red-600">Discontinued</span>
                          : <span className="text-green-600">Active</span>}
                      </td>
                      <td className="p-4 text-right space-x-2">
                        <Link href={`/products/finished/${p.id}`} className="text-blue-600 px-3 py-1 hover:bg-blue-50 rounded">Edit</Link>
                        <button onClick={() => deleteFinished(p.id)} className="text-red-600 px-3 py-1 hover:bg-red-50 rounded">Delete</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <div className="flex justify-between p-4 border-b">
              <h2 className="font-semibold">Raw Materials</h2>
              <Link href="/products/raw/new" className="bg-blue-600 text-white px-3 py-2 rounded-lg">
                + Add Material
              </Link>
            </div>

            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left p-4">Name</th>
                  <th className="text-left p-4">Category</th>
                  <th className="text-left p-4">Supplier</th>
                  <th className="text-left p-4">Qty/Unit</th>
                  <th className="text-left p-4">UOM</th>
                  <th className="text-left p-4">Status</th>
                  <th className="text-right p-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRaw.length === 0 ? (
                  <tr>
                    <td className="p-4 text-gray-500" colSpan="7">
                      {search ? `No raw materials matching "${search}"` : "No raw materials found"}
                    </td>
                  </tr>
                ) : (
                  filteredRaw.map((m) => (
                    <tr key={m.id} className="border-t hover:bg-gray-50">
                      <td className="p-4 font-medium">{m.name}</td>
                      <td className="p-4">{m.category_id}</td>
                      <td className="p-4">{m.supplier_contact}</td>
                      <td className="p-4">{m.quantity_per_unit}</td>
                      <td className="p-4">{m.unit_of_measurement}</td>
                      <td className="p-4">
                        {m.discontinued
                          ? <span className="text-red-600">Discontinued</span>
                          : <span className="text-green-600">Active</span>}
                      </td>
                      <td className="p-4 text-right space-x-2">
                        <Link href={`/products/raw/${m.id}`} className="text-blue-600 px-3 py-1 hover:bg-blue-50 rounded">Edit</Link>
                        <button onClick={() => deleteRaw(m.id)} className="text-red-600 px-3 py-1 hover:bg-red-50 rounded">Delete</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}