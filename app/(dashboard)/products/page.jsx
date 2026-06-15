"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

export default function ProductsPage() {
  const [tab, setTab] = useState("finished");

  const [finished, setFinished] = useState([]);
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);

  async function fetchData() {
    setLoading(true);

    const [{ data: fin }, { data: rawMat }] = await Promise.all([
      supabase
        .from("finished_products_static")
        .select("*")
        .order("created_at", { ascending: false }),

      supabase
        .from("raw_materials_static")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

    setFinished(fin || []);
    setRaw(rawMat || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function deleteFinished(id) {
    const ok = confirm("Delete this finished product?");
    if (!ok) return;

    await supabase.from("finished_products_static").delete().eq("id", id);
    fetchData();
  }

  async function deleteRaw(id) {
    const ok = confirm("Delete this raw material?");
    if (!ok) return;

    await supabase.from("raw_materials_static").delete().eq("id", id);
    fetchData();
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-sm text-gray-500">
          Manage finished goods and raw materials inventory
        </p>
      </div>

      {/* TABS */}
      <div className="flex space-x-2 mb-6">
        <button
          onClick={() => setTab("finished")}
          className={`px-4 py-2 rounded-lg border ${
            tab === "finished"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white"
          }`}
        >
          Finished Products
        </button>

        <button
          onClick={() => setTab("raw")}
          className={`px-4 py-2 rounded-lg border ${
            tab === "raw"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white"
          }`}
        >
          Raw Materials
        </button>
      </div>

      {/* CONTENT */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 text-gray-500">Loading...</div>
        ) : tab === "finished" ? (
          <>
            {/* HEADER ROW */}
            <div className="flex justify-between p-4 border-b">
              <h2 className="font-semibold">Finished Products</h2>

              <Link
                href="/products/finished/new"
                className="bg-blue-600 text-white px-3 py-2 rounded-lg"
              >
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
                {finished.length === 0 ? (
                  <tr>
                    <td className="p-4 text-gray-500" colSpan="6">
                      No finished products found
                    </td>
                  </tr>
                ) : (
                  finished.map((p) => (
                    <tr key={p.id} className="border-t hover:bg-gray-50">
                      <td className="p-4 font-medium">{p.name}</td>
                      <td className="p-4">{p.category_id}</td>
                      <td className="p-4">{p.quantity_per_unit}</td>
                      <td className="p-4">{p.unit_of_measurement}</td>
                      <td className="p-4">
                        {p.discontinued ? (
                          <span className="text-red-600">Discontinued</span>
                        ) : (
                          <span className="text-green-600">Active</span>
                        )}
                      </td>

                      <td className="p-4 text-right space-x-2">
                        <Link
                          href={`/products/finished/${p.id}`}
                          className="text-blue-600 px-3 py-1 hover:bg-blue-50 rounded"
                        >
                          Edit
                        </Link>

                        <button
                          onClick={() => deleteFinished(p.id)}
                          className="text-red-600 px-3 py-1 hover:bg-red-50 rounded"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        ) : (
          <>
            {/* RAW MATERIALS */}
            <div className="flex justify-between p-4 border-b">
              <h2 className="font-semibold">Raw Materials</h2>

              <Link
                href="/products/raw/new"
                className="bg-blue-600 text-white px-3 py-2 rounded-lg"
              >
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
                {raw.length === 0 ? (
                  <tr>
                    <td className="p-4 text-gray-500" colSpan="7">
                      No raw materials found
                    </td>
                  </tr>
                ) : (
                  raw.map((m) => (
                    <tr key={m.id} className="border-t hover:bg-gray-50">
                      <td className="p-4 font-medium">{m.name}</td>
                      <td className="p-4">{m.category_id}</td>
                      <td className="p-4">{m.supplier_contact}</td>
                      <td className="p-4">{m.quantity_per_unit}</td>
                      <td className="p-4">{m.unit_of_measurement}</td>

                      <td className="p-4">
                        {m.discontinued ? (
                          <span className="text-red-600">Discontinued</span>
                        ) : (
                          <span className="text-green-600">Active</span>
                        )}
                      </td>

                      <td className="p-4 text-right space-x-2">
                        <Link
                          href={`/products/raw/${m.id}`}
                          className="text-blue-600 px-3 py-1 hover:bg-blue-50 rounded"
                        >
                          Edit
                        </Link>

                        <button
                          onClick={() => deleteRaw(m.id)}
                          className="text-red-600 px-3 py-1 hover:bg-red-50 rounded"
                        >
                          Delete
                        </button>
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