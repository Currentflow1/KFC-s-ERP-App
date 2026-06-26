"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

function SearchableSelect({ value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(""); }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(opt) { onChange(opt); setOpen(false); setQuery(""); }
  function clear(e) { e.stopPropagation(); onChange(""); setQuery(""); }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => { setOpen((p) => !p); setQuery(""); }}
        className="text-black w-full flex items-center justify-between border rounded-lg px-3 py-2 bg-white text-sm text-left hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500">
        <span className={value ? "text-gray-800" : "text-gray-400"}>{value || placeholder}</span>
        <span className="flex items-center gap-1 ml-2 shrink-0">
          {value && <span onClick={clear} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer px-1">✕</span>}
          <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {filtered.length === 0
              ? <li className="px-3 py-2 text-sm text-gray-400">No results</li>
              : filtered.map((o) => (
                <li key={o} onClick={() => select(o)}
                  className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 ${value === o ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}>
                  {o}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WarehouseInput({ warehouses, onChange }) {
  const [input, setInput] = useState("");

  function add() {
    const val = input.trim();
    if (!val || warehouses.includes(val)) { setInput(""); return; }
    onChange([...warehouses, val]);
    setInput("");
  }

  function remove(w) { onChange(warehouses.filter((x) => x !== w)); }

  function onKeyDown(e) {
    if (e.key === "Enter") { e.preventDefault(); add(); }
  }

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Add warehouse and press Enter"
          className="text-black flex-1 border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="button" onClick={add}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg">Add</button>
      </div>
      {warehouses.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {warehouses.map((w) => (
            <span key={w} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">
              {w}
              <button type="button" onClick={() => remove(w)} className="hover:text-blue-900 ml-0.5">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewRawMaterial() {
  const router = useRouter();
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({
    name: "",
    category_name: "",
    supplier_contact: "",
    discontinued: false,
  });

  useEffect(() => {
    const supabase = createClient();
    supabase.from("categories").select("name").then(({ data }) =>
      setCategories((data || []).map((c) => c.name))
    );
    supabase.from("suppliers").select("contact_person").then(({ data }) =>
      setSuppliers((data || []).map((s) => s.contact_person))
    );
  }, []);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm({ ...form, [name]: type === "checkbox" ? checked : value });
  }

  async function submit() {
    const supabase = createClient();

    const { data: inserted, error } = await supabase
      .from("raw_materials_static")
      .insert([{ name: form.name, category_name: form.category_name, supplier_contact: form.supplier_contact, discontinued: form.discontinued }])
      .select("id")
      .single();

    if (error) { alert("Save failed: " + error.message); return; }

    if (warehouses.length > 0) {
      const rows = warehouses.map((w) => ({ raw_material_id: inserted.id, warehouse: w }));
      const { error: wErr } = await supabase.from("raw_materials_warehouses").insert(rows);
      if (wErr) { alert("Material saved but warehouse save failed: " + wErr.message); return; }
    }

    router.push("/products");
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen flex justify-center">
      <div className="bg-white border rounded-xl shadow-sm p-6 w-full max-w-2xl">
        <h1 className="text-black text-xl font-bold mb-6">New Raw Material</h1>
        <div className="space-y-4">

          <input name="name" placeholder="Material Name" value={form.name} onChange={handleChange}
            className="text-black w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

          <SearchableSelect placeholder="Select Category" value={form.category_name} options={categories}
            onChange={(v) => setForm((p) => ({ ...p, category_name: v }))} />

          <SearchableSelect placeholder="Select Supplier Contact" value={form.supplier_contact} options={suppliers}
            onChange={(v) => setForm((p) => ({ ...p, supplier_contact: v }))} />

          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Warehouses</label>
            <WarehouseInput warehouses={warehouses} onChange={setWarehouses} />
          </div>

          <label className="text-black flex items-center space-x-2 text-sm">
            <input type="checkbox" name="discontinued" checked={form.discontinued} onChange={handleChange} />
            <span>Discontinued</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button onClick={() => router.push("/products")} className="flex-1 border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={submit} className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}