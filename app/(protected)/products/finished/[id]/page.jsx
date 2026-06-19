"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

export default function EditFinishedProduct({ params }) {
  const router = useRouter();
  const { id } = use(params);

  const [form, setForm] = useState(null);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: product }, { data: cats }] = await Promise.all([
        supabase.from("finished_products_static").select("*").eq("id", id).single(),
        supabase.from("categories").select("name"),
      ]);
      setForm(product);
      setCategories(cats || []);
    }
    load();
  }, [id]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm({ ...form, [name]: type === "checkbox" ? checked : value });
  }

  async function update() {
    const supabase = createClient();
    const { error } = await supabase
      .from("finished_products_static")
      .update({
        name:                form.name,
        category_name:       form.category_name,   // ← fixed
        quantity_per_unit:   Number(form.quantity_per_unit),
        unit_of_measurement: form.unit_of_measurement,
        discontinued:        form.discontinued,
      })
      .eq("id", id);

    if (error) { alert("Update failed: " + error.message); return; }
    router.push("/products");
  }

  if (!form) return <div className="p-8 bg-gray-50 min-h-screen text-gray-500">Loading product...</div>;

  return (
    <div className="p-8 bg-gray-50 min-h-screen flex justify-center">
      <div className="w-full max-w-2xl bg-white border rounded-xl shadow-sm p-6">
        <h1 className="text-black text-xl font-bold mb-6">Edit Finished Product</h1>
        <div className="space-y-4">

          <input
            name="name"
            value={form.name || ""}
            onChange={handleChange}
            placeholder="Name"
            className="text-black w-full border rounded-lg p-2"
          />

          <select
            name="category_name"
            value={form.category_name || ""}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2"
          >
            <option value="">Select Category</option>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>

          <input
            name="quantity_per_unit"
            value={form.quantity_per_unit || ""}
            onChange={handleChange}
            placeholder="Quantity Per Unit"
            className="text-black w-full border rounded-lg p-2"
          />

          <input
            name="unit_of_measurement"
            value={form.unit_of_measurement || ""}
            onChange={handleChange}
            placeholder="Unit (kg, pcs, etc)"
            className="text-black w-full border rounded-lg p-2"
          />

          <label className="text-black flex items-center space-x-2">
            <input type="checkbox" name="discontinued" checked={form.discontinued} onChange={handleChange} />
            <span>Discontinued</span>
          </label>

          <div className="flex justify-end space-x-3">
            <button onClick={() => router.push("/products")} className="px-4 py-2 border rounded-lg">Cancel</button>
            <button onClick={update} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Update</button>
          </div>
        </div>
      </div>
    </div>
  );
}