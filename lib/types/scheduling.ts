import type { Database } from "@/lib/supabase/database.types";

// ---- Base row types from database ----

export type WorkOrderRow = Database["public"]["Tables"]["work_orders"]["Row"];
export type WorkOrderInsert = Database["public"]["Tables"]["work_orders"]["Insert"];
export type WorkOrderUpdate = Database["public"]["Tables"]["work_orders"]["Update"];

export type TradeRow = Database["public"]["Tables"]["trades"]["Row"];
export type TradeInsert = Database["public"]["Tables"]["trades"]["Insert"];
export type TradeUpdate = Database["public"]["Tables"]["trades"]["Update"];

export type ScopeLibraryRow = Database["public"]["Tables"]["scope_library"]["Row"];

// ---- Enum-style string union types ----

export type TradeAvailability =
  | "more_capacity"
  | "maintain_capacity"
  | "reduce_capacity"
  | "on_pause";

export type WorkOrderGaryState =
  | "not_started"
  | "waiting_on_dependent"
  | "waiting_reply"
  | "booking_proposed"
  | "confirmed"
  | "return_visit_pending"
  | "complete";

export type WorkOrderVisitStatus =
  | "unscheduled"
  | "gary_sent"
  | "proposed"
  | "confirmed"
  | "complete";

export type ProximityRange = "standard" | "extended";

export type BlueprintStatus = "draft" | "confirmed" | "superseded";

// ---- Blueprint JSONB structure ----

export interface BlueprintVisit {
  visit_number: number;
  estimated_hours: number;
  lag_days_after: number;
  lag_description: string | null;
}

export interface BlueprintTrade {
  trade_type: string;
  trade_id: string;
  trade_name: string;
  proximity_range: ProximityRange;
  availability: TradeAvailability;
  sequence_order: number;
  is_concurrent: boolean;
  predecessor_index: number | null;
  estimated_hours: number;
  visits: BlueprintVisit[];
}

export interface BlueprintDraftData {
  trades: BlueprintTrade[];
}

// ---- Typed interfaces (stricter than raw DB rows) ----

export interface WorkOrder extends Omit<WorkOrderRow, "gary_state" | "proximity_range"> {
  gary_state: WorkOrderGaryState;
  proximity_range: ProximityRange | null;
}

export interface Trade extends Omit<TradeRow, "availability"> {
  availability: TradeAvailability;
}
