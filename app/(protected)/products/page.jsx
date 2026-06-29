"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import Link from "next/link";

export default function ProductsPage() {
  const [tab, setTab] = useState("finished");
  const [finished, setFinished] = useState([]);
  const [raw, setRaw] = useState([]);
  const [packaging, setPackaging] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  async function fetchData() {
    const supabase = createClient();
    setLoading(true);
    const [{ data: fin }, { data: rawMat }, { data: pkg }] = await Promise.all([
      supabase
        .from("finished_products_static")
        .select("*, finished_products_warehouses(warehouse)")
        .order("name", { ascending: true }),
      supabase
        .from("raw_materials_static")
        .select("*, raw_materials_warehouses(warehouse)")
        .order("name", { ascending: true }),
      supabase
        .from("packaging_static")
        .select("*, packaging_warehouses(warehouse)")
        .order("name", { ascending: true }),
    ]);
    setFinished(fin || []);
    setRaw(rawMat || []);
    setPackaging(pkg || []);
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  function handleTabChange(t) { setTab(t); setSearch(""); }

  async function deleteFinished(id) {
    const supabase = createClient();
    if (!confirm("Delete this finished product? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const { data: inventories, error: invFetchErr } = await supabase
        .from("finished_products_inventory")
        .select("id")
        .eq("finished_product_id", id);
      if (invFetchErr) throw invFetchErr;

      const inventoryIds = (inventories || []).map((i) => i.id);

      if (inventoryIds.length > 0) {
        const { error: histErr } = await supabase
          .from("finished_products_inventory_history")
          .delete()
          .in("inventory_id", inventoryIds);
        if (histErr) throw histErr;

        const { error: logErr } = await supabase
          .from("finished_products_transaction_log")
          .delete()
          .in("inventory_id", inventoryIds);
        if (logErr) throw logErr;

        const { error: invErr } = await supabase
          .from("finished_products_inventory")
          .delete()
          .in("id", inventoryIds);
        if (invErr) throw invErr;
      }

      const { error: whErr } = await supabase
        .from("finished_products_warehouses")
        .delete()
        .eq("finished_product_id", id);
      if (whErr) throw whErr;

      const { error: staticErr } = await supabase
        .from("finished_products_static")
        .delete()
        .eq("id", id);
      if (staticErr) throw staticErr;

      fetchData();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Delete failed: " + (err.message || "Unknown error"));
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteRaw(id) {
    const supabase = createClient();
    if (!confirm("Delete this raw material? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const { data: inventories, error: invFetchErr } = await supabase
        .from("raw_materials_inventory")
        .select("id")
        .eq("raw_material_id", id);
      if (invFetchErr) throw invFetchErr;

      const inventoryIds = (inventories || []).map((i) => i.id);

      if (inventoryIds.length > 0) {
        const { error: histErr } = await supabase
          .from("raw_materials_inventory_history")
          .delete()
          .in("inventory_id", inventoryIds);
        if (histErr) throw histErr;

        const { error: logErr } = await supabase
          .from("raw_materials_transaction_log")
          .delete()
          .in("inventory_id", inventoryIds);
        if (logErr) throw logErr;

        const { error: invErr } = await supabase
          .from("raw_materials_inventory")
          .delete()
          .in("id", inventoryIds);
        if (invErr) throw invErr;
      }

      const { error: whErr } = await supabase
        .from("raw_materials_warehouses")
        .delete()
        .eq("raw_material_id", id);
      if (whErr) throw whErr;

      const { error: staticErr } = await supabase
        .from("raw_materials_static")
        .delete()
        .eq("id", id);
      if (staticErr) throw staticErr;

      fetchData();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Delete failed: " + (err.message || "Unknown error"));
    } finally {
      setDeletingId(null);
    }
  }

  async function deletePackaging(id) {
    const supabase = createClient();
    if (!confirm("Delete this packaging item? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const { data: inventories, error: invFetchErr } = await supabase
        .from("packaging_inventory")
        .select("id")
        .eq("packaging_id", id);
      if (invFetchErr) throw invFetchErr;

      const inventoryIds = (inventories || []).map((i) => i.id);

      if (inventoryIds.length > 0) {
        const { error: histErr } = await supabase
          .from("packaging_inventory_history")
          .delete()
          .in("inventory_id", inventoryIds);
        if (histErr) throw histErr;

        const { error: logErr } = await supabase
          .from("packaging_transaction_log")
          .delete()
          .in("inventory_id", inventoryIds);
        if (logErr) throw logErr;

        const { error: invErr } = await supabase
          .from("packaging_inventory")
          .delete()
          .in("id", inventoryIds);
        if (invErr) throw invErr;
      }

      const { error: whErr } = await supabase
        .from("packaging_warehouses")
        .delete()
        .eq("packaging_id", id);
      if (whErr) throw whErr;

      const { error: staticErr } = await supabase
        .from("packaging_static")
        .delete()
        .eq("id", id);
      if (staticErr) throw staticErr;

      fetchData();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Delete failed: " + (err.message || "Unknown error"));
    } finally {
      setDeletingId(null);
    }
  }

  const q = search.toLowerCase();

  const filteredFinished = finished.filter((p) => {
    const warehouses = (p.finished_products_warehouses || []).map((w) => w.warehouse).join(" ").toLowerCase();
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.category_name || "").toLowerCase().includes(q) ||
      warehouses.includes(q)
    );
  });

  const filteredRaw = raw.filter((m) => {
    const warehouses = (m.raw_materials_warehouses || []).map((w) => w.warehouse).join(" ").toLowerCase();
    return (
      (m.name || "").toLowerCase().includes(q) ||
      (m.category_name || "").toLowerCase().includes(q) ||
      (m.supplier_contact || "").toLowerCase().includes(q) ||
      warehouses.includes(q)
    );
  });

  const filteredPackaging = packaging.filter((m) => {
    const warehouses = (m.packaging_warehouses || []).map((w) => w.warehouse).join(" ").toLowerCase();
    return (
      (m.name || "").toLowerCase().includes(q) ||
      (m.category_name || "").toLowerCase().includes(q) ||
      (m.supplier_contact || "").toLowerCase().includes(q) ||
      warehouses.includes(q)
    );
  });

  const filtered =
    tab === "finished" ? filteredFinished :
    tab === "raw" ? filteredRaw :
    filteredPackaging;

  const newHref =
    tab === "finished" ? "/products/finished/new" :
    tab === "raw" ? "/products/raw/new" :
    "/products/packaging/new";

  const newLabel =
    tab === "finished" ? "New Product" :
    tab === "raw" ? "New Material" :
    "New Packaging";

  const searchPlaceholder =
    tab === "finished" ? "Search by name, category, or warehouse…" :
    "Search by name, category, supplier, or warehouse…";

  function renderWarehouses(list) {
    if (!list || list.length === 0) return "—";
    return list.map((w) => w.warehouse).join(", ");
  }

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      <div className="flex justify-between items-start mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage finished goods, raw materials, and packaging inventory</p>
        </div>
        <Link
          href={newHref}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          + {newLabel}
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
          <button onClick={() => handleTabChange("packaging")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "packaging" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}`}>
            Packaging
          </button>
        </div>

        <div className="w-px h-5 bg-gray-200" />

        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
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
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Warehouses</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td className="px-4 py-4 text-sm text-gray-400" colSpan="5">Loading…</td></tr>
              ) : filteredFinished.length === 0 ? (
                <tr><td className="px-4 py-8 text-sm text-gray-400 text-center" colSpan="5">
                  {search ? `No products matching "${search}"` : "No finished products yet"}
                </td></tr>
              ) : filteredFinished.map((p) => (
                <tr
                  key={p.id}
                  className={`transition-colors ${p.discontinued ? "bg-gray-50 opacity-60" : "hover:bg-gray-50"}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <span className={p.discontinued ? "line-through text-gray-400" : ""}>{p.name}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.category_name}</td>
                  <td className="px-4 py-3 text-gray-500">{renderWarehouses(p.finished_products_warehouses)}</td>
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
                      <button
                        onClick={() => deleteFinished(p.id)}
                        disabled={deletingId === p.id}
                        className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {deletingId === p.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "raw" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Category</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Supplier</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Warehouses</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td className="px-4 py-4 text-sm text-gray-400" colSpan="6">Loading…</td></tr>
              ) : filteredRaw.length === 0 ? (
                <tr><td className="px-4 py-8 text-sm text-gray-400 text-center" colSpan="6">
                  {search ? `No materials matching "${search}"` : "No raw materials yet"}
                </td></tr>
              ) : filteredRaw.map((m) => (
                <tr
                  key={m.id}
                  className={`transition-colors ${m.discontinued ? "bg-gray-50 opacity-60" : "hover:bg-gray-50"}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <span className={m.discontinued ? "line-through text-gray-400" : ""}>{m.name}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{m.category_name}</td>
                  <td className="px-4 py-3 text-gray-500">{m.supplier_contact}</td>
                  <td className="px-4 py-3 text-gray-500">{renderWarehouses(m.raw_materials_warehouses)}</td>
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
                      <button
                        onClick={() => deleteRaw(m.id)}
                        disabled={deletingId === m.id}
                        className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {deletingId === m.id ? "Deleting…" : "Delete"}
                      </button>
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
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Warehouses</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td className="px-4 py-4 text-sm text-gray-400" colSpan="6">Loading…</td></tr>
              ) : filteredPackaging.length === 0 ? (
                <tr><td className="px-4 py-8 text-sm text-gray-400 text-center" colSpan="6">
                  {search ? `No packaging matching "${search}"` : "No packaging items yet"}
                </td></tr>
              ) : filteredPackaging.map((m) => (
                <tr
                  key={m.id}
                  className={`transition-colors ${m.discontinued ? "bg-gray-50 opacity-60" : "hover:bg-gray-50"}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <span className={m.discontinued ? "line-through text-gray-400" : ""}>{m.name}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{m.category_name}</td>
                  <td className="px-4 py-3 text-gray-500">{m.supplier_contact}</td>
                  <td className="px-4 py-3 text-gray-500">{renderWarehouses(m.packaging_warehouses)}</td>
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
                      <Link href={`/products/packaging/${m.id}`} className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors">Edit</Link>
                      <button
                        onClick={() => deletePackaging(m.id)}
                        disabled={deletingId === m.id}
                        className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {deletingId === m.id ? "Deleting…" : "Delete"}
                      </button>
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