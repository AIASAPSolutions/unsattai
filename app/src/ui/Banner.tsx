import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { T } from './Text';
import { colors, radius, space } from './theme';

export type Tone = 'pass' | 'info' | 'warn' | 'fail';

const TONES: Record<Tone, { bg: string; fg: string; icon: string }> = {
  pass: { bg: colors.passSoft, fg: colors.pass, icon: '✓' },
  info: { bg: colors.infoSoft, fg: colors.info, icon: 'ℹ' },
  warn: { bg: colors.warnSoft, fg: colors.warn, icon: '!' },
  fail: { bg: colors.failSoft, fg: colors.fail, icon: '✕' },
};

export function Banner({ tone, text, action, onAction, children, testID }: {
  tone: Tone; text: string; action?: string; onAction?: () => void; children?: ReactNode; testID?: string;
}) {
  const c = TONES[tone];
  return (
    <View
      testID={testID}
      style={[styles.box, { backgroundColor: c.bg }]}
      accessibilityRole={tone === 'fail' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <T variant="label" color={c.fg} style={styles.icon}>{c.icon}</T>
        <T variant="body" color={colors.ink} style={{ flex: 1 }}>{text}</T>
      </View>
      {children}
      {action && onAction ? <Button kind="ghost" compact label={action} onPress={onAction} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  icon: { width: 22, textAlign: 'center', marginRight: space(2) },
});
