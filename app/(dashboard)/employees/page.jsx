"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── helpers ──────────────────────────────────────────────────────────────────

function Avatar({ name }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
      {initials}
    </div>
  );
}

// ─── modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-bold text-lg">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        <p className="text-gray-700 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded border text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─── shared form helpers ──────────────────────────────────────────────────────

function FormFields({ form, setForm, fields, error, hints = {} }) {
  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <div key={f}>
          <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">{f}</label>
          <input
            value={form[f]}
            onChange={(e) => setForm((prev) => ({ ...prev, [f]: e.target.value }))}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder={hints[f] ?? ""}
          />
          {hints[f] && <p className="text-xs text-gray-400 mt-1">{hints[f]}</p>}
        </div>
      ))}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

function ModalActions({ onCancel, onSave, saving }) {
  return (
    <div className="flex gap-3 justify-end mt-6">
      <button onClick={onCancel} className="px-4 py-2 rounded border text-gray-600 hover:bg-gray-50 text-sm">Cancel</button>
      <button onClick={onSave} disabled={saving} className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// ─── monitoring table ─────────────────────────────────────────────────────────

function MonitoringTable() {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", role: "" });
  const [error, setError] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("monitoring_employee")
      .select("*")
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }

  function openAdd() { setForm({ name: "", role: "" }); setError(""); setShowAdd(true); }
  function openEdit(row) { setForm({ name: row.name, role: row.role }); setError(""); setEditRow(row); }

  async function save() {
    if (!form.name.trim() || !form.role.trim()) { setError("Both fields are required."); return; }
    setSaving(true);
    setError("");
    if (editRow) {
      const { error: e } = await supabase
        .from("monitoring_employee")
        .update({ name: form.name.trim(), role: form.role.trim() })
        .eq("id", editRow.id);
      if (e) { setError(e.message); setSaving(false); return; }
      setEditRow(null);
    } else {
      const { error: e } = await supabase
        .from("monitoring_employee")
        .insert({ name: form.name.trim(), role: form.role.trim() });
      if (e) { setError(e.message); setSaving(false); return; }
      setShowAdd(false);
    }
    setSaving(false);
    load();
  }

  async function confirmDelete() {
    await supabase.from("monitoring_employee").delete().eq("id", deleteRow.id);
    setDeleteRow(null);
    load();
  }

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-white border rounded-lg overflow-hidden">

      <div
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between p-4 border-b bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-xs transition-transform duration-200">
            {open ? "▲" : "▼"}
          </span>
          <div>
            <h2 className="font-bold text-gray-900">Monitoring Employees</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {rows.length} employee{rows.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <button
            onClick={openAdd}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700"
          >
            + Add employee
          </button>
        </div>
      </div>

      {open && (
        <>
          <div className="p-3 border-b bg-gray-50">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or role..."
              className="border px-3 py-2 rounded w-full max-w-xs text-sm"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-3 text-left">Employee</th>
                  <th className="p-3 text-left">Role</th>
                  <th className="p-3 text-left">Added</th>
                  <th className="p-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="p-6 text-gray-500">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-gray-500">No employees found.</td></tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.id} className="border-t hover:bg-gray-50">
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={row.name} />
                          <span className="font-medium">{row.name}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          {row.role}
                        </span>
                      </td>
                      <td className="p-3 text-gray-400 text-xs">
                        {new Date(row.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(row)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Edit</button>
                          <button onClick={() => setDeleteRow(row)} className="bg-red-50 text-red-600 border border-red-200 px-3 py-1 rounded text-xs">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showAdd && (
        <Modal title="Add monitoring employee" onClose={() => setShowAdd(false)}>
          <FormFields form={form} setForm={setForm} fields={["name", "role"]} error={error} />
          <ModalActions onCancel={() => setShowAdd(false)} onSave={save} saving={saving} />
        </Modal>
      )}
      {editRow && (
        <Modal title="Edit monitoring employee" onClose={() => setEditRow(null)}>
          <FormFields form={form} setForm={setForm} fields={["name", "role"]} error={error} />
          <ModalActions onCancel={() => setEditRow(null)} onSave={save} saving={saving} />
        </Modal>
      )}
      {deleteRow && (
        <ConfirmModal
          message={`Delete "${deleteRow.name}"? This cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteRow(null)}
        />
      )}
    </div>
  );
}

// ─── representative table ─────────────────────────────────────────────────────

function RepresentativeTable() {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", products: "" });
  const [error, setError] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("representative_employee")
      .select("*")
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }

  function openAdd() { setForm({ name: "", products: "" }); setError(""); setShowAdd(true); }
  function openEdit(row) { setForm({ name: row.name, products: row.products }); setError(""); setEditRow(row); }

  async function save() {
    if (!form.name.trim() || !form.products.trim()) { setError("Both fields are required."); return; }
    setSaving(true);
    setError("");
    if (editRow) {
      const { error: e } = await supabase
        .from("representative_employee")
        .update({ name: form.name.trim(), products: form.products.trim() })
        .eq("id", editRow.id);
      if (e) { setError(e.message); setSaving(false); return; }
      setEditRow(null);
    } else {
      const { error: e } = await supabase
        .from("representative_employee")
        .insert({ name: form.name.trim(), products: form.products.trim() });
      if (e) { setError(e.message); setSaving(false); return; }
      setShowAdd(false);
    }
    setSaving(false);
    load();
  }

  async function confirmDelete() {
    await supabase.from("representative_employee").delete().eq("id", deleteRow.id);
    setDeleteRow(null);
    load();
  }

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.products.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-white border rounded-lg overflow-hidden">

      <div
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between p-4 border-b bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-xs">
            {open ? "▲" : "▼"}
          </span>
          <div>
            <h2 className="font-bold text-gray-900">Representative Employees</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {rows.length} employee{rows.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <button
            onClick={openAdd}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700"
          >
            + Add employee
          </button>
        </div>
      </div>

      {open && (
        <>
          <div className="p-3 border-b bg-gray-50">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or products..."
              className="border px-3 py-2 rounded w-full max-w-xs text-sm"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-3 text-left">Employee</th>
                  <th className="p-3 text-left">Products</th>
                  <th className="p-3 text-left">Added</th>
                  <th className="p-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="p-6 text-gray-500">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-gray-500">No employees found.</td></tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.id} className="border-t hover:bg-gray-50">
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={row.name} />
                          <span className="font-medium">{row.name}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {row.products.split(",").map((p) => (
                            <span key={p} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                              {p.trim()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-gray-400 text-xs">
                        {new Date(row.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(row)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Edit</button>
                          <button onClick={() => setDeleteRow(row)} className="bg-red-50 text-red-600 border border-red-200 px-3 py-1 rounded text-xs">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showAdd && (
        <Modal title="Add representative employee" onClose={() => setShowAdd(false)}>
          <FormFields form={form} setForm={setForm} fields={["name", "products"]} error={error} hints={{ products: "Separate multiple products with commas" }} />
          <ModalActions onCancel={() => setShowAdd(false)} onSave={save} saving={saving} />
        </Modal>
      )}
      {editRow && (
        <Modal title="Edit representative employee" onClose={() => setEditRow(null)}>
          <FormFields form={form} setForm={setForm} fields={["name", "products"]} error={error} hints={{ products: "Separate multiple products with commas" }} />
          <ModalActions onCancel={() => setEditRow(null)} onSave={save} saving={saving} />
        </Modal>
      )}
      {deleteRow && (
        <ConfirmModal
          message={`Delete "${deleteRow.name}"? This cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteRow(null)}
        />
      )}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function EmployeePage() {
  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Employees</h1>
        <p className="text-sm text-gray-500">Manage monitoring and representative staff</p>
      </div>

      <div className="space-y-6">
        <MonitoringTable />
        <RepresentativeTable />
      </div>
    </div>
  );
}