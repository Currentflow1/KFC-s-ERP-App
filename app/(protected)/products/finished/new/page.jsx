"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

// ── Searchable Select ─────────────────────────────────────────────────────────

function SearchableSelect({ label, value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(opt) {
    onChange(opt);
    setOpen(false);
    setQuery("");
  }

  function clear(e) {
    e.stopPropagation();
    onChange("");
    setQuery("");
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen((p) => !p); setQuery(""); }}
        className="text-black w-full flex items-center justify-between border rounded-lg px-3 py-2 bg-white text-sm text-left hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className={value ? "text-gray-800" : "text-gray-400"}>
          {value || placeholder}
        </span>
        <span className="flex items-center gap-1 ml-2 shrink-0">
          {value && (
            <span onClick={clear} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer px-1">✕</span>
          )}
          <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">No results</li>
            ) : (
              filtered.map((o) => (
                <li
                  key={o}
                  onClick={() => select(o)}
                  className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 ${
                    value === o ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"
                  }`}
                >
                  {o}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewFinishedProduct() {
  const router = useRouter();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    name: "",
    category_id: "",
    quantity_per_unit: "",
    unit_of_measurement: "",
    discontinued: false,
  });

  useEffect(() => {
    const supabase = createClient();
    supabase.from("categories").select("name").then(({ data }) =>
      setCategories((data || []).map((c) => c.name))
    );
  }, []);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm({ ...form, [name]: type === "checkbox" ? checked : value });
  }

  async function submit() {
    const supabase = createClient();
    await supabase.from("finished_products_static").insert([
      { ...form, quantity_per_unit: Number(form.quantity_per_unit) },
    ]);
    router.push("/products");
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen flex justify-center">
      <div className="bg-white border rounded-xl shadow-sm p-6 w-full max-w-2xl">
        <h1 className="text-black text-xl font-bold mb-6">New Finished Product</h1>

        <div className="space-y-4">
          <input
            name="name"
            placeholder="Product Name"
            value={form.name}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <SearchableSelect
            placeholder="Select Category"
            value={form.category_id}
            options={categories}
            onChange={(v) => setForm((p) => ({ ...p, category_id: v }))}
          />

          <input
            name="quantity_per_unit"
            placeholder="Quantity Per Unit"
            value={form.quantity_per_unit}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <input
            name="unit_of_measurement"
            placeholder="Unit (kg, pcs, etc)"
            value={form.unit_of_measurement}
            onChange={handleChange}
            className="text-black w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <label className="text-black flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              name="discontinued"
              checked={form.discontinued}
              onChange={handleChange}
            />
            <span>Discontinued</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => router.push("/products")}
              className="flex-1 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}