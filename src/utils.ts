import type { ReducedTrialRow } from "psyflow-web";

import type { PlannedTrustCondition } from "./controller";

export function parse_trust_condition(condition: string): PlannedTrustCondition {
  const parsed = JSON.parse(String(condition)) as Partial<PlannedTrustCondition>;
  return {
    condition: String(parsed.condition ?? "medium_trust"),
    partner_label: String(parsed.partner_label ?? "Partner"),
    return_ratio: Number(parsed.return_ratio ?? 0.4),
    condition_id: String(parsed.condition_id ?? "unknown"),
    trial_index: Math.max(1, Number(parsed.trial_index ?? 1))
  };
}

export function summarizeBlock(rows: ReducedTrialRow[], blockId: string): {
  trust_rate: string;
  block_earned: number;
  total_earned: number;
} {
  const blockRows = rows.filter((row) => String(row.block_id ?? "") === blockId);
  const n = Math.max(1, blockRows.length);
  const trustedN = blockRows.filter((row) => row.trusted === true).length;
  const blockEarned = blockRows.reduce((sum, row) => sum + Number(row.earned ?? 0), 0);
  const totalEarned = rows.length > 0 ? Number(rows[rows.length - 1].total_earned ?? 0) : 0;
  return {
    trust_rate: `${((trustedN / n) * 100).toFixed(1)}%`,
    block_earned: blockEarned,
    total_earned: totalEarned
  };
}

export function summarizeOverall(rows: ReducedTrialRow[]): {
  total_earned: number;
} {
  return {
    total_earned: rows.length > 0 ? Number(rows[rows.length - 1].total_earned ?? 0) : 0
  };
}
