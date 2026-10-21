import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ResultRow } from '../components/ResultRow';
import { SummaryCard } from '../components/SummaryCard';
import { useConfig } from '../state/ConfigContext';
import { useQueue } from '../state/QueueContext';
import { BATCH_SIZES, RETRY_OPTIONS, TIMEOUT_OPTIONS, useRunner } from '../state/RunnerContext';
import { Banner, Button, Card, Chip, Field, SectionTitle, Segmented, ToggleRow } from '../ui/primitives';
import { colors, space } from '../ui/theme';

export function RunnerScreen() {
  const { pairing } = useConfig();
  const { simulateOffline } = useQueue();
  const { settings, update, plan, planError, cost, results, summary, running, runError, run, stop, clear } = useRunner();

  if (pairing.status !== 'paired') {
    return (
      <View style={[styles.screen, styles.empty]}>
        <Text style={styles.emptyTitle}>Not paired yet</Text>
        <Text style={styles.hint}>Enter your project key on the Pair tab to load endpoints and chaos rules.</Text>
      </View>
    );
  }

  const endpoints = pairing.data.endpoints;
  const needsPayload = plan?.endpoints.some((endpoint) => endpoint.method !== 'GET' && endpoint.method !== 'DELETE') ?? false;
  const ordered = [...results].reverse();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <SectionTitle icon="flash">Target</SectionTitle>
        <View style={styles.chips}>
          <Chip label="Run All" sublabel={`${endpoints.length} endpoints`} selected={settings.target === 'all'} onPress={() => update({ target: 'all' })} />
          {endpoints.map((endpoint) => (
            <Chip
              key={endpoint.id}
              label={endpoint.name}
              sublabel={`${endpoint.method} ${endpoint.path}`}
              selected={settings.target === endpoint.id}
              onPress={() => update({ target: endpoint.id })}
            />
          ))}
        </View>
      </Card>

      <Card>
        <SectionTitle icon="options">Resilience wrapper</SectionTitle>
        <Segmented label="Requests per endpoint" options={BATCH_SIZES} value={settings.requestsPerEndpoint} onChange={(requestsPerEndpoint) => update({ requestsPerEndpoint })} />
        <Segmented
          label="Timeout"
          options={TIMEOUT_OPTIONS}
          value={settings.timeoutMs}
          onChange={(timeoutMs) => update({ timeoutMs })}
          format={(ms) => `${ms / 1000}s`}
        />
        <ToggleRow
          label="Exponential backoff retries"
          description="Retries timeouts, network errors, 5xx and 429. Never other 4xx."
          value={settings.retryEnabled}
          onValueChange={(retryEnabled) => update({ retryEnabled })}
        />
        {settings.retryEnabled && (
          <Segmented label="Max retries" options={RETRY_OPTIONS} value={settings.maxRetries} onChange={(maxRetries) => update({ maxRetries })} />
        )}
        {needsPayload && (
          <Field
            label="JSON payload (POST/PUT/PATCH)"
            value={settings.payload}
            onChangeText={(payload) => update({ payload })}
            multiline
            monospace
            autoCapitalize="none"
            style={{ minHeight: 72, textAlignVertical: 'top' }}
            hint="Retried writes reuse one Idempotency-Key so a server can drop duplicates"
          />
        )}
        <Text style={styles.hint}>
          {cost.requests} requests · up to {cost.worstCaseAttempts} attempts · headers: x-client-platform: react-native
        </Text>
      </Card>

      {simulateOffline && <Banner tone="info">Simulate Offline Mode is on: requests go straight to the offline queue.</Banner>}
      {planError && <Banner tone="warning">{planError}</Banner>}
      {runError && <Banner tone="danger">{runError}</Banner>}

      <View style={styles.actions}>
        {running ? (
          <Button label="Stop batch" icon="stop" variant="danger" onPress={stop} style={{ flex: 1 }} />
        ) : (
          <Button label="Run chaos batch" icon="play" onPress={() => void run()} disabled={Boolean(planError)} style={{ flex: 1 }} />
        )}
        <Button label="Clear" icon="trash" variant="secondary" onPress={clear} disabled={running || results.length === 0} />
      </View>

      <SummaryCard summary={summary} running={running} />

      <Card style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
        <View style={{ paddingHorizontal: space.lg }}>
          <SectionTitle icon="list">Results</SectionTitle>
          <Text style={styles.hint}>Tap a result to inspect status, latency, headers and the raw body.</Text>
        </View>
        {ordered.length === 0 ? (
          <Text style={[styles.hint, { padding: space.lg }]}>No results yet.</Text>
        ) : (
          <View style={{ paddingLeft: space.lg }}>
            {ordered.map((result) => (
              <ResultRow key={result.id} result={result} />
            ))}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 40 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm },
});
