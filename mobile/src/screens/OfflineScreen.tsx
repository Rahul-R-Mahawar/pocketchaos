import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ResultRow } from '../components/ResultRow';
import { useConfig } from '../state/ConfigContext';
import { useQueue } from '../state/QueueContext';
import { Badge, Banner, Button, Card, MethodBadge, SectionTitle, ToggleRow } from '../ui/primitives';
import { colors, mono, space } from '../ui/theme';

const REASON_LABELS = {
  simulated_offline: 'simulated offline',
  network_error: 'network error',
  timeout: 'timeout',
  http_503: 'HTTP 503',
} as const;

export function OfflineScreen() {
  const { pairing } = useConfig();
  const { items, failed, simulateOffline, setSimulateOffline, syncing, progress, lastReport, replayResults, notice, replay, clear, clearFailed } = useQueue();
  const projectKey = pairing.status === 'paired' ? pairing.data.projectKey : null;
  const pending = projectKey ? items.filter((item) => item.projectKey === projectKey) : items;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <ToggleRow
          label="Simulate Offline Mode"
          description="Batch requests are queued instead of sent. Real network errors and 503s are queued automatically."
          value={simulateOffline}
          onValueChange={setSimulateOffline}
          tint={colors.info}
        />
      </Card>

      {notice && <Banner tone="warning">{notice}</Banner>}

      <Card>
        <SectionTitle icon="cloud-offline" right={<Text style={styles.count}>{pending.length} pending</Text>}>
          Offline queue
        </SectionTitle>
        {pending.length === 0 ? (
          <Text style={styles.hint}>Nothing queued. Turn on Simulate Offline Mode and run a batch to fill it.</Text>
        ) : (
          pending.map((item) => (
            <View key={item.id} style={styles.item} accessible accessibilityLabel={`Queued ${item.method} ${item.path}`}>
              <View style={styles.itemHead}>
                <Text style={styles.seq}>#{item.seq}</Text>
                <MethodBadge method={item.method} />
                <Text style={styles.path} numberOfLines={1}>
                  {item.path}
                </Text>
                {/* A marker left by a sync that failed to save is stale: only show it while syncing. */}
                {item.inFlightSince && syncing && <Badge label="sending" color={colors.info} />}
              </View>
              <Text style={styles.meta}>
                {new Date(item.createdAt).toLocaleTimeString()} · {REASON_LABELS[item.reason]}
                {item.attempts ? ` · ${item.attempts} failed replay(s)` : ''}
                {item.lastError ? ` · last: ${item.lastError}` : ''}
              </Text>
              {item.body ? (
                <Text style={styles.payload} numberOfLines={2}>
                  {item.body}
                </Text>
              ) : null}
            </View>
          ))
        )}

        {syncing && progress && (
          <View style={styles.progress} accessibilityLiveRegion="polite" accessibilityLabel={`Syncing ${progress.done} of ${progress.total}`}>
            <Text style={styles.progressText}>
              Syncing {progress.done}/{progress.total}
              {progress.current ? ` · ${progress.current.method} ${progress.current.path}` : ''}
            </Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }]} />
            </View>
          </View>
        )}

        <View style={styles.actions}>
          <Button
            label={syncing ? 'Syncing…' : 'Replay & Sync Queue'}
            icon="sync"
            loading={syncing}
            disabled={pending.length === 0 || simulateOffline || !projectKey}
            onPress={() => void replay()}
            style={{ flex: 1 }}
          />
          <Button label="Clear" icon="trash" variant="secondary" disabled={syncing || items.length === 0} onPress={() => void clear()} />
        </View>
        {simulateOffline && pending.length > 0 && <Text style={styles.hint}>Turn off Simulate Offline Mode to replay.</Text>}

        {lastReport && !syncing && (
          <Banner tone={lastReport.stopped ? 'warning' : 'success'}>
            {`Delivered ${lastReport.delivered}, rejected ${lastReport.rejected} of ${lastReport.total}.`}
            {lastReport.stopped ? ` Stopped at ${lastReport.stopped.item.path} (${lastReport.stopped.error}); it stays first in line.` : ''}
            {lastReport.skippedOtherProjects ? ` ${lastReport.skippedOtherProjects} item(s) belong to another project.` : ''}
          </Banner>
        )}
      </Card>

      {failed.length > 0 && (
        <Card>
          <SectionTitle icon="alert-circle" right={<Button label="Clear" variant="secondary" onPress={() => void clearFailed()} />}>
            Rejected (not retried)
          </SectionTitle>
          {failed.map((item) => (
            <Text key={item.id} style={styles.meta}>
              {item.method} {item.path} · HTTP {item.status}
            </Text>
          ))}
        </Card>
      )}

      <Card style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
        <View style={{ paddingHorizontal: space.lg }}>
          <SectionTitle icon="cloud-done">Replay results</SectionTitle>
          <Text style={styles.hint}>Each replay reuses the request's Idempotency-Key. Tap to inspect.</Text>
        </View>
        {replayResults.length === 0 ? (
          <Text style={[styles.hint, { padding: space.lg }]}>No replays yet.</Text>
        ) : (
          <View style={{ paddingLeft: space.lg }}>
            {replayResults.map((result) => (
              <ResultRow key={`${result.id}-${result.seq}`} result={result} />
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
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  count: { color: colors.textFaint, fontSize: 12, fontFamily: mono },
  item: { borderTopWidth: 1, borderColor: colors.border, paddingTop: space.sm, gap: 3 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  seq: { color: colors.textFaint, fontFamily: mono, fontSize: 12 },
  path: { color: colors.text, fontFamily: mono, fontSize: 13, flex: 1 },
  meta: { color: colors.textMuted, fontSize: 12 },
  payload: { color: colors.textFaint, fontFamily: mono, fontSize: 11 },
  progress: { gap: 6 },
  progressText: { color: colors.info, fontSize: 13, fontFamily: mono },
  bar: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.info },
  actions: { flexDirection: 'row', gap: space.sm },
});
