"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import Link from "next/link";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");

  async function fetchSuppliers() {
    const supabase = createClient();
    setLoading(true);
    const { data } = await supabase
      .from("suppliers")
      .select("*")
      .order("created_at", { ascending: false });
    setSuppliers(data || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchSuppliers();
  }, []);

  async function deleteSupplier(id) {
    const supabase = createClient();
    if (!confirm("Delete this supplier?")) return;
    await supabase.from("suppliers").delete().eq("id", id);
    fetchSuppliers();
  }

  const filtered = suppliers.filter((s) => {
    const q = search.toLowerCase();
    return (
      (s.company_name   || "").toLowerCase().includes(q) ||
      (s.contact_person || "").toLowerCase().includes(q) ||
      (s.contact_title  || "").toLowerCase().includes(q) ||
      (s.city           || "").toLowerCase().includes(q) ||
      (s.country        || "").toLowerCase().includes(q) ||
      (s.phone_number   || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      {/* Header */}
      <div className="flex justify-between items-start mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage supplier records and contacts</p>
        </div>

        <Link
          href="/suppliers/new"
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          + New Supplier
        </Link>
      </div>

      {/* Control bar */}
      <div className="flex items-center gap-3 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company, contact, city, country, or phone…"
          className="text-black w-full max-w-sm border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear
          </button>
        )}
        {!loading && (
          <span className="ml-auto text-xs text-gray-400 shrink-0">
            {filtered.length} {filtered.length === 1 ? "supplier" : "suppliers"}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Company</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Contact</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Location</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Phone</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td className="px-4 py-4 text-sm text-gray-400" colSpan="5">Loading…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-sm text-gray-400 text-center" colSpan="5">
                  {search ? `No suppliers matching "${search}"` : "No suppliers yet"}
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.company_name}</td>

                  <td className="px-4 py-3">
                    <span className="text-gray-900">{s.contact_person}</span>
                    {s.contact_title && (
                      <div className="text-xs text-gray-400 mt-0.5">{s.contact_title}</div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-gray-500">
                    {[s.city, s.country].filter(Boolean).join(", ") || "—"}
                  </td>

                  <td className="px-4 py-3 text-gray-500">{s.phone_number || "—"}</td>

                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        href={`/suppliers/${s.id}`}
                        className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => deleteSupplier(s.id)}
                        className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}