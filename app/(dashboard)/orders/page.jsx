"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUCT_TYPE = { RAW: "raw", FINISHED: "finished" };
const STOCK_TYPE   = { INCOMING: "incoming", OUTGOING: "outgoing" };

function emptyForm() {
  return {
    monitoring_employee: "",
    representative_employee: "",
    supplier_name: "",
    product_name: "",
    incoming_bal: "",
    outgoing_bal: "",
  };
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        <p className="text-gray-700 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded border text-gray-600 hover:bg-gray-50 text-sm">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 text-sm">Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Searchable Dropdown ───────────────────────────────────────────────────────

function SearchableSelect({ label, value, options, onChange, placeholder, disabled = false }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const containerRef      = useRef(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
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
    <div className="flex flex-col gap-1" ref={containerRef}>
      {label && (
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (!disabled) setOpen((p) => !p); setQuery(""); }}
          className={`w-full flex items-center justify-between rounded border px-3 py-2 text-sm text-left
            ${disabled ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed" : "bg-white border-gray-200 text-gray-800 hover:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500"}
          `}
        >
          <span className={value ? "text-gray-800" : "text-gray-400"}>
            {value || placeholder || `Select ${label}…`}
          </span>
          <span className="flex items-center gap-1 ml-2 shrink-0">
            {value && !disabled && (
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
                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700
                      ${value === o ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}
                    `}
                  >
                    {o}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function EditSearchableSelect({ field, options, value, onChange }) {
  return (
    <SearchableSelect
      value={value}
      options={options}
      onChange={(v) => onChange(field, v)}
      placeholder="Select…"
    />
  );
}

// ── FormNumber ────────────────────────────────────────────────────────────────

function FormNumber({ label, field, formData, setFormData }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </label>
      <input
        type="number"
        min="0"
        placeholder="0"
        className="rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        value={formData[field]}
        onChange={(e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }))}
      />
    </div>
  );
}

function EditNumber({ field, value, onChange }) {
  return (
    <input
      type="number"
      min="0"
      className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
      value={value}
      onChange={(e) => onChange(field, e.target.value)}
    />
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function OrderTable() {
  const [productType, setProductType] = useState(PRODUCT_TYPE.RAW);
  const [stockType, setStockType]     = useState(STOCK_TYPE.INCOMING);
  const [rows, setRows]               = useState([]);
  const [formData, setFormData]       = useState(emptyForm());
  const [editingId, setEditingId]     = useState(null);
  const [editData, setEditData]       = useState({});
  const [loading, setLoading]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const [successMsg, setSuccessMsg]   = useState(null);
  const [search, setSearch]           = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [monitoringOptions, setMonitoringOptions]         = useState([]);
  const [representativeOptions, setRepresentativeOptions] = useState([]);
  const [supplierOptions, setSupplierOptions]             = useState([]);
  const [rawProductsBySupplier, setRawProductsBySupplier] = useState({});
  const [finishedProducts, setFinishedProducts]           = useState([]);
  const [productOptions, setProductOptions]               = useState([]);

  // ── Data fetching ─────────────────────────────────────────────────────────

  useEffect(() => { fetchOptions(); }, []);
  useEffect(() => { fetchRows(); resetForm(); }, [productType, stockType]);

  async function fetchOptions() {
    const [mon, rep, sup, rawProd, finProd] = await Promise.all([
      supabase.from("monitoring_employee").select("name"),
      supabase.from("representative_employee").select("name"),
      supabase.from("suppliers").select("contact_person"),
      supabase.from("raw_materials_static").select("name, supplier_contact"),
      supabase.from("finished_products_static").select("name"),
    ]);

    setMonitoringOptions(mon.data?.map((r) => r.name) ?? []);
    setRepresentativeOptions(rep.data?.map((r) => r.name) ?? []);
    setSupplierOptions(
      (sup.data?.map((r) => r.contact_person) ?? []).filter((n) => n !== "N/A")
    );

    const map = {};
    (rawProd.data ?? []).forEach(({ name, supplier_contact }) => {
      if (!supplier_contact || supplier_contact === "N/A") return;
      if (!map[supplier_contact]) map[supplier_contact] = [];
      map[supplier_contact].push(name);
    });
    setRawProductsBySupplier(map);

    const fp = finProd.data?.map((r) => r.name) ?? [];
    setFinishedProducts(fp);
    setProductOptions(Object.values(map).flat());
  }

  async function fetchRows() {
    setLoading(true);
    setError(null);
    const table =
      productType === PRODUCT_TYPE.RAW
        ? "raw_materials_transaction_log"
        : "finished_products_transaction_log";
    try {
      const { data, error: e } = await supabase
        .from(table)
        .select("*")
        .order("created_at", { ascending: false });
      if (e) throw e;
      setRows(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function showSuccess(msg) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  function allRawProducts() {
    return Object.values(rawProductsBySupplier).flat();
  }

  function currentProductOptions() {
    if (productType === PRODUCT_TYPE.FINISHED) return finishedProducts;
    return allRawProducts();
  }

  function resetForm() {
    setFormData(emptyForm());
    setProductOptions(
      productType === PRODUCT_TYPE.FINISHED ? finishedProducts : allRawProducts()
    );
    setEditingId(null);
    setEditData({});
    setError(null);
    setSuccessMsg(null);
    setSearch("");
  }

  function handleSupplierChange(supplierName) {
    setFormData((prev) => ({ ...prev, supplier_name: supplierName, product_name: "" }));
    setProductOptions(
      supplierName
        ? (rawProductsBySupplier[supplierName] ?? [])
        : allRawProducts()
    );
  }

  async function getRawInventoryId(productName) {
    const { data } = await supabase
      .from("raw_materials_inventory")
      .select("id")
      .eq("name", productName)
      .single();
    return data?.id ?? null;
  }

  async function getFinishedInventoryId(productName) {
    const { data } = await supabase
      .from("finished_products_inventory")
      .select("id")
      .eq("name", productName)
      .single();
    return data?.id ?? null;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async function handleAdd() {
    setError(null);
    const isIncoming = stockType === STOCK_TYPE.INCOMING;
    const isRaw      = productType === PRODUCT_TYPE.RAW;
    const qty = Number(isIncoming ? formData.incoming_bal : formData.outgoing_bal);

    if (!formData.monitoring_employee)                    { setError("Select a monitoring employee."); return; }
    if (!isIncoming && !formData.representative_employee) { setError("Select a representative employee."); return; }
    if (isRaw && isIncoming && !formData.supplier_name)   { setError("Select a supplier."); return; }
    if (!formData.product_name)                           { setError("Select a product."); return; }
    if (!qty || qty <= 0)                                 { setError("Enter a valid quantity."); return; }

    setSaving(true);
    try {
      const inventory_id = isRaw
        ? await getRawInventoryId(formData.product_name)
        : await getFinishedInventoryId(formData.product_name);
      if (!inventory_id) throw new Error("Could not resolve inventory ID for that product.");

      const basePayload = {
        inventory_id,
        monitoring_employee: formData.monitoring_employee,
        // null for incoming (no rep needed), actual value for outgoing
        representative_employee: isIncoming ? null : formData.representative_employee,
        product_name: formData.product_name,
        incoming_bal: isIncoming ? qty : 0,
        outgoing_bal: isIncoming ? 0 : qty,
      };

      // supplier_name: only for raw incoming — null for outgoing (no FK needed)
      const payload = isRaw
        ? { ...basePayload, supplier_name: isIncoming ? formData.supplier_name : null }
        : basePayload;

      const table = isRaw
        ? "raw_materials_transaction_log"
        : "finished_products_transaction_log";

      const { error: insertError } = await supabase.from(table).insert([payload]);
      if (insertError) throw insertError;

      resetForm();
      await fetchRows();
      showSuccess("Order added — will be applied to inventory on Close Day.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleEditStart(row) {
    setEditingId(row.id);
    setEditData({ ...row });
  }

  async function handleEditSave(id) {
    setError(null);
    setSaving(true);
    const isRaw = productType === PRODUCT_TYPE.RAW;
    const table = isRaw
      ? "raw_materials_transaction_log"
      : "finished_products_transaction_log";

    try {
      // Re-resolve inventory_id in case product_name was changed during edit
      const inventory_id = isRaw
        ? await getRawInventoryId(editData.product_name)
        : await getFinishedInventoryId(editData.product_name);
      if (!inventory_id) throw new Error("Could not resolve inventory ID for that product.");

      const updatePayload = {
        inventory_id,
        monitoring_employee: editData.monitoring_employee,
        representative_employee: editData.representative_employee ?? null,
        product_name: editData.product_name,
        incoming_bal: Number(editData.incoming_bal ?? 0),
        outgoing_bal: Number(editData.outgoing_bal ?? 0),
      };

      // supplier_name: null for outgoing rows (incoming_bal === 0)
      if (isRaw) {
        updatePayload.supplier_name =
          Number(editData.incoming_bal ?? 0) > 0
            ? (editData.supplier_name || null)
            : null;
      }

      const { error: updateError } = await supabase
        .from(table)
        .update(updatePayload)
        .eq("id", id);
      if (updateError) throw updateError;

      setEditingId(null);
      await fetchRows();
      showSuccess("Order updated.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const id = deleteTarget;
    setDeleteTarget(null);
    setError(null);
    const table =
      productType === PRODUCT_TYPE.RAW
        ? "raw_materials_transaction_log"
        : "finished_products_transaction_log";
    try {
      const { error: deleteError } = await supabase.from(table).delete().eq("id", id);
      if (deleteError) throw deleteError;
      await fetchRows();
      showSuccess("Order deleted.");
    } catch (e) {
      setError(e.message);
    }
  }

  function handleEditChange(field, value) {
    setEditData((prev) => ({ ...prev, [field]: value }));
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isIncoming   = stockType === STOCK_TYPE.INCOMING;
  const isRaw        = productType === PRODUCT_TYPE.RAW;
  const showSupplier = isRaw && isIncoming;

  const filteredRows = rows
    .filter((r) => (isIncoming ? (r.incoming_bal ?? 0) > 0 : (r.outgoing_bal ?? 0) > 0))
    .filter((r) => r.product_name?.toLowerCase().includes(search.trim().toLowerCase()));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 bg-gray-50 min-h-screen">

      {deleteTarget && (
        <ConfirmModal
          message="Delete this order entry? This cannot be undone."
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Order Table</h1>
        <p className="text-sm text-gray-500">
          {isRaw ? "Raw material" : "Finished product"} orders — applied to inventory on Close Day
        </p>
      </div>

      {/* PRODUCT TYPE TABS */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <button
          onClick={() => setProductType(PRODUCT_TYPE.RAW)}
          className={`px-4 py-2 border rounded text-sm font-medium ${
            isRaw ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700"
          }`}
        >
          Raw Materials
        </button>
        <button
          onClick={() => setProductType(PRODUCT_TYPE.FINISHED)}
          className={`px-4 py-2 border rounded text-sm font-medium ${
            !isRaw ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700"
          }`}
        >
          Finished Products
        </button>
      </div>

      {/* STOCK TYPE TABS */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <button
          onClick={() => setStockType(STOCK_TYPE.INCOMING)}
          className={`px-4 py-2 border rounded text-sm ${
            isIncoming ? "bg-blue-600 text-white" : "bg-white text-gray-700"
          }`}
        >
          ↓ Incoming
        </button>
        <button
          onClick={() => setStockType(STOCK_TYPE.OUTGOING)}
          className={`px-4 py-2 border rounded text-sm ${
            !isIncoming ? "bg-blue-600 text-white" : "bg-white text-gray-700"
          }`}
        >
          ↑ Outgoing
        </button>
      </div>

      {/* ALERTS */}
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      {/* ADD FORM */}
      <div className="bg-white border rounded-lg p-5 mb-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-black mb-4">
          {isIncoming ? "Add Incoming Order" : "Add Outgoing Order"}
          <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">
            — {isRaw ? "Raw Materials" : "Finished Products"}
          </span>
        </h2>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">

          <SearchableSelect
            label="Monitoring"
            value={formData.monitoring_employee}
            options={monitoringOptions}
            onChange={(v) => setFormData((p) => ({ ...p, monitoring_employee: v }))}
          />

          {!isIncoming && (
            <SearchableSelect
              label="Representative"
              value={formData.representative_employee}
              options={representativeOptions}
              onChange={(v) => setFormData((p) => ({ ...p, representative_employee: v }))}
            />
          )}

          {showSupplier && (
            <SearchableSelect
              label="Supplier"
              value={formData.supplier_name}
              options={supplierOptions}
              onChange={handleSupplierChange}
            />
          )}

          <SearchableSelect
            label="Product"
            value={formData.product_name}
            options={productOptions}
            disabled={isRaw && isIncoming && !formData.supplier_name}
            placeholder={
              isRaw && isIncoming && !formData.supplier_name
                ? "Select a supplier first…"
                : undefined
            }
            onChange={(v) => setFormData((p) => ({ ...p, product_name: v }))}
          />

          {isIncoming
            ? <FormNumber label="Incoming Qty" field="incoming_bal" formData={formData} setFormData={setFormData} />
            : <FormNumber label="Outgoing Qty" field="outgoing_bal" formData={formData} setFormData={setFormData} />
          }

        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleAdd}
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-60 hover:bg-blue-700 text-sm font-semibold"
          >
            {saving ? "Saving…" : "Add Order"}
          </button>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white border rounded-lg overflow-x-auto">

        <div className="p-3 border-b bg-gray-50">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="border px-3 py-2 rounded w-full max-w-xs text-sm"
          />
        </div>

        {loading ? (
          <div className="p-6 text-gray-500">Loading…</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-gray-500">
            No {stockType} orders found for {isRaw ? "raw materials" : "finished products"}.
          </div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">Monitoring</th>
                {!isIncoming && <th className="p-3 text-left">Representative</th>}
                {showSupplier && <th className="p-3 text-left">Supplier</th>}
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-left">{isIncoming ? "Incoming Qty" : "Outgoing Qty"}</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className="border-t hover:bg-gray-50">

                    <td className="p-3 min-w-[160px]">
                      {isEditing
                        ? <EditSearchableSelect field="monitoring_employee" options={monitoringOptions} value={editData.monitoring_employee} onChange={handleEditChange} />
                        : row.monitoring_employee}
                    </td>

                    {!isIncoming && (
                      <td className="p-3 min-w-[160px]">
                        {isEditing
                          ? <EditSearchableSelect field="representative_employee" options={representativeOptions} value={editData.representative_employee ?? ""} onChange={handleEditChange} />
                          : row.representative_employee}
                      </td>
                    )}

                    {showSupplier && (
                      <td className="p-3 min-w-[160px]">
                        {isEditing
                          ? <EditSearchableSelect field="supplier_name" options={supplierOptions} value={editData.supplier_name ?? ""} onChange={handleEditChange} />
                          : row.supplier_name}
                      </td>
                    )}

                    <td className="p-3 font-medium min-w-[160px]">
                      {isEditing
                        ? <EditSearchableSelect field="product_name" options={currentProductOptions()} value={editData.product_name} onChange={handleEditChange} />
                        : row.product_name}
                    </td>

                    <td className="p-3">
                      {isEditing ? (
                        <EditNumber
                          field={isIncoming ? "incoming_bal" : "outgoing_bal"}
                          value={isIncoming ? editData.incoming_bal : editData.outgoing_bal}
                          onChange={handleEditChange}
                        />
                      ) : (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          isIncoming ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        }`}>
                          {isIncoming ? row.incoming_bal : row.outgoing_bal}
                        </span>
                      )}
                    </td>

                    <td className="p-3 text-xs text-gray-400 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleDateString("en-PH", {
                        year: "numeric", month: "short", day: "numeric",
                      })}
                    </td>

                    <td className="p-3">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button onClick={() => handleEditSave(row.id)} disabled={saving} className="bg-green-600 text-white px-3 py-1 rounded text-xs disabled:opacity-60">Save</button>
                          <button onClick={() => setEditingId(null)} className="bg-gray-100 text-gray-700 px-3 py-1 rounded text-xs">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button onClick={() => handleEditStart(row)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Edit</button>
                          <button onClick={() => setDeleteTarget(row.id)} className="bg-red-50 text-red-600 px-3 py-1 rounded text-xs border border-red-200">Delete</button>
                        </div>
                      )}
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}