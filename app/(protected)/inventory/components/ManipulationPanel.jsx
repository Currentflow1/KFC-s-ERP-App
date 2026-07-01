"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import {
  writeInventory,
  queueTxLog,
  setCache,
  getCache,
  patchInventorySnapshot,
  sanitizeInventoryRow,
} from "@/lib/sync";

// ─── Tab config (mirrors InventoryPage) ──────────────────────────────────────
const TAB_CONFIG = {
  raw: {
    inv:        "raw_materials_inventory",
    tx:         "raw_materials_transaction_log",
    snapshotKey:"raw",
    fk:         "raw_material_id",
    hasSupplier: true,   // incoming raw materials need a supplier
  },
  finished: {
    inv:        "finished_products_inventory",
    tx:         "finished_products_transaction_log",
    snapshotKey:"finished",
    fk:         "finished_product_id",
    hasSupplier: false,
  },
  packaging: {
    inv:        "packaging_inventory",
    tx:         "packaging_transaction_log",
    snapshotKey:"packaging",
    fk:         "packaging_id",
    hasSupplier: true,   // packaging also has a supplier on incoming
  },
};

function cfg(tab) { return TAB_CONFIG[tab] ?? TAB_CONFIG.finished; }

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function SearchableSelect({ label, value, options, onChange, placeholder, disabled = false }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const ref               = useRef(null);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(""); }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(opt) { onChange(opt); setOpen(false); setQuery(""); }
  function clear(e)    { e.stopPropagation(); onChange(""); setQuery(""); }

  return (
    <div className="flex flex-col gap-1" ref={ref}>
      {label && (
        <label className="text-xs font-semibold uppercase tracking-wide text-black">{label}</label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (!disabled) setOpen((p) => !p); setQuery(""); }}
          className={`w-full flex items-center justify-between rounded-md border px-3 py-1.5 text-sm text-left transition-colors ${
            disabled
              ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
              : "bg-white border-gray-300 text-black hover:border-blue-400 focus:outline-none"
          }`}
        >
          <span className={value ? "text-black" : "text-gray-500"}>
            {value || placeholder || "Select…"}
          </span>
          <span className="flex items-center gap-1 ml-2 shrink-0">
            {value && !disabled && (
              <span onClick={clear} className="text-black hover:text-gray-600 text-xs cursor-pointer px-1">✕</span>
            )}
            <span className="text-black text-xs">{open ? "▲" : "▼"}</span>
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
                className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-md text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <ul className="max-h-40 overflow-y-auto">
              {filtered.length === 0
                ? <li className="px-3 py-2 text-sm text-gray-500">No results</li>
                : filtered.map((o) => (
                  <li key={o} onClick={() => select(o)}
                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors ${
                      value === o ? "bg-blue-50 text-blue-700 font-medium" : "text-black"
                    }`}>
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

function warehouseStyle(name) {
  if (!name) return null;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 2 === 0
    ? "bg-blue-100 text-black border border-blue-200"
    : "bg-green-100 text-black border border-green-200";
}

export default function ManipulatePanel({ item, tab, onClose, onUpdated, onLocalPatch, isFinalized = false }) {
  const supabase = createClient();

  // ─── Derive everything from TAB_CONFIG — no more isRaw booleans ───────────
  const tabCfg      = cfg(tab);
  const table       = tabCfg.inv;
  const txLogTable  = tabCfg.tx;
  const snapshotKey = tabCfg.snapshotKey;
  const fkField     = tabCfg.fk;
  const fkValue     = item[fkField] ?? null;

  // ── Stock direction ───────────────────────────────────────────────────────
  const [stockMode, setStockMode] = useState("incoming");
  const isIncoming   = stockMode === "incoming";
  // Show supplier when the tab supports it AND we're adding incoming stock
  const showSupplier = tabCfg.hasSupplier && isIncoming;

  // ── Form state ────────────────────────────────────────────────────────────
  const [qty,                    setQty]                    = useState("");
  const [actual,                 setActual]                 = useState("");
  const [saving,                 setSaving]                 = useState(false);
  const [txError,                setTxError]                = useState(null);
  const [monitoringEmployee,     setMonitoringEmployee]     = useState("");
  const [representativeEmployee, setRepresentativeEmployee] = useState("");
  const [staffEmployee,          setStaffEmployee]          = useState("");
  const [supplierName,           setSupplierName]           = useState("");

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [role,        setRole]        = useState(null);
  const [userId,      setUserId]      = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);

  // ── Options ───────────────────────────────────────────────────────────────
  const [monitoringOptions,     setMonitoringOptions]     = useState([]);
  const [representativeOptions, setRepresentativeOptions] = useState([]);
  const [staffOptions,          setStaffOptions]          = useState([]);
  const [supplierOptions,       setSupplierOptions]       = useState([]);

  const [warehouse, setWarehouse] = useState(item.warehouse ?? null);

  useEffect(() => {
    setWarehouse(item.warehouse ?? null);
  }, [item.id, item.warehouse]);

  const displayedCurrent = Number(item.current_bal      ?? 0);
  const pendingIn        = Number(item._pendingIncoming  ?? 0);
  const pendingOut       = Number(item._pendingOutgoing  ?? 0);

  // ── Init: permissions + options ───────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function loadFromCache() {
      const [r, u, m, rep, staff, sup] = await Promise.all([
        getCache("role"),
        getCache("userId"),
        getCache("monitoringOptions"),
        getCache("representativeOptions"),
        getCache("staffOptions"),
        getCache("supplierOptions"),
      ]);
      if (cancelled) return;
      setRole(r ?? "staff");
      setUserId(u ?? null);
      setMonitoringOptions(m    ?? []);
      setRepresentativeOptions(rep ?? []);
      setStaffOptions(staff ?? []);
      setSupplierOptions(sup    ?? []);
      setOfflineMode(true);
    }

    async function init() {
      if (!isOnline()) { await loadFromCache(); return; }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (!cancelled) setRole("staff"); return; }
        if (cancelled) return;
        setUserId(user.id);
        await setCache("userId", user.id);

        const [
          { data: profile },
          { data: monRows },
          { data: repRows },
          { data: staffRows },
          { data: supRows },
        ] = await Promise.all([
          supabase.from("profiles").select("role").eq("id", user.id).single(),
          supabase.from("monitoring_employee").select("name"),
          supabase.from("representative_employee").select("name"),
          supabase.from("staff_employee").select("name"),
          supabase.from("suppliers").select("contact_person"),
        ]);
        if (cancelled) return;

        const resolvedRole = profile?.role ?? "staff";
        const monNames     = (monRows   ?? []).map((r) => r.name);
        const repNames     = (repRows   ?? []).map((r) => r.name);
        const staffNames   = (staffRows ?? []).map((r) => r.name).filter(Boolean);
        const supNames     = (supRows   ?? []).map((r) => r.contact_person).filter((n) => n !== "N/A");

        setRole(resolvedRole);
        setMonitoringOptions(monNames);
        setRepresentativeOptions(repNames);
        setStaffOptions(staffNames);
        setSupplierOptions(supNames);

        await setCache("role",                  resolvedRole);
        await setCache("monitoringOptions",     monNames);
        await setCache("representativeOptions", repNames);
        await setCache("staffOptions",          staffNames);
        await setCache("supplierOptions",       supNames);
      } catch (e) {
        console.error("[ManipulatePanel] live fetch failed, using cache:", e);
        await loadFromCache();
      }
    }

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Validation ────────────────────────────────────────────────────────────

  function validate() {
    if (!monitoringEmployee) {
      setTxError("Select a monitoring employee."); return false;
    }
    if (!isIncoming && !representativeEmployee) {
      setTxError("Select a representative employee for outgoing."); return false;
    }
    if (showSupplier && !supplierName) {
      setTxError("Select a supplier for incoming stock."); return false;
    }
    const q = Number(qty || 0);
    if (!q || q <= 0) {
      setTxError("Enter a valid quantity."); return false;
    }
    setTxError(null);
    return true;
  }

  // ── Tx log payload ────────────────────────────────────────────────────────

  function buildTxPayload({ mode, q, actual_bal, loss, txType }) {
    return {
      inventory_id:            item.id,
      monitoring_employee:     monitoringEmployee,
      representative_employee: representativeEmployee || null,
      staff_employee:          staffEmployee || null,
      // supplier_name only exists on raw + packaging tx log tables
      ...(tabCfg.hasSupplier ? { supplier_name: showSupplier ? (supplierName || null) : null } : {}),
      product_name:            item.name,
      incoming_bal:            txType === "stock_movement" && mode === "in"  ? q : 0,
      outgoing_bal:            txType === "stock_movement" && mode === "out" ? q : 0,
      finalized_at:            new Date().toISOString(),
      created_by:              userId,
      transaction_source:      "manipulated",
      transaction_type:        txType,
      actual_bal,
      loss,
      warehouse:               warehouse || null,
    };
  }

  // ── Apply IN / OUT ────────────────────────────────────────────────────────

  async function applyChange() {
    if (isFinalized) {
      setTxError("🔒 Today is finalized. You cannot edit inventory.");
      return;
    }
    if (!validate()) return;
    const q    = Number(qty);
    const mode = isIncoming ? "in" : "out";
    setSaving(true);

    await onUpdated(async () => {
      const online = isOnline();
      let beg, incoming, outgoing, existing_actual;

      if (online) {
        const { data, error } = await supabase
          .from(table).select("*").eq("id", item.id).maybeSingle();
        if (error || !data) { alert("Failed to fetch current values."); return null; }
        beg             = Number(data.beg_bal      ?? 0);
        incoming        = Number(data.incoming_bal  ?? 0);
        outgoing        = Number(data.outgoing_bal  ?? 0);
        existing_actual = data.actual_bal != null ? Number(data.actual_bal) : null;
      } else {
        // `item` here is the merged/display row from InventoryPage.loadData(),
        // which already folds in still-pending (unfinalized) transaction
        // totals via _pendingIncoming/_pendingOutgoing so the UI shows the
        // "live" balance. Those pending amounts are NOT yet written to the
        // raw inventory columns — they only get committed at Finalize.
        // Using item.incoming_bal / item.outgoing_bal directly here would
        // double-count them: once now (queued write) and again later when
        // Finalize adds the still-pending tx rows on top. sanitizeInventoryRow
        // strips the pending overlay back out so the queued write reflects
        // the true stored column values, matching what the online branch
        // reads directly from Supabase.
        const raw = sanitizeInventoryRow(item);
        beg             = raw.beg_bal;
        incoming        = raw.incoming_bal;
        outgoing        = raw.outgoing_bal;
        existing_actual = item.actual_bal != null ? Number(item.actual_bal) : null;
      }

      if (mode === "in")  incoming += q;
      if (mode === "out") outgoing += q;

      const current_bal = beg + incoming - outgoing;
      const actual_bal  = existing_actual ?? current_bal;
      const loss        = existing_actual != null ? Math.max(0, current_bal - existing_actual) : 0;

      const invPayload = {
        id: item.id, name: item.name,
        beg_bal: beg, incoming_bal: incoming, outgoing_bal: outgoing,
        current_bal, actual_bal, loss,
        warehouse: warehouse || null,
        [fkField]: fkValue,
      };
      const txPayload = buildTxPayload({ mode, q, actual_bal, loss, txType: "stock_movement" });

      const synced = await writeInventory(table, item.id, invPayload);

      if (!synced) {
        await queueTxLog(txLogTable, txPayload);
        const patch = {
          beg_bal: beg, incoming_bal: incoming, outgoing_bal: outgoing,
          current_bal, actual_bal, loss, warehouse: warehouse || null,
        };
        await patchInventorySnapshot(snapshotKey, item.id, patch);
        onLocalPatch?.(item.id, patch);
        return null;
      }

      const { data: txRow, error: txErr } = await supabase
        .from(txLogTable).insert(txPayload).select("id").single();
      if (txErr) { alert("Inventory updated but tx log failed: " + txErr.message); return null; }
      return txRow?.id ?? null;
    });

    setSaving(false);
    setQty("");
  }

  // ── Set actual count ──────────────────────────────────────────────────────

  async function setActualValue() {
    if (isFinalized) {
      setTxError("🔒 Today is finalized. You cannot edit inventory.");
      return;
    }
    if (actual === "") return;
    if (!monitoringEmployee) { setTxError("Select a monitoring employee."); return; }
    setTxError(null);
    setSaving(true);

    await onUpdated(async () => {
      const online = isOnline();
      const a      = Number(actual);
      let current_bal, beg_bal, incoming_bal, outgoing_bal;

      if (online) {
        const { data, error } = await supabase
          .from(table).select("*").eq("id", item.id).maybeSingle();
        if (error || !data) { alert("Failed to fetch current values."); return null; }
        beg_bal      = Number(data.beg_bal      ?? 0);
        incoming_bal = Number(data.incoming_bal  ?? 0);
        outgoing_bal = Number(data.outgoing_bal  ?? 0);
        current_bal  = Number(data.current_bal   ?? 0);
      } else {
        // Same reasoning as applyChange()'s offline branch above: `item`'s
        // balance fields are display-merged with still-pending transaction
        // totals. Strip that overlay via sanitizeInventoryRow before queuing
        // the write, or the pending amount gets committed here AND again at
        // Finalize — producing doubled/incorrect inventory values while the
        // transaction log (untouched by this write) stays correct.
        const raw = sanitizeInventoryRow(item);
        beg_bal      = raw.beg_bal;
        incoming_bal = raw.incoming_bal;
        outgoing_bal = raw.outgoing_bal;
        current_bal  = raw.current_bal;
      }

      const loss       = Math.max(0, current_bal - a);
      const invPayload = {
        id: item.id, name: item.name,
        beg_bal, incoming_bal, outgoing_bal, current_bal,
        actual_bal: a, loss,
        warehouse: warehouse || null,
        [fkField]: fkValue,
      };
      const txPayload = buildTxPayload({ mode: null, q: 0, actual_bal: a, loss, txType: "count_correction" });

      const synced = await writeInventory(table, item.id, invPayload);

      if (!synced) {
        await queueTxLog(txLogTable, txPayload);
        const patch = { current_bal, actual_bal: a, loss, warehouse: warehouse || null };
        await patchInventorySnapshot(snapshotKey, item.id, patch);
        onLocalPatch?.(item.id, patch);
        return null;
      }

      const { data: txRow, error: txErr } = await supabase
        .from(txLogTable).insert(txPayload).select("id").single();
      if (txErr) { alert("Inventory updated but tx log failed: " + txErr.message); return null; }
      return txRow?.id ?? null;
    });

    setSaving(false);
    setActual("");
  }

  const lossPreview = actual !== "" ? Math.max(0, displayedCurrent - Number(actual)) : null;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (role === null) {
    return (
      <div className="fixed bottom-6 right-6 bg-white text-black border shadow-lg p-4 w-80 rounded-lg z-10">
        <div className="flex justify-between items-start mb-3">
          <h2 className="font-bold text-base text-black">{item.name}</h2>
          <button onClick={onClose} className="text-black hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-sm text-black text-center py-6 animate-pulse">Checking permissions…</p>
      </div>
    );
  }

  // ── Staff blocked ─────────────────────────────────────────────────────────

  if (role !== "admin") {
    return (
      <div className="fixed bottom-6 right-6 bg-white text-black border shadow-lg p-4 w-80 rounded-lg z-10">
        <div className="flex justify-between items-start mb-4">
          <h2 className="font-bold text-base text-black">{item.name}</h2>
          <button onClick={onClose} className="text-black hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-6 text-center">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-sm font-semibold text-red-700">Access Restricted</p>
          <p className="text-xs text-red-600 mt-1">Only admins can manipulate inventory.</p>
        </div>
      </div>
    );
  }

  // ── Admin panel ───────────────────────────────────────────────────────────

  // Human-readable label for the tab type shown in the section header
  const tabLabel = tab === "raw" ? "Raw Material" : tab === "packaging" ? "Packaging" : "Finished Product";

  return (
    <div className={`fixed bottom-6 right-6 bg-white text-black border shadow-lg p-4 w-80 rounded-lg z-10 max-h-[90vh] overflow-y-auto transition-opacity ${isFinalized ? "opacity-60 pointer-events-none" : ""}`}>

      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="font-bold text-base leading-tight text-black">{item.name}</h2>
          {warehouse && (
            <span className={`inline-flex items-center gap-1 text-xs font-semibold mt-1 px-2 py-0.5 rounded-full ${warehouseStyle(warehouse)}`}>
              📦 {warehouse}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-black hover:text-gray-600 text-lg leading-none ml-2 shrink-0">✕</button>
      </div>

      {/* Finalization lock banner */}
      {isFinalized && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          <div className="font-semibold flex items-center gap-1">
            <span>🔒</span> Panel Locked
          </div>
          <p className="mt-1 text-red-700">Today is finalized. Undo to make changes.</p>
        </div>
      )}

      {/* Offline banner */}
      {offlineMode && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Offline mode</span> — using cached permissions. Changes sync when wifi returns.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center text-xs">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-black mb-0.5">Current</div>
          <div className="font-semibold text-black">{displayedCurrent}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-black mb-0.5">Actual</div>
          <div className="font-semibold text-black">{Number(item.actual_bal ?? 0)}</div>
        </div>
        <div className="bg-red-50 rounded p-2">
          <div className="text-red-600 mb-0.5">Loss</div>
          <div className="font-semibold text-red-600">{Number(item.loss ?? 0)}</div>
        </div>
      </div>

      {/* Pending orders */}
      {(pendingIn > 0 || pendingOut > 0) && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="font-semibold mb-0.5">Pending orders (not yet closed)</div>
          {pendingIn  > 0 && <div>↓ Incoming: +{pendingIn}</div>}
          {pendingOut > 0 && <div>↑ Outgoing: −{pendingOut}</div>}
        </div>
      )}

      {/* ── Stock Movement ── */}
      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs font-semibold text-black mb-3">
          {isIncoming ? "Add Incoming" : "Add Outgoing"}
          <span className="ml-1.5 text-black font-normal">— {tabLabel}</span>
        </p>

        {/* Incoming / Outgoing toggle */}
        <div className="flex rounded-md border border-gray-200 overflow-hidden mb-3">
          <button
            onClick={() => { setStockMode("incoming"); setQty(""); setTxError(null); setSupplierName(""); setRepresentativeEmployee(""); setStaffEmployee(""); }}
            disabled={isFinalized}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              isIncoming ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"
            } ${isFinalized ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            ↓ Incoming
          </button>
          <button
            onClick={() => { setStockMode("outgoing"); setQty(""); setTxError(null); setSupplierName(""); }}
            disabled={isFinalized}
            className={`flex-1 py-1.5 text-xs font-medium border-l border-gray-200 transition-colors ${
              !isIncoming ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"
            } ${isFinalized ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            ↑ Outgoing
          </button>
        </div>

        <div className="space-y-3">

          {/* Monitoring — always shown */}
          <SearchableSelect
            label="Monitoring"
            value={monitoringEmployee}
            options={monitoringOptions}
            onChange={(v) => { setMonitoringEmployee(v); setTxError(null); }}
            placeholder="Select monitoring employee…"
            disabled={isFinalized}
          />

          {/* Representative — outgoing only (required) */}
          {!isIncoming && (
            <SearchableSelect
              label="Representative"
              value={representativeEmployee}
              options={representativeOptions}
              onChange={(v) => { setRepresentativeEmployee(v); setTxError(null); }}
              placeholder="Select representative employee…"
              disabled={isFinalized}
            />
          )}

          {/* Staff — outgoing only */}
          {!isIncoming && (
            <SearchableSelect
              label="Staff"
              value={staffEmployee}
              options={staffOptions}
              onChange={(v) => { setStaffEmployee(v); setTxError(null); }}
              placeholder={staffOptions.length ? "Select staff…" : "No staff found — add one in Employees"}
              disabled={isFinalized || staffOptions.length === 0}
            />
          )}

          {/* Supplier — raw + packaging incoming only */}
          {showSupplier && (
            <SearchableSelect
              label="Supplier"
              value={supplierName}
              options={supplierOptions}
              onChange={(v) => { setSupplierName(v); setTxError(null); }}
              placeholder="Select supplier…"
              disabled={isFinalized}
            />
          )}

          {/* Qty */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-black">
              {isIncoming ? "Incoming Qty" : "Outgoing Qty"}
            </label>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              type="number"
              min="0"
              disabled={isFinalized}
              className={`border border-gray-300 p-2 w-full rounded text-sm text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isFinalized ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
            />
          </div>

          {txError && <p className="text-xs text-red-600">{txError}</p>}

          <button
            onClick={applyChange}
            disabled={saving || isFinalized}
            className={`w-full py-2 rounded text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isIncoming ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}
            title={isFinalized ? "Panel locked — undo finalize to edit" : ""}
          >
            {saving ? "Saving…" : isIncoming ? "+ Apply Incoming" : "− Apply Outgoing"}
          </button>
        </div>
      </div>

      {/* ── Count Correction ── */}
      <div className="border-t border-gray-100 pt-3 mt-3 space-y-2">
        <p className="text-xs font-semibold text-black mb-2">Count Correction</p>

        {!monitoringEmployee && (
          <p className="text-xs text-amber-700">Select a monitoring employee above first.</p>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-black">
            Actual count
          </label>
          <input
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="Physical count…"
            type="number"
            min="0"
            disabled={isFinalized}
            className={`border border-gray-300 p-2 w-full rounded text-sm text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isFinalized ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
          />
        </div>

        {lossPreview !== null && (
          <p className={`text-xs ${lossPreview > 0 ? "text-red-600" : "text-green-700"}`}>
            Loss preview: {lossPreview}{lossPreview === 0 ? " (no loss)" : ""}
          </p>
        )}

        <button
          onClick={setActualValue}
          disabled={saving || isFinalized}
          className="bg-purple-600 hover:bg-purple-700 text-white w-full py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={isFinalized ? "Panel locked — undo finalize to edit" : ""}
        >
          {saving ? "Saving…" : "Update Actual Count"}
        </button>
      </div>
    </div>
  );
}