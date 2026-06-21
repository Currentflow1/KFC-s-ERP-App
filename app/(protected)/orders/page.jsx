"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabaseClient";

const PRODUCT_TYPE = { RAW: "raw", FINISHED: "finished" };
const STOCK_TYPE   = { INCOMING: "incoming", OUTGOING: "outgoing" };

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

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

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        <p className="text-sm text-gray-700 mb-6">{message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors">Delete</button>
        </div>
      </div>
    </div>
  );
}

function SearchableSelect({ label, value, options, onChange, placeholder, disabled = false }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const containerRef      = useRef(null);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false); setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(opt) { onChange(opt); setOpen(false); setQuery(""); }
  function clear(e) { e.stopPropagation(); onChange(""); setQuery(""); }

  return (
    <div className="flex flex-col gap-1" ref={containerRef}>
      {label && <label className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</label>}
      <div className="relative">
        <button type="button" disabled={disabled}
          onClick={() => { if (!disabled) setOpen((p) => !p); setQuery(""); }}
          className={`w-full flex items-center justify-between rounded-md border px-3 py-1.5 text-sm text-left transition-colors ${
            disabled ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                     : "bg-white border-gray-200 text-gray-800 hover:border-blue-400 focus:outline-none"
          }`}>
          <span className={value ? "text-gray-800" : "text-gray-400"}>
            {value || placeholder || `Select ${label}…`}
          </span>
          <span className="flex items-center gap-1 ml-2 shrink-0">
            {value && !disabled && <span onClick={clear} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer px-1">✕</span>}
            <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
          </span>
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <input autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…" className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <ul className="max-h-48 overflow-y-auto">
              {filtered.length === 0
                ? <li className="px-3 py-2 text-sm text-gray-400">No results</li>
                : filtered.map((o) => (
                  <li key={o} onClick={() => select(o)}
                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors ${value === o ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}>
                    {o}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
//
// OrderTable is online-only. Product selection is now INDEPENDENT of
// supplier — all products for the active type (raw/finished) are always
// shown. Supplier is still captured for raw+incoming orders (it's a
// required FK on the row) but no longer filters or gates the product list.
//
// No direct inventory writes happen here. Every add/edit/delete only
// touches the transaction log; InventoryPage's Realtime subscription +
// pending-tx overlay (finalized_at IS NULL) handles the live preview.
// Writing to inventory directly from here would double-count balances
// when InventoryPage's finalizeDay() later folds the same pending rows in.

export default function OrderTable() {
  const supabase = useMemo(() => createClient(), []);

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
  // Always start false to match server render (navigator doesn't exist
  // server-side, so reading isOnline() here would cause a hydration
  // mismatch whenever the client's actual connection state differs from
  // the server's assumed "online"). The real value is set in the effect
  // below, right after mount.
  const [offline, setOffline]         = useState(false);

  const [monitoringOptions, setMonitoringOptions]         = useState([]);
  const [representativeOptions, setRepresentativeOptions] = useState([]);
  const [supplierOptions, setSupplierOptions]             = useState([]);
  // All raw product names, unfiltered by supplier
  const [rawProducts, setRawProducts]                     = useState([]);
  const [finishedProducts, setFinishedProducts]           = useState([]);

  const isRaw         = productType === PRODUCT_TYPE.RAW;
  const isIncoming     = stockType   === STOCK_TYPE.INCOMING;
  const showSupplier   = isRaw && isIncoming;

  const txTableName  = isRaw ? "raw_materials_transaction_log"    : "finished_products_transaction_log";
  const invTableName = isRaw ? "raw_materials_inventory"          : "finished_products_inventory";

  // Product list is now always "all products for this type" — never
  // narrowed by which supplier is selected.
  const productOptions = isRaw ? rawProducts : finishedProducts;

  useEffect(() => {
    // Correct the offline state to reality immediately after mount —
    // this runs only on the client, after hydration is already complete,
    // so it can never cause a server/client mismatch.
    setOffline(!isOnline());

    function handleOffline() { setOffline(true); }
    function handleOnline()  { setOffline(false); }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => { fetchOptions(); }, []);
  useEffect(() => { fetchRows(); resetForm(); }, [productType, stockType]);

  async function fetchOptions() {
    if (!isOnline()) return;
    const [mon, rep, sup, rawProd, finProd] = await Promise.all([
      supabase.from("monitoring_employee").select("name"),
      supabase.from("representative_employee").select("name"),
      supabase.from("suppliers").select("contact_person"),
      supabase.from("raw_materials_static").select("name"),
      supabase.from("finished_products_static").select("name"),
    ]);
    setMonitoringOptions(mon.data?.map((r) => r.name) ?? []);
    setRepresentativeOptions(rep.data?.map((r) => r.name) ?? []);
    setSupplierOptions((sup.data?.map((r) => r.contact_person) ?? []).filter((n) => n !== "N/A"));

    // All raw material names — no supplier grouping/filtering anymore
    setRawProducts((rawProd.data ?? []).map((r) => r.name));
    setFinishedProducts((finProd.data ?? []).map((r) => r.name));
  }

  async function fetchRows() {
    if (!isOnline()) {
      setError("You're offline — Order Table requires an internet connection.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from(txTableName)
        .select("*")
        .is("finalized_at", null)
        .is("removed_at", null)
        .order("created_at", { ascending: false });
      if (e) throw e;
      setRows(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function showSuccess(msg) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  function resetForm() {
    setFormData(emptyForm());
    setEditingId(null);
    setEditData({});
    setError(null);
    setSuccessMsg(null);
    setSearch("");
  }

  // Supplier is still recorded on raw+incoming rows (required FK), but
  // selecting it no longer touches the product list — product stays
  // independent and shows everything at all times.
  function handleSupplierChange(supplierName) {
    setFormData((prev) => ({ ...prev, supplier_name: supplierName }));
  }

  async function resolveInventoryId(productName) {
    const { data } = await supabase
      .from(invTableName)
      .select("id")
      .eq("name", productName)
      .single();
    return data?.id ?? null;
  }

  // ── ADD — tx log only, no inventory write ──────────────────────────────────

  async function handleAdd() {
    if (!isOnline()) { setError("You're offline — reconnect to add an order."); return; }
    setError(null);
    const qty = Number(isIncoming ? formData.incoming_bal : formData.outgoing_bal);

    if (!formData.monitoring_employee)                    { setError("Select a monitoring employee."); return; }
    if (!isIncoming && !formData.representative_employee) { setError("Select a representative employee."); return; }
    if (isRaw && isIncoming && !formData.supplier_name)   { setError("Select a supplier."); return; }
    if (!formData.product_name)                           { setError("Select a product."); return; }
    if (!qty || qty <= 0)                                 { setError("Enter a valid quantity."); return; }

    setSaving(true);
    try {
      const inventory_id = await resolveInventoryId(formData.product_name);
      if (!inventory_id) throw new Error("Could not resolve inventory ID for that product.");

      const payload = {
        inventory_id,
        monitoring_employee:      formData.monitoring_employee,
        representative_employee:  isIncoming ? null : formData.representative_employee,
        product_name:             formData.product_name,
        incoming_bal:             isIncoming ? qty : 0,
        outgoing_bal:             isIncoming ? 0 : qty,
        transaction_source:       "ordered",
        transaction_type:         "stock_movement",
        ...(isRaw ? { supplier_name: isIncoming ? formData.supplier_name : null } : {}),
      };

      const { error: insertError } = await supabase.from(txTableName).insert([payload]);
      if (insertError) throw insertError;

      // No inventory write — InventoryPage's Realtime subscription picks up
      // this insert and refreshes the live preview automatically.

      resetForm();
      await fetchRows();
      showSuccess("Order added. Inventory preview will update automatically.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── EDIT SAVE — tx log only ─────────────────────────────────────────────────

  async function handleEditSave(id) {
    if (!isOnline()) { setError("You're offline — reconnect to save changes."); return; }
    setError(null);
    setSaving(true);
    try {
      const newInventoryId = await resolveInventoryId(editData.product_name);
      if (!newInventoryId) throw new Error("Could not resolve inventory ID for that product.");

      const updatePayload = {
        inventory_id:             newInventoryId,
        monitoring_employee:      editData.monitoring_employee,
        representative_employee:  editData.representative_employee ?? null,
        product_name:             editData.product_name,
        incoming_bal:             Number(editData.incoming_bal ?? 0),
        outgoing_bal:             Number(editData.outgoing_bal ?? 0),
        ...(isRaw ? {
          supplier_name: Number(editData.incoming_bal ?? 0) > 0
            ? (editData.supplier_name || null)
            : null,
        } : {}),
      };

      const { error: updateError } = await supabase
        .from(txTableName).update(updatePayload).eq("id", id);
      if (updateError) throw updateError;

      // No inventory write — Realtime handles the live update.

      setEditingId(null);
      await fetchRows();
      showSuccess("Order updated.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── DELETE — tx log only ─────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!isOnline()) {
      setError("You're offline — reconnect to delete this order.");
      setDeleteTarget(null);
      return;
    }
    const id = deleteTarget;
    setDeleteTarget(null);
    setError(null);
    try {
      // Soft-remove: mark as deleted instead of hard-deleting, so the row
      // stays visible in Transaction Logs with a "Deleted" status badge.
      const { error: deleteError } = await supabase
        .from(txTableName)
        .update({ removed_at: new Date().toISOString(), removed_reason: "deleted" })
        .eq("id", id);
      if (deleteError) throw deleteError;

      // No inventory write — Realtime handles the live update.

      await fetchRows();
      showSuccess("Order deleted.");
    } catch (e) {
      setError(e.message);
    }
  }

  function handleEditStart(row) {
    if (!isOnline()) { setError("You're offline — reconnect to edit this order."); return; }
    setEditingId(row.id);
    setEditData({ ...row });
  }
  function handleEditChange(field, value) { setEditData((prev) => ({ ...prev, [field]: value })); }

  const filteredRows = rows
    .filter((r) => isIncoming ? (r.incoming_bal ?? 0) > 0 : (r.outgoing_bal ?? 0) > 0)
    .filter((r) => r.product_name?.toLowerCase().includes(search.trim().toLowerCase()));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      {deleteTarget && (
        <ConfirmModal
          message="Delete this order? The inventory preview will update automatically."
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Order Table</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pending orders — applied to inventory permanently on Finalize Day.
        </p>
      </div>

      {offline && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <span className="font-semibold">You're offline.</span> Order Table requires an internet
          connection — adding, editing, and deleting orders are disabled until you reconnect.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">

        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button
            onClick={() => setProductType(PRODUCT_TYPE.RAW)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              isRaw ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Raw Materials
          </button>
          <button
            onClick={() => setProductType(PRODUCT_TYPE.FINISHED)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${
              !isRaw ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Finished Products
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button
            onClick={() => setStockType(STOCK_TYPE.INCOMING)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              isIncoming ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            ↓ Incoming
          </button>
          <button
            onClick={() => setStockType(STOCK_TYPE.OUTGOING)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${
              !isIncoming ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            ↑ Outgoing
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">
          {isIncoming ? "Add Incoming Order" : "Add Outgoing Order"}
          <span className="ml-2 text-gray-400 font-normal">
            — {isRaw ? "Raw Materials" : "Finished Products"}
          </span>
        </h2>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <SearchableSelect label="Monitoring" value={formData.monitoring_employee} options={monitoringOptions}
            disabled={offline}
            onChange={(v) => setFormData((p) => ({ ...p, monitoring_employee: v }))} />

          {!isIncoming && (
            <SearchableSelect label="Representative" value={formData.representative_employee} options={representativeOptions}
              disabled={offline}
              onChange={(v) => setFormData((p) => ({ ...p, representative_employee: v }))} />
          )}

          {showSupplier && (
            <SearchableSelect label="Supplier" value={formData.supplier_name} options={supplierOptions}
              disabled={offline}
              onChange={handleSupplierChange} />
          )}

          {/* Product — always shows ALL products for the active type,
              never filtered or gated by supplier selection. */}
          <SearchableSelect
            label="Product"
            value={formData.product_name}
            options={productOptions}
            disabled={offline}
            onChange={(v) => setFormData((p) => ({ ...p, product_name: v }))}
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {isIncoming ? "Incoming Qty" : "Outgoing Qty"}
            </label>
            <input type="number" min="0" placeholder="0" disabled={offline}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              value={isIncoming ? formData.incoming_bal : formData.outgoing_bal}
              onChange={(e) => setFormData((p) => ({
                ...p,
                [isIncoming ? "incoming_bal" : "outgoing_bal"]: e.target.value,
              }))} />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={handleAdd} disabled={saving || offline}
            title={offline ? "You're offline — reconnect to add an order" : undefined}
            className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {saving ? "Saving…" : "Add Order"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 p-3 border-b border-gray-200 bg-gray-50">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full max-w-xs border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {search && (
            <button onClick={() => setSearch("")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Clear
            </button>
          )}
          {!loading && (
            <span className="ml-auto text-xs text-gray-400 shrink-0">
              {filteredRows.length} {filteredRows.length === 1 ? "order" : "orders"}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          {offline ? (
            <div className="px-4 py-8 text-sm text-gray-400 text-center">
              Reconnect to view and manage orders.
            </div>
          ) : loading ? (
            <div className="px-4 py-4 text-sm text-gray-400">Loading…</div>
          ) : filteredRows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-gray-400 text-center">
              {search ? `No orders matching "${search}"` : `No ${stockType} orders found.`}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Monitoring</th>
                  {!isIncoming && <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Representative</th>}
                  {showSupplier && <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Supplier</th>}
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Product</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">{isIncoming ? "Incoming Qty" : "Outgoing Qty"}</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map((row) => {
                  const isEditing = editingId === row.id;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 min-w-[160px]">
                        {isEditing
                          ? <SearchableSelect value={editData.monitoring_employee} options={monitoringOptions} onChange={(v) => handleEditChange("monitoring_employee", v)} />
                          : <span className="text-gray-700">{row.monitoring_employee}</span>}
                      </td>
                      {!isIncoming && (
                        <td className="px-4 py-3 min-w-[160px]">
                          {isEditing
                            ? <SearchableSelect value={editData.representative_employee ?? ""} options={representativeOptions} onChange={(v) => handleEditChange("representative_employee", v)} />
                            : <span className="text-gray-700">{row.representative_employee}</span>}
                        </td>
                      )}
                      {showSupplier && (
                        <td className="px-4 py-3 min-w-[160px]">
                          {isEditing
                            ? <SearchableSelect value={editData.supplier_name ?? ""} options={supplierOptions} onChange={(v) => handleEditChange("supplier_name", v)} />
                            : <span className="text-gray-700">{row.supplier_name}</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 font-medium text-gray-900 min-w-[160px]">
                        {isEditing
                          ? <SearchableSelect value={editData.product_name} options={isRaw ? rawProducts : finishedProducts} onChange={(v) => handleEditChange("product_name", v)} />
                          : row.product_name}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input type="number" min="0"
                            className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={isIncoming ? editData.incoming_bal : editData.outgoing_bal}
                            onChange={(e) => handleEditChange(isIncoming ? "incoming_bal" : "outgoing_bal", e.target.value)} />
                        ) : (
                          <span className="text-gray-900">
                            {isIncoming ? row.incoming_bal : row.outgoing_bal}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button onClick={() => handleEditSave(row.id)} disabled={saving || offline}
                              className="px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed">Save</button>
                            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors">Cancel</button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button onClick={() => handleEditStart(row)} disabled={offline}
                              title={offline ? "You're offline — reconnect to edit" : undefined}
                              className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed">Edit</button>
                            <button onClick={() => setDeleteTarget(row.id)} disabled={offline}
                              title={offline ? "You're offline — reconnect to delete" : undefined}
                              className="px-3 py-1.5 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed">Delete</button>
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
    </div>
  );
}