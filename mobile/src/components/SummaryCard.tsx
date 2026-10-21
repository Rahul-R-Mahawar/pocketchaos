import { StyleSheet, Text, View } from 'react-native';
import type { BatchSummary } from '../runner/batchRunner';
import { Card, SectionTitle } from '../ui/primitives';
import { colors, mono, space } from '../ui/theme';

function Metric({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function SummaryCard({ summary, running }: { summary: BatchSummary; running: boolean }) {
  const successColor = summary.successPct >= 80 ? colors.accent : summary.successPct >= 50 ? colors.warning : colors.danger;
  return (
    <Card>
      <SectionTitle icon="pulse" right={<Text style={styles.live}>{running ? '● live' : `${summary.total} requests`}</Text>}>
        Resilience summary
      </SectionTitle>
      <View style={styles.grid}>
        <Metric label="Success" value={summary.total ? `${summary.successPct}%` : '—'} color={summary.total ? successColor : colors.textFaint} />
        <Metric label="Avg latency" value={summary.avgLatencyMs === null ? '—' : `${summary.avgLatencyMs} ms`} color={colors.info} />
        <Metric label="4xx/5xx faults" value={String(summary.faults4xx + summary.faults5xx)} color={colors.danger} />
        <Metric label="Timeouts" value={String(summary.timeouts)} color={colors.danger} />
        <Metric label="Corrupted caught" value={String(summary.corruptedCaught)} color={colors.warning} />
        <Metric label="Queued" value={String(summary.queued)} color={colors.info} />
      </View>
      {summary.injectedCorruptions > 0 && (
        <Text style={styles.footnote}>
          Detector caught {summary.detectedOfInjected} of {summary.injectedCorruptions} injected corruptions
          {summary.falsePositives ? ` · ${summary.falsePositives} false positive(s)` : ''}.
        </Text>
      )}
      {(summary.rateLimited > 0 || summary.networkErrors > 0 || summary.retries > 0 || summary.unverified > 0) && (
        <Text style={styles.footnote}>
          {[
            summary.retries ? `${summary.retries} retries` : null,
            summary.networkErrors ? `${summary.networkErrors} network errors` : null,
            summary.rateLimited ? `${summary.rateLimited} rate-limited (429)` : null,
            summary.unverified ? `${summary.unverified} payloads not yet verifiable (need 2+ samples)` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  metric: { width: '33.33%', gap: 2 },
  value: { fontSize: 20, fontWeight: '800', fontFamily: mono },
  label: { color: colors.textFaint, fontSize: 11, fontWeight: '600' },
  live: { color: colors.textFaint, fontSize: 12, fontFamily: mono },
  footnote: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
