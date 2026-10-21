import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseBody } from '../integrity/schemaIntegrity';
import type { RunResult } from '../runner/batchRunner';
import { OUTCOME_STYLES, outcomeLabel } from '../ui/outcomes';
import { Badge, MethodBadge } from '../ui/primitives';
import { colors, mono, radius, space } from '../ui/theme';
import { ErrorBoundary } from './ErrorBoundary';

interface InspectorContextValue {
  open: (result: RunResult) => void;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function useInspector(): InspectorContextValue {
  const value = useContext(InspectorContext);
  if (!value) throw new Error('useInspector must be used inside <InspectorProvider>');
  return value;
}

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const open = useCallback((next: RunResult) => setResult(next), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <InspectorContext.Provider value={value}>
      {children}
      <InspectorModal result={result} onClose={() => setResult(null)} />
    </InspectorContext.Provider>
  );
}

/** Pretty-prints JSON when possible; anything else is shown verbatim. Always plain Text, never parsed as markup. */
export function formatBody(result: RunResult): string {
  if (!result.bodyText) return '(empty body)';
  const parsed = parseBody(result.bodyText, result.responseHeaders['content-type']);
  if (parsed.kind !== 'json') return result.bodyText;
  try {
    return JSON.stringify(parsed.value, null, 2);
  } catch {
    return result.bodyText; // nested too deeply to pretty-print (RangeError): show it as received
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function KeyValue({ name, value }: { name: string; value: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvName}>{name}</Text>
      <Text style={styles.kvValue} selectable>
        {value}
      </Text>
    </View>
  );
}

export function InspectorModal({ result, onClose }: { result: RunResult | null; onClose: () => void }) {
  return (
    <Modal visible={result !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Payload Inspector</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close inspector" onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>
        {result && (
          <ErrorBoundary area="The inspector">
            <InspectorBody result={result} />
          </ErrorBoundary>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function InspectorBody({ result }: { result: RunResult }) {
  const outcome = OUTCOME_STYLES[result.outcome];
  const responseHeaders = Object.entries(result.responseHeaders).sort(([a], [b]) => a.localeCompare(b));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.summaryRow}>
        <MethodBadge method={result.method} />
        <Text style={styles.path} numberOfLines={2}>
          {result.path}
        </Text>
      </View>
      <View style={styles.summaryRow}>
        <Badge label={outcomeLabel(result)} color={outcome.color} soft={outcome.soft} />
        {result.queued && <Badge label={`queued: ${result.queued}`} color={colors.info} soft={colors.infoSoft} />}
      </View>

      <Section title="Response">
        <KeyValue name="HTTP status" value={result.status === null ? 'no response' : String(result.status)} />
        <KeyValue name="Latency" value={result.latencyMs === null ? '—' : `${result.latencyMs} ms`} />
        <KeyValue name="Attempts" value={String(result.attempts.length)} />
        <KeyValue name="X-PocketChaos-Applied" value={result.chaosApplied ?? '—'} />
        {result.errorMessage && <KeyValue name="Error" value={result.errorMessage} />}
      </Section>

      {result.attempts.length > 1 && (
        <Section title="Retry timeline">
          {result.attempts.map((attempt) => (
            <Text key={attempt.attempt} style={styles.mono}>
              #{attempt.attempt} {attempt.status ?? attempt.error} · {attempt.latencyMs} ms{attempt.waitedMs ? ` · waited ${attempt.waitedMs} ms` : ''}
            </Text>
          ))}
        </Section>
      )}

      {result.integrity && (
        <Section title="Schema integrity">
          <KeyValue name="Verdict" value={result.integrity.verdict} />
          {result.integrity.basis && <KeyValue name="Baseline" value={result.integrity.basis === 'clean' ? 'learned from clean responses' : 'batch consensus'} />}
          {result.integrity.unverifiedPaths.length > 0 && (
            <KeyValue name="Not verifiable" value={`${result.integrity.unverifiedPaths.join(', ')} (the batch did not agree on these fields)`} />
          )}
          {result.integrity.deviations.map((deviation) => (
            <Text key={`${deviation.path}-${deviation.kind}`} style={[styles.mono, { color: colors.warning }]} selectable>
              {deviation.path}: {deviation.kind} (expected {deviation.expected}, got {deviation.actual})
            </Text>
          ))}
        </Section>
      )}

      <Section title="Request">
        <KeyValue name="URL" value={result.url} />
        {Object.entries(result.requestHeaders).map(([name, value]) => (
          <KeyValue key={name} name={name} value={value} />
        ))}
        {result.requestBody && <Text style={styles.code} selectable>{result.requestBody}</Text>}
      </Section>

      <Section title={`Response headers (${responseHeaders.length})`}>
        {responseHeaders.length === 0 ? (
          <Text style={styles.muted}>No response</Text>
        ) : (
          responseHeaders.map(([name, value]) => <KeyValue key={name} name={name} value={value} />)
        )}
      </Section>

      <Section title="Raw response body">
        <Text style={styles.code} selectable accessibilityLabel="Raw response body">
          {formatBody(result)}
        </Text>
        {result.bodyTruncated && <Text style={styles.muted}>Truncated to the first 20,000 characters.</Text>}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 48 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  path: { color: colors.text, fontFamily: mono, fontSize: 15, flexShrink: 1 },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.md, gap: 6 },
  sectionTitle: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  kv: { flexDirection: 'row', gap: space.md },
  kvName: { color: colors.textFaint, fontSize: 12, width: 130, fontFamily: mono },
  kvValue: { color: colors.text, fontSize: 12, flex: 1, fontFamily: mono },
  mono: { color: colors.textMuted, fontFamily: mono, fontSize: 12 },
  code: { color: colors.text, fontFamily: mono, fontSize: 12, lineHeight: 18, backgroundColor: colors.bg, borderRadius: radius.sm, padding: space.sm },
  muted: { color: colors.textFaint, fontSize: 12 },
});
