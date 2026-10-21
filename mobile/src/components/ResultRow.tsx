import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RunResult } from '../runner/batchRunner';
import { OUTCOME_STYLES, outcomeLabel } from '../ui/outcomes';
import { MethodBadge } from '../ui/primitives';
import { colors, mono, space } from '../ui/theme';
import { useInspector } from './InspectorModal';

export function ResultRow({ result }: { result: RunResult }) {
  const { open } = useInspector();
  const style = OUTCOME_STYLES[result.outcome];
  const label = outcomeLabel(result);
  const detail =
    result.outcome === 'schema_corruption' && result.integrity
      ? `${result.integrity.deviations.length} field(s): ${result.integrity.deviations.map((d) => d.path).slice(0, 3).join(', ')}`
      : result.errorMessage ?? (result.chaosApplied && result.chaosApplied !== 'none' ? result.chaosApplied : null);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${result.method} ${result.path}, ${label}${result.status ? `, status ${result.status}` : ''}. Open inspector`}
      onPress={() => open(result)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <View style={[styles.stripe, { backgroundColor: style.color }]} />
      <View style={styles.main}>
        <View style={styles.line}>
          <MethodBadge method={result.method} />
          <Text style={styles.path} numberOfLines={1}>
            {result.path}
          </Text>
          <Text style={[styles.status, { color: style.color }]}>{result.status ?? '—'}</Text>
        </View>
        <View style={styles.line}>
          <Text style={[styles.outcome, { color: style.color }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.meta}>
            {result.latencyMs === null ? '' : `${result.latencyMs} ms`}
            {result.attempts.length > 1 ? ` · ${result.attempts.length} attempts` : ''}
            {result.queued ? ' · queued' : ''}
          </Text>
        </View>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingRight: space.md, borderBottomWidth: 1, borderColor: colors.border },
  stripe: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  main: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  path: { color: colors.text, fontFamily: mono, fontSize: 13, flex: 1 },
  status: { fontFamily: mono, fontWeight: '800', fontSize: 13 },
  outcome: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  meta: { color: colors.textFaint, fontSize: 11, fontFamily: mono, marginLeft: 'auto' },
  detail: { color: colors.textMuted, fontSize: 11, fontFamily: mono },
});
