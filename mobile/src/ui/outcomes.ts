import type { RunOutcome, RunResult } from '../runner/batchRunner';
import { colors } from './theme';

export const OUTCOME_STYLES: Record<RunOutcome, { label: string; color: string; soft: string }> = {
  success: { label: 'OK', color: colors.accent, soft: colors.accentSoft },
  schema_corruption: { label: 'SCHEMA_CORRUPTION_DETECTED', color: colors.warning, soft: colors.warningSoft },
  invalid_json: { label: 'INVALID_JSON', color: colors.warning, soft: colors.warningSoft },
  http_4xx: { label: '4xx fault', color: colors.warning, soft: colors.warningSoft },
  http_5xx: { label: '5xx fault', color: colors.danger, soft: colors.dangerSoft },
  rate_limited: { label: 'Rate limited', color: colors.violet, soft: colors.violetSoft },
  timeout: { label: 'Timeout', color: colors.danger, soft: colors.dangerSoft },
  network_error: { label: 'Network error', color: colors.danger, soft: colors.dangerSoft },
  queued_offline: { label: 'Queued (offline)', color: colors.info, soft: colors.infoSoft },
  cancelled: { label: 'Cancelled', color: colors.textFaint, soft: 'transparent' },
};

/** "OK" is only said for bodies the detector could vouch for; replays only decide delivery and are not checked. */
export function outcomeLabel(result: Pick<RunResult, 'outcome' | 'source' | 'integrity'>): string {
  if (result.source === 'replay' && result.outcome === 'success') return 'Delivered (integrity not checked)';
  if (result.outcome === 'success' && result.integrity?.verdict === 'UNVERIFIED') return 'OK (integrity unverified)';
  return OUTCOME_STYLES[result.outcome].label;
}
