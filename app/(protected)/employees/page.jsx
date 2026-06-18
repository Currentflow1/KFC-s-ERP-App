"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabaseClient";

// ─── helpers ──────────────────────────────────────────────────────────────────

function Avatar({ name }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
      {initials}
    </div>
  );
}

// ─── modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white text-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none transition-colors">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white text-gray-900 rounded-lg shadow-xl w-full max-w-sm p-6">
        <p className="text-sm text-gray-700 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-1.5 rounded-md border text-sm text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700 transition-colors">Delete</button>
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
            className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      <button onClick={onCancel} className="px-4 py-1.5 rounded-md border text-sm text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
      <button onClick={onSave} disabled={saving} className="px-4 py-1.5 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors">
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
    const supabase = createClient();
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
    const supabase = createClient();
    if (!form.name.trim() || !form.role.trim()) { setError("Both fields are required."); return; }
    setSaving(true); setError("");
    if (editRow) {
      const { error: e } = await supabase.from("monitoring_employee").update({ name: form.name.trim(), role: form.role.trim() }).eq("id", editRow.id);
      if (e) { setError(e.message); setSaving(false); return; }
      setEditRow(null);
    } else {
      const { error: e } = await supabase.from("monitoring_employee").insert({ name: form.name.trim(), role: form.role.trim() });
      if (e) { setError(e.message); setSaving(false); return; }
      setShowAdd(false);
    }
    setSaving(false); load();
  }

  async function confirmDelete() {
    const supabase = createClient();
    await supabase.from("monitoring_employee").delete().eq("id", deleteRow.id);
    setDeleteRow(null); load();
  }

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-white text-gray-900 border border-gray-200 rounded-lg shadow-sm overflow-hidden">

      {/* Section header */}
      <div
        onClick={() => setOpen((p) => !p)}
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px]">{open ? "▲" : "▼"}</span>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Monitoring Employees</h2>
            <p className="text-xs text-gray-400 mt-0.5">{rows.length} employee{rows.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <button
            onClick={openAdd}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            + Add employee
          </button>
        </div>
      </div>

      {open && (
        <>
          {/* Control bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or role…"
              className="w-full max-w-sm border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Clear</button>
            )}
            {!loading && (
              <span className="ml-auto text-xs text-gray-400 shrink-0">
                {filtered.length} {filtered.length === 1 ? "employee" : "employees"}
              </span>
            )}
          </div>

          {/* Table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Employee</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Added</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-4 text-sm text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-sm text-gray-400 text-center">
                  {search ? `No employees matching "${search}"` : "No monitoring employees yet"}
                </td></tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.name} />
                        <span className="font-medium text-gray-900">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        {row.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => openEdit(row)} className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors">Edit</button>
                        <button onClick={() => setDeleteRow(row)} className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
    const supabase = createClient();
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
    const supabase = createClient();
    if (!form.name.trim() || !form.products.trim()) { setError("Both fields are required."); return; }
    setSaving(true); setError("");
    if (editRow) {
      const { error: e } = await supabase.from("representative_employee").update({ name: form.name.trim(), products: form.products.trim() }).eq("id", editRow.id);
      if (e) { setError(e.message); setSaving(false); return; }
      setEditRow(null);
    } else {
      const { error: e } = await supabase.from("representative_employee").insert({ name: form.name.trim(), products: form.products.trim() });
      if (e) { setError(e.message); setSaving(false); return; }
      setShowAdd(false);
    }
    setSaving(false); load();
  }

  async function confirmDelete() {
    const supabase = createClient();
    await supabase.from("representative_employee").delete().eq("id", deleteRow.id);
    setDeleteRow(null); load();
  }

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.products.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-white text-gray-900 border border-gray-200 rounded-lg shadow-sm overflow-hidden">

      {/* Section header */}
      <div
        onClick={() => setOpen((p) => !p)}
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px]">{open ? "▲" : "▼"}</span>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Representative Employees</h2>
            <p className="text-xs text-gray-400 mt-0.5">{rows.length} employee{rows.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <button
            onClick={openAdd}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            + Add employee
          </button>
        </div>
      </div>

      {open && (
        <>
          {/* Control bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or products…"
              className="w-full max-w-sm border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Clear</button>
            )}
            {!loading && (
              <span className="ml-auto text-xs text-gray-400 shrink-0">
                {filtered.length} {filtered.length === 1 ? "employee" : "employees"}
              </span>
            )}
          </div>

          {/* Table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Employee</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Products</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Added</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-4 text-sm text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-sm text-gray-400 text-center">
                  {search ? `No employees matching "${search}"` : "No representative employees yet"}
                </td></tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.name} />
                        <span className="font-medium text-gray-900">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.products.split(",").map((p) => (
                          <span key={p} className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                            {p.trim()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => openEdit(row)} className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors">Edit</button>
                        <button onClick={() => setDeleteRow(row)} className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
    <div className="px-6 py-5 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-start mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Employees</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage monitoring and representative staff</p>
        </div>
      </div>

      <div className="space-y-5">
        <MonitoringTable />
        <RepresentativeTable />
      </div>
    </div>
  );
}