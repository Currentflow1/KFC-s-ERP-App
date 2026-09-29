import Dexie from "dexie";

export const db = new Dexie("InventoryOfflineDB");

db.version(1).stores({
  pending_changes: "++id, table_name, record_id, synced, created_at",
});

db.version(2).stores({
  pending_changes: "++id, table_name, record_id, synced, created_at",
  pending_tx_logs: "++id, table_name, synced, created_at",
  cache:           "key",
});

db.version(3).stores({
  pending_changes:    "++id, table_name, record_id, synced, created_at",
  pending_tx_logs:    "++id, table_name, synced, created_at",
  cache:              "key",
  inventory_snapshot: "tab",
});

db.version(4).stores({
  pending_changes:    "++id, table_name, record_id, synced, created_at",
  pending_tx_logs:    "++id, table_name, synced, created_at",
  cache:              "key",
  inventory_snapshot: "tab",
  meta:               "key",
});

db.version(5).stores({
  pending_changes:     "++id, table_name, record_id, synced, created_at",
  pending_tx_logs:     "++id, table_name, synced, created_at",
  cache:               "key",
  inventory_snapshot:  "tab",
  meta:                "key",
  item_change_history: "++id, tab, created_at",
});

// v6: the outbox. One row = one whole user action (inventory change(s) AND
// transaction-log row(s) together). `op_id` is unique so the same action can
// never be queued twice. The old pending_changes / pending_tx_logs stores stay
// so anything already queued still drains.
db.version(6).stores({
  pending_changes:     "++id, table_name, record_id, synced, created_at",
  pending_tx_logs:     "++id, table_name, synced, created_at",
  cache:               "key",
  inventory_snapshot:  "tab",
  meta:                "key",
  item_change_history: "++id, tab, created_at",
  outbox:              "++id, &op_id, status, created_at",
});