"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabaseClient";
import {
  writeInventory,
  queueTxLog,
  setCache,
  getCache,
  patchInventorySnapshot,
} from "@/lib/sync";

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export default function ManipulatePanel({ item, tab, onClose, onUpdated, onLocalPatch }) {
  const supabase = createClient();

  const [qty,    setQty]    = useState("");
  const [actual, setActual] = useState("");
  const [saving, setSaving] = useState(false);

  const [role,               setRole]               = useState(null);
  const [userId,             setUserId]             = useState(null);
  const [offlineMode,        setOfflineMode]        = useState(false);
  const [monitoringOptions,  setMonitoringOptions]  = useState([]);
  const [monitoringEmployee, setMonitoringEmployee] = useState("");
  const [txError,            setTxError]            = useState(null);

  const table       = tab === "finished" ? "finished_products_inventory"      : "raw_materials_inventory";
  const txLogTable  = tab === "finished" ? "finished_products_transaction_log" : "raw_materials_transaction_log";
  const snapshotKey = tab === "finished" ? "finished"                          : "raw";

  const displayedCurrent = Number(item.current_bal     ?? 0);
  const pendingIn        = Number(item._pendingIncoming ?? 0);
  const pendingOut       = Number(item._pendingOutgoing ?? 0);

  // ── Permission init ───────────────────────────────────────────────────────
  // Online: fetch live, write to cache.
  // Offline or fetch fails: read from cache so the panel never hangs.

  useEffect(() => {
    let cancelled = false;

    async function loadFromCache() {
      const [r, u, m] = await Promise.all([
        getCache("role"),
        getCache("userId"),
        getCache("monitoringOptions"),
      ]);
      if (cancelled) return;
      setRole(r ?? "staff");
      setUserId(u ?? null);
      setMonitoringOptions(m ?? []);
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

        const [{ data: profile }, { data: monRows }] = await Promise.all([
          supabase.from("profiles").select("role").eq("id", user.id).single(),
          supabase.from("monitoring_employee").select("name"),
        ]);
        if (cancelled) return;

        const resolvedRole = profile?.role ?? "staff";
        const monNames     = (monRows ?? []).map((r) => r.name);
        setRole(resolvedRole);
        setMonitoringOptions(monNames);
        await setCache("role",              resolvedRole);
        await setCache("monitoringOptions", monNames);
      } catch (e) {
        console.error("[ManipulatePanel] live fetch failed, using cache:", e);
        await loadFromCache();
      }
    }

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shared tx log payload builder ─────────────────────────────────────────

  function buildTxPayload({ mode, q, actual_bal, loss, txType }) {
    return {
      inventory_id:            item.id,
      monitoring_employee:     monitoringEmployee,
      representative_employee: null,
      product_name:            item.name,
      incoming_bal:            txType === "stock_movement" && mode === "in"  ? q : 0,
      outgoing_bal:            txType === "stock_movement" && mode === "out" ? q : 0,
      finalized_at:            new Date().toISOString(),
      created_by:              userId,
      transaction_source:      "manipulated",
      transaction_type:        txType,
      actual_bal,
      loss,
    };
  }

  // ── +IN / −OUT ────────────────────────────────────────────────────────────

  async function applyChange(mode) {
    const q = Number(qty || 0);
    if (!q) { setQty(""); return; }
    if (!monitoringEmployee) { setTxError("Select a monitoring employee."); return; }
    setTxError(null);
    setSaving(true);

    await onUpdated(async () => {
      const online = isOnline();

      // ── compute new balances ───────────────────────────────────────────
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
        beg             = Number(item.beg_bal      ?? 0);
        incoming        = Number(item.incoming_bal  ?? 0);
        outgoing        = Number(item.outgoing_bal  ?? 0);
        existing_actual = item.actual_bal != null ? Number(item.actual_bal) : null;
      }

      if (mode === "in")  incoming += q;
      if (mode === "out") outgoing += q;

      const current_bal = beg + incoming - outgoing;
      const actual_bal  = existing_actual ?? current_bal;
      const loss        = existing_actual != null ? Math.max(0, current_bal - existing_actual) : 0;

      const invPayload = { id: item.id, name: item.name, beg_bal: beg, incoming_bal: incoming, outgoing_bal: outgoing, current_bal, actual_bal, loss };
      const txPayload  = buildTxPayload({ mode, q, actual_bal, loss, txType: "stock_movement" });

      // ── write ─────────────────────────────────────────────────────────
      const synced = await writeInventory(table, item.id, invPayload);

      if (!synced) {
        // Offline: queue tx log, patch snapshot and local state immediately
        await queueTxLog(txLogTable, txPayload);
        const patch = { beg_bal: beg, incoming_bal: incoming, outgoing_bal: outgoing, current_bal, actual_bal, loss };
        await patchInventorySnapshot(snapshotKey, item.id, patch);
        onLocalPatch?.(item.id, patch);
        return null;
      }

      // Online: insert tx log live
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
        beg_bal      = Number(item.beg_bal      ?? 0);
        incoming_bal = Number(item.incoming_bal  ?? 0);
        outgoing_bal = Number(item.outgoing_bal  ?? 0);
        current_bal  = Number(item.current_bal   ?? 0);
      }

      const loss       = Math.max(0, current_bal - a);
      const invPayload = { id: item.id, name: item.name, beg_bal, incoming_bal, outgoing_bal, current_bal, actual_bal: a, loss };
      const txPayload  = buildTxPayload({ mode: null, q: 0, actual_bal: a, loss, txType: "count_correction" });

      const synced = await writeInventory(table, item.id, invPayload);

      if (!synced) {
        await queueTxLog(txLogTable, txPayload);
        const patch = { current_bal, actual_bal: a, loss };
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
      <div className="fixed bottom-6 right-6 bg-white text-gray-900 border shadow-lg p-4 w-80 rounded-lg z-10">
        <div className="flex justify-between items-start mb-3">
          <h2 className="font-bold text-base">{item.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-sm text-gray-400 text-center py-6 animate-pulse">Checking permissions…</p>
      </div>
    );
  }

  // ── Staff blocked ─────────────────────────────────────────────────────────

  if (role !== "admin") {
    return (
      <div className="fixed bottom-6 right-6 bg-white text-gray-900 border shadow-lg p-4 w-80 rounded-lg z-10">
        <div className="flex justify-between items-start mb-4">
          <h2 className="font-bold text-base">{item.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-6 text-center">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-sm font-semibold text-red-700">Access Restricted</p>
          <p className="text-xs text-red-400 mt-1">Only admins can manipulate inventory.</p>
        </div>
      </div>
    );
  }

  // ── Admin panel ───────────────────────────────────────────────────────────

  return (
    <div className="fixed bottom-6 right-6 bg-white text-gray-900 border shadow-lg p-4 w-80 rounded-lg z-10">
      <div className="flex justify-between items-start mb-3">
        <h2 className="font-bold text-base">{item.name}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
      </div>

      {offlineMode && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="font-semibold">Offline mode</span> — using cached permissions. Changes sync when wifi returns.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center text-xs">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-400 mb-0.5">Current</div>
          <div className="font-semibold text-gray-800">{displayedCurrent}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-400 mb-0.5">Actual</div>
          <div className="font-semibold text-gray-800">{Number(item.actual_bal ?? 0)}</div>
        </div>
        <div className="bg-red-50 rounded p-2">
          <div className="text-red-400 mb-0.5">Loss</div>
          <div className="font-semibold text-red-600">{Number(item.loss ?? 0)}</div>
        </div>
      </div>

      {/* Pending orders */}
      {(pendingIn > 0 || pendingOut > 0) && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <div className="font-semibold mb-0.5">Pending orders (not yet closed)</div>
          {pendingIn  > 0 && <div>↓ Incoming: +{pendingIn}</div>}
          {pendingOut > 0 && <div>↑ Outgoing: −{pendingOut}</div>}
        </div>
      )}

      {/* Monitoring employee */}
      <div className="mb-3">
        <label className="text-xs font-medium uppercase tracking-wide text-gray-500 block mb-1">
          Monitoring employee
        </label>
        <select
          value={monitoringEmployee}
          onChange={(e) => { setMonitoringEmployee(e.target.value); setTxError(null); }}
          className="border p-2 w-full rounded text-sm text-gray-900 bg-white"
        >
          <option value="">Select…</option>
          {monitoringOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <p className="text-[11px] text-gray-400 mt-1">Required — attributed in Transaction Logs.</p>
      </div>

      {txError && <p className="text-xs text-red-500 mb-2">{txError}</p>}

      {/* IN / OUT */}
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="Quantity"
        type="number" min="0"
        className="border p-2 w-full mb-2 rounded text-sm text-gray-900"
      />
      <div className="flex gap-2 mb-4">
        <button onClick={() => applyChange("in")} disabled={saving}
          className="bg-green-600 text-white w-full py-1.5 rounded text-sm disabled:opacity-50">
          + IN
        </button>
        <button onClick={() => applyChange("out")} disabled={saving}
          className="bg-red-600 text-white w-full py-1.5 rounded text-sm disabled:opacity-50">
          − OUT
        </button>
      </div>

      {/* Actual count */}
      <div className="border-t border-gray-100 pt-3">
        <label className="text-xs font-medium uppercase tracking-wide text-gray-500 block mb-1">
          Set actual count
        </label>
        <input
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          placeholder="Actual count"
          type="number" min="0"
          className="border p-2 w-full mb-2 rounded text-sm text-gray-900"
        />
        {lossPreview !== null && (
          <p className={`text-xs mb-2 ${lossPreview > 0 ? "text-red-500" : "text-green-600"}`}>
            Loss preview: {lossPreview}{lossPreview === 0 ? " (no loss)" : ""}
          </p>
        )}
        <button onClick={setActualValue} disabled={saving}
          className="bg-purple-600 text-white w-full py-1.5 rounded text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Update actual"}
        </button>
      </div>
    </div>
  );
}