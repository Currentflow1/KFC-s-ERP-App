"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

export default function EditRawMaterial({ params }) {
  const router = useRouter();
  const { id } = use(params);

  const [form, setForm] = useState(null);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: item }, { data: cats }, { data: sups }] =
        await Promise.all([
          supabase
            .from("raw_materials_static")
            .select("*")
            .eq("id", id)
            .single(),

          supabase.from("categories").select("name"),

          supabase.from("suppliers").select("contact_person"),
        ]);

      setForm(item);
      setCategories(cats || []);
      setSuppliers(sups || []);
    }

    load();
  }, [id]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;

    setForm({
      ...form,
      [name]: type === "checkbox" ? checked : value,
    });
  }

  async function update() {
    const supabase = createClient();
    await supabase
      .from("raw_materials_static")
      .update({
        ...form,
        quantity_per_unit: Number(form.quantity_per_unit),
      })
      .eq("id", id);

    router.push("/products");
  }

  if (!form) {
    return (
      <div className="p-8 bg-gray-50 min-h-screen text-gray-500">
        Loading material...
      </div>
    );
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen flex justify-center">
      <div className="w-full max-w-2xl bg-white border rounded-xl shadow-sm p-6">
        <h1 className="text-black text-xl font-bold mb-6">Edit Raw Material</h1>

        <div className="space-y-4">
          <input
            name="name"
            value={form.name || ""}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2"
          />

          <select
            name="category_id"
            value={form.category_id || ""}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2"
          >
            <option value="">Select Category</option>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            name="supplier_contact"
            value={form.supplier_contact || ""}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2"
          >
            <option value="">Select Supplier</option>
            {suppliers.map((s) => (
              <option key={s.contact_person} value={s.contact_person}>
                {s.contact_person}
              </option>
            ))}
          </select>

          <input
            name="quantity_per_unit"
            value={form.quantity_per_unit || ""}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2"
          />

          <input
            name="unit_of_measurement"
            value={form.unit_of_measurement || ""}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2"
          />

          <label className="text-black flex items-center space-x-2">
            <input
              type="checkbox"
              name="discontinued"
              checked={form.discontinued}
              onChange={handleChange}
            />
            <span>Discontinued</span>
          </label>

          <div className="flex justify-end space-x-3">
            <button
              onClick={() => router.push("/products")}
              className="px-4 py-2 border rounded-lg"
            >
              Cancel
            </button>

            <button
              onClick={update}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg"
            >
              Update
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}