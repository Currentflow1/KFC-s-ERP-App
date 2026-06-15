"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  async function fetchCategories() {
    setLoading(true);

    const { data } = await supabase
      .from("categories")
      .select("*")
      .order("created_at", { ascending: false });

    setCategories(data || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchCategories();
  }, []);

  async function deleteCategory(id) {
    const ok = confirm("Delete this category?");
    if (!ok) return;

    await supabase.from("categories").delete().eq("id", id);
    fetchCategories();
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* HEADER */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <p className="text-sm text-gray-500">
            Manage product categories
          </p>
        </div>

        <Link
          href="/categories/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + New Category
        </Link>
      </div>

      {/* TABLE */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-xs uppercase text-gray-600">
            <tr>
              <th className="text-left p-4">Name</th>
              <th className="text-left p-4">Description</th>
              <th className="text-right p-4">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="p-4" colSpan="3">
                  Loading...
                </td>
              </tr>
            ) : categories.length === 0 ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan="3">
                  No categories found
                </td>
              </tr>
            ) : (
              categories.map((c) => (
                <tr key={c.id} className="border-t hover:bg-gray-50">
                  <td className="p-4 font-medium">{c.name}</td>
                  <td className="p-4 text-gray-600">
                    {c.description || "—"}
                  </td>

                  <td className="p-4 text-right space-x-2">
                    <Link
                      href={`/categories/${c.id}`}
                      className="text-blue-600 hover:bg-blue-50 px-3 py-1 rounded"
                    >
                      Edit
                    </Link>

                    <button
                      onClick={() => deleteCategory(c.id)}
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