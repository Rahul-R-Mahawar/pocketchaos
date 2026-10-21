import { Ionicons } from '@expo/vector-icons';
import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/primitives';
import { colors, space } from '../ui/theme';

interface Props {
  children: ReactNode;
  /** Shown in the fallback, e.g. "Runner". */
  area: string;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one broken screen from taking the whole app down. Async errors are handled where they happen;
 * this catches render-time surprises (e.g. a response shape nobody anticipated).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.container} accessibilityRole="alert">
        <Ionicons name="warning" size={32} color={colors.warning} />
        <Text style={styles.title}>{this.props.area} hit an unexpected error</Text>
        <Text style={styles.message} numberOfLines={4}>
          {this.state.error.message}
        </Text>
        <Text style={styles.message}>Your queue and settings are saved. The rest of the app keeps working.</Text>
        <Button label="Try again" icon="refresh" onPress={this.reset} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
