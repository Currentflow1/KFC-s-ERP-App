import { supabase } from "@/lib/supabaseClient";

export async function fetchInventory({ tab, date }) {
  const isHistory = date !== "";

  const table = isHistory
    ? tab === "finished"
      ? "finished_products_inventory_history"
      : "raw_materials_inventory_history"
    : tab === "finished"
      ? "finished_products_inventory"
      : "raw_materials_inventory";

  let query = supabase.from(table).select("*");

  if (isHistory) {
    query = query.eq("inventory_date", date);
  }

  const { data, error } = await query.order("name");

  return { data: error ? [] : data || [] };
}