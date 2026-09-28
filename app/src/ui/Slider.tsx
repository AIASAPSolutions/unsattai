import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { T } from './Text';
import { colors, radius, space } from './theme';

// A touch slider that commits once on release (one undo step per drag) and
// reports live values while dragging. Horizontal pans are claimed only after a
// small horizontal movement so vertical scrolling of the page still works.

export function Slider({ label, value, min, max, step = 0.01, onBegin, onChange, onCommit, format, track, testID }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onBegin?: () => void;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  format?: (v: number) => string;
  track?: string[];
  testID?: string;
}) {
  const [width, setWidth] = useState(1);
  const clampStep = (v: number) => {
    const c = Math.max(min, Math.min(max, v));
    return Math.round(c / step) * step;
  };
  const fromX = (x: number) => clampStep(min + (x / width) * (max - min));
  const begin = () => onBegin?.();
  const move = (x: number) => onChange(fromX(x));
  const end = (x: number) => {
    const v = fromX(x);
    onChange(v);
    onCommit?.(v);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((e) => {
      begin();
      move(e.x);
    })
    .onUpdate((e) => move(e.x))
    .onEnd((e) => end(e.x));
  const tap = Gesture.Tap().runOnJS(true).onEnd((e) => {
    begin();
    end(e.x);
  });

  const pct = (value - min) / (max - min || 1);
  const stepBy = (dir: 1 | -1) => {
    const v = clampStep(value + dir * (step * Math.max(1, Math.round((max - min) / step / 20))));
    onBegin?.();
    onChange(v);
    onCommit?.(v);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <T variant="label">{label}</T>
        <T variant="caption">{format ? format(value) : value.toFixed(2)}</T>
      </View>
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View
          testID={testID}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: format ? format(value) : String(value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => stepBy(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
          style={styles.hit}
        >
          <View style={[styles.track, track ? { overflow: 'hidden' } : null]}>
            {track ? (
              <View style={StyleSheet.absoluteFill}>
                <View style={{ flexDirection: 'row', flex: 1 }}>
                  {track.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}
                </View>
              </View>
            ) : (
              <View style={[styles.fill, { width: `${pct * 100}%` }]} />
            )}
          </View>
          <View style={[styles.thumb, { left: `${pct * 100}%` }]} pointerEvents="none" />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space(3) },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space(1) },
  hit: { height: 40, justifyContent: 'center' },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.line },
  fill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.brand },
  thumb: {
    position: 'absolute', width: 26, height: 26, marginLeft: -13, borderRadius: 13, backgroundColor: '#fff',
    borderWidth: 2, borderColor: colors.navy,
  },
});
