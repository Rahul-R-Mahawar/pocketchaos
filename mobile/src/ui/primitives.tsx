import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, methodColors, mono, radius, space } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ icon, children, right }: { icon?: IconName; children: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <View style={styles.row}>
        {icon && <Ionicons name={icon} size={15} color={colors.accent} />}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {children}
        </Text>
      </View>
      {right}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const tint = variant === 'primary' ? colors.bg : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (pressed || inactive) && { opacity: inactive ? 0.45 : 0.8 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={tint} /> : icon && <Ionicons name={icon} size={16} color={tint} />}
      <Text style={[styles.buttonText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, sublabel }: { label: string; selected: boolean; onPress: () => void; sublabel?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && { color: colors.accent }]}>{label}</Text>
      {sublabel ? <Text style={styles.chipSub}>{sublabel}</Text> : null}
    </Pressable>
  );
}

export function Badge({ label, color, soft }: { label: string; color: string; soft?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: soft ?? 'transparent', borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function MethodBadge({ method }: { method: string }) {
  const color = methodColors[method] ?? colors.textMuted;
  return <Text style={[styles.method, { color, borderColor: color }]}>{method}</Text>;
}

export function Field({
  label,
  error,
  hint,
  monospace,
  ...input
}: TextInputProps & { label: string; error?: string | null; hint?: string; monospace?: boolean }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        autoCorrect={false}
        {...input}
        style={[styles.input, monospace && { fontFamily: mono }, error ? { borderColor: colors.danger } : null, input.style]}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  tint = colors.accent,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  tint?: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {description ? <Text style={styles.hint}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: tint }}
        thumbColor={colors.text}
      />
    </View>
  );
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format = String,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={String(option)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${label}: ${format(option)}`}
              onPress={() => onChange(option)}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text style={[styles.segmentText, selected && { color: colors.bg }]}>{format(option)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Banner({ tone, children }: { tone: 'danger' | 'warning' | 'info' | 'success'; children: ReactNode }) {
  const palette = {
    danger: [colors.danger, colors.dangerSoft],
    warning: [colors.warning, colors.warningSoft],
    info: [colors.info, colors.infoSoft],
    success: [colors.accent, colors.accentSoft],
  }[tone];
  return (
    <View accessibilityRole="alert" style={[styles.banner, { borderColor: palette[0], backgroundColor: palette[1] }]}>
      <Text style={{ color: palette[0], fontSize: 13, lineHeight: 18 }}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: 12, paddingHorizontal: space.lg, borderRadius: radius.md },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger },
  buttonText: { fontSize: 15, fontWeight: '700' },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipSub: { color: colors.textFaint, fontSize: 11, fontFamily: mono, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', fontFamily: mono },
  method: { fontFamily: mono, fontSize: 10, fontWeight: '800', borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 15 },
  error: { color: colors.danger, fontSize: 12 },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  segment: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  segmentSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: space.md },
});
