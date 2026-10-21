import { Ionicons } from '@expo/vector-icons';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PairedEndpoint } from '../api/pocketChaosApi';
import { parsePort } from '../config/serverPresets';
import { useConfig } from '../state/ConfigContext';
import { Banner, Button, Card, Chip, Field, MethodBadge, SectionTitle } from '../ui/primitives';
import { colors, mono, space } from '../ui/theme';

/** Keeps only key characters and uppercases them as the user types. */
export function sanitizeProjectKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function ChaosRules({ endpoint }: { endpoint: PairedEndpoint }) {
  const { chaosConfig: chaos } = endpoint;
  if (!chaos.enabled) return <Text style={styles.ruleOff}>Chaos off: requests pass through</Text>;
  const rules = [
    chaos.delayMs > 0 ? `+${chaos.delayMs} ms` : null,
    chaos.failureRate > 0 ? `${chaos.failureRate}% → ${chaos.overrideStatusCode ?? 500}` : null,
    chaos.corruptJson ? 'corrupt JSON' : null,
  ].filter((rule): rule is string => rule !== null);
  return (
    <View style={styles.rules}>
      {(rules.length ? rules : ['enabled, no rules set']).map((rule) => (
        <Text key={rule} style={styles.rule}>
          {rule}
        </Text>
      ))}
    </View>
  );
}

export function PairScreen() {
  const { config, presets, baseUrl, baseUrlError, pairing, health, update, pair, testConnection } = useConfig();
  const keyValid = /^[A-Z0-9]{6}$/.test(config.projectKey);
  const keyError = config.projectKey.length > 0 && !keyValid ? `${6 - config.projectKey.length} more character(s)` : null;
  const showPort = config.presetId !== 'custom' && config.presetId !== 'cloud';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={pairing.status === 'loading'} onRefresh={() => void pair()} tintColor={colors.accent} enabled={keyValid} />
      }
    >
      <Card>
        <SectionTitle icon="key">Project key</SectionTitle>
        <Field
          label="6-character pairing key"
          value={config.projectKey}
          onChangeText={(text) => update({ projectKey: sanitizeProjectKey(text) })}
          placeholder="K7Q2XM"
          autoCapitalize="characters"
          maxLength={6}
          monospace
          error={keyError}
          hint="Shown in the dashboard navbar under “Copy Pairing Key”"
          style={styles.keyInput}
        />
      </Card>

      <Card>
        <SectionTitle icon="server">Backend server</SectionTitle>
        <View style={styles.presets}>
          {presets.map((preset) => (
            <Chip
              key={preset.id}
              label={preset.label}
              sublabel={preset.baseUrl ?? (preset.id === 'custom' ? 'enter below' : 'unavailable')}
              selected={config.presetId === preset.id}
              onPress={() => update({ presetId: preset.id })}
            />
          ))}
        </View>
        <Text style={styles.hint}>{presets.find((preset) => preset.id === config.presetId)?.hint}</Text>
        {config.presetId === 'custom' && (
          <Field
            label="Custom URL (LAN IP or deployed)"
            value={config.customUrl}
            onChangeText={(customUrl) => update({ customUrl })}
            placeholder="http://192.168.1.20:4000"
            autoCapitalize="none"
            keyboardType="url"
            monospace
            error={baseUrlError}
          />
        )}
        {showPort && (
          <Field
            label="Backend port"
            value={String(config.port)}
            onChangeText={(text) => {
              const port = parsePort(text);
              if (port) update({ port });
            }}
            keyboardType="number-pad"
            maxLength={5}
            monospace
            hint="The backend's PORT (default 4000; macOS reserves 5000 for AirPlay)"
          />
        )}
        <View style={styles.resolved}>
          <Ionicons name="link" size={14} color={baseUrl ? colors.accent : colors.textFaint} />
          <Text style={[styles.resolvedText, !baseUrl && { color: colors.textFaint }]} numberOfLines={1} accessibilityLabel="Resolved backend URL">
            {baseUrl ?? 'No backend URL yet'}
          </Text>
        </View>
        <Button
          label={health.status === 'checking' ? 'Checking…' : 'Test connection'}
          icon="pulse"
          variant="secondary"
          loading={health.status === 'checking'}
          disabled={!baseUrl}
          onPress={() => void testConnection()}
        />
        {health.status === 'ok' && <Banner tone="success">Backend reachable ({health.latencyMs} ms)</Banner>}
        {health.status === 'error' && <Banner tone="danger">{health.message}</Banner>}
      </Card>

      <Button
        label={pairing.status === 'loading' ? 'Pairing…' : pairing.status === 'paired' ? 'Re-pair & refresh rules' : 'Pair device'}
        icon="phone-portrait"
        loading={pairing.status === 'loading'}
        disabled={!keyValid || !baseUrl}
        onPress={() => void pair()}
      />
      {pairing.status === 'error' && <Banner tone="danger">{pairing.message}</Banner>}

      {pairing.status === 'paired' && (
        <Card>
          <SectionTitle icon="flash" right={<Text style={styles.hint}>{pairing.data.endpoints.length} endpoints</Text>}>
            {`Paired with ${pairing.data.projectKey}`}
          </SectionTitle>
          <Text style={styles.hint}>
            {pairing.baseUrl} · {new Date(pairing.pairedAt).toLocaleTimeString()} · pull down to refresh chaos rules
          </Text>
          {pairing.data.endpoints.length === 0 ? (
            <Text style={styles.ruleOff}>No endpoints yet: create one in the dashboard, then refresh.</Text>
          ) : (
            pairing.data.endpoints.map((endpoint) => (
              <View key={endpoint.id} style={styles.endpoint} accessible accessibilityLabel={`${endpoint.method} ${endpoint.path}`}>
                <View style={styles.endpointHead}>
                  <MethodBadge method={endpoint.method} />
                  <Text style={styles.endpointName} numberOfLines={1}>
                    {endpoint.name}
                  </Text>
                  <Text style={styles.mode}>{endpoint.mode}</Text>
                </View>
                <Text style={styles.endpointPath} numberOfLines={1}>
                  {endpoint.path}
                </Text>
                <ChaosRules endpoint={endpoint} />
              </View>
            ))
          )}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 40 },
  keyInput: { fontSize: 26, letterSpacing: 8, fontWeight: '800', textAlign: 'center', color: colors.accent },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  resolved: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.bg, borderRadius: 8, padding: space.sm },
  resolvedText: { color: colors.accent, fontFamily: mono, fontSize: 13, flex: 1 },
  endpoint: { borderTopWidth: 1, borderColor: colors.border, paddingTop: space.md, gap: 4 },
  endpointHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  endpointName: { color: colors.text, fontWeight: '700', flex: 1 },
  endpointPath: { color: colors.textMuted, fontFamily: mono, fontSize: 13 },
  mode: { color: colors.textFaint, fontSize: 11, textTransform: 'uppercase' },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rule: { color: colors.warning, backgroundColor: colors.warningSoft, fontSize: 11, fontFamily: mono, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  ruleOff: { color: colors.textFaint, fontSize: 12 },
});
