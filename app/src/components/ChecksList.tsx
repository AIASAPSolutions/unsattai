import { StyleSheet, View } from 'react-native';
import type { Check, CheckLevel } from '../api/types';
import { useT } from '../i18n';
import { T } from '../ui/Text';
import { colors, radius, space } from '../ui/theme';

const ORDER: CheckLevel[] = ['fail', 'warn', 'info', 'pass'];
const STYLE: Record<CheckLevel, { fg: string; bg: string; icon: string }> = {
  fail: { fg: colors.fail, bg: colors.failSoft, icon: '✕' },
  warn: { fg: colors.warn, bg: colors.warnSoft, icon: '!' },
  info: { fg: colors.info, bg: colors.infoSoft, icon: 'ℹ' },
  pass: { fg: colors.pass, bg: colors.passSoft, icon: '✓' },
};

export function sortChecks(checks: Check[]): Check[] {
  return [...checks].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
}

export function summarize(checks: Check[]): Record<CheckLevel, number> {
  const out: Record<CheckLevel, number> = { fail: 0, warn: 0, info: 0, pass: 0 };
  for (const c of checks) out[c.level] += 1;
  return out;
}

/** Checks exactly as the server reported them: nothing is upgraded to "pass" on the client. */
export function ChecksList({ checks, compact }: { checks: Check[]; compact?: boolean }) {
  const t = useT();
  const list = sortChecks(checks).filter((c) => !compact || c.level === 'fail' || c.level === 'warn');
  return (
    <View>
      {list.map((c, i) => {
        const s = STYLE[c.level];
        return (
          <View key={`${c.id}-${c.element_id ?? ''}-${i}`} style={[styles.row, { backgroundColor: s.bg }]}
            accessible accessibilityLabel={`${t(`level_${c.level}`)}: ${c.message}`}>
            <T variant="label" color={s.fg} style={styles.icon}>{s.icon}</T>
            <View style={{ flex: 1 }}>
              <T variant="caption" color={s.fg} style={{ fontWeight: '700' }}>{t(`level_${c.level}`)}</T>
              <T variant="body" style={{ fontSize: 14 }}>{c.message}</T>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function PrintNotes() {
  const t = useT();
  return (
    <View>
      {(['noteWhite', 'notePolyester', 'notePrototype'] as const).map((k) => (
        <T key={k} variant="caption" style={{ marginBottom: space(2) }}>• {t(k)}</T>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', padding: space(3), borderRadius: radius.md, marginBottom: space(2) },
  icon: { width: 22, textAlign: 'center', marginRight: space(2) },
});
