"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient"
import Link from "next/link";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);

  async function fetchSuppliers() {
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
    const confirmDelete = confirm("Delete this supplier?");
    if (!confirmDelete) return;

    await supabase.from("suppliers").delete().eq("id", id);
    fetchSuppliers();
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500">
            Manage supplier records and contacts
          </p>
        </div>

        <Link
          href="/suppliers/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + New Supplier
        </Link>
      </div>

      {/* Table */}
      <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-xs uppercase text-gray-600">
            <tr>
              <th className="text-left p-4">Company</th>
              <th className="text-left p-4">Contact</th>
              <th className="text-left p-4">Location</th>
              <th className="text-left p-4">Phone</th>
              <th className="text-right p-4">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="p-4" colSpan="5">
                  Loading...
                </td>
              </tr>
            ) : suppliers.length === 0 ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan="5">
                  No suppliers found
                </td>
              </tr>
            ) : (
              suppliers.map((s) => (
                <tr key={s.id} className="border-t hover:bg-gray-50">
                  <td className="p-4 font-medium">{s.company_name}</td>

                  <td className="p-4">
                    {s.contact_person}
                    <div className="text-xs text-gray-400">
                      {s.contact_title}
                    </div>
                  </td>

                  <td className="p-4">
                    {s.city}, {s.country}
                  </td>

                  <td className="p-4">{s.phone_number}</td>

                  <td className="p-4 text-right space-x-2">
                    <Link
                      href={`/suppliers/${s.id}`}
                      className="text-blue-600 hover:bg-blue-50 px-3 py-1 rounded"
                    >
                      Edit
                    </Link>

                    <button
                      onClick={() => deleteSupplier(s.id)}
                      className="text-red-600 hover:bg-red-50 px-3 py-1 rounded"
                    >
                      Delete
                    </button>
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