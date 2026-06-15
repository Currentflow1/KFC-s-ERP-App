"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function NewRawMaterial() {
  const router = useRouter();

  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const [form, setForm] = useState({
    name: "",
    category_id: "",
    supplier_contact: "",
    quantity_per_unit: "",
    unit_of_measurement: "",
    discontinued: false,
  });

  useEffect(() => {
    supabase.from("categories").select("name").then(({ data }) => {
      setCategories(data || []);
    });

    supabase.from("suppliers").select("contact_person").then(({ data }) => {
      setSuppliers(data || []);
    });
  }, []);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;

    setForm({
      ...form,
      [name]: type === "checkbox" ? checked : value,
    });
  }

  async function submit() {
    await supabase.from("raw_materials_static").insert([
      {
        ...form,
        quantity_per_unit: Number(form.quantity_per_unit),
      },
    ]);

    router.push("/products");
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen flex justify-center">
      <div className="bg-white border rounded-xl shadow-sm p-6 w-full max-w-2xl">
        <h1 className="text-xl font-bold mb-6">New Raw Material</h1>

        <div className="space-y-4">
          <input
            name="name"
            placeholder="Material Name"
            onChange={handleChange}
            className="w-full border rounded-lg p-2"
          />

          <select
            name="category_id"
            onChange={handleChange}
            className="w-full border rounded-lg p-2"
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
            onChange={handleChange}
            className="w-full border rounded-lg p-2"
          >
            <option value="">Select Supplier Contact</option>
            {suppliers.map((s) => (
              <option key={s.contact_person} value={s.contact_person}>
                {s.contact_person}
              </option>
            ))}
          </select>

          <input
            name="quantity_per_unit"
            placeholder="Quantity Per Unit"
            onChange={handleChange}
            className="w-full border rounded-lg p-2"
          />

          <input
            name="unit_of_measurement"
            placeholder="Unit"
            onChange={handleChange}
            className="w-full border rounded-lg p-2"
          />

          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              name="discontinued"
              onChange={handleChange}
            />
            <span>Discontinued</span>
          </label>

          <button
            onClick={submit}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg w-full"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}