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