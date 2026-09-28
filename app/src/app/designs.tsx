import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { DesignCard } from '../components/DesignCard';
import { errorMessage, useT } from '../i18n';
import { useFlow } from '../state/flow';
import { usePrefs } from '../state/prefs';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Empty } from '../ui/States';
import { T } from '../ui/Text';
import { space } from '../ui/theme';
import { useVoiceGuide } from '../voice/useVoiceGuide';

export default function DesignsScreen() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const designs = useFlow((s) => s.designs);
  const generation = useFlow((s) => s.generation);
  const generate = useFlow((s) => s.generate);
  const { speak } = useVoiceGuide();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (designs.length) speak(`${designs.length} ${t('variants')}. ${designs.map((d) => d.spec.style_name).join(', ')}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designs.length]);

  const more = async () => {
    setBusy(true);
    setError(null);
    try {
      await generate(lang, true);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      testID="screen-designs"
      data={designs}
      keyExtractor={(d) => d.id}
      contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
      ListHeaderComponent={
        <View>
          {generation?.fallback_reason ? (
            <Banner tone="info" text={t('fallbackNotice', { reason: generation.fallback_reason })} />
          ) : generation ? <T variant="caption" style={{ marginBottom: space(3) }}>
            {generation.provider.startsWith('image:') ? t('pictureEngine') : t('engine', { name: generation.provider })}
          </T> : null}
        </View>
      }
      ListEmptyComponent={<Empty label={t('noDesigns')} />}
      renderItem={({ item, index }) => <DesignCard d={item} index={index} />}
      ListFooterComponent={
        <View>
          {error ? <Banner tone="fail" text={error} action={t('retry')} onAction={more} /> : null}
          {generation?.provider.startsWith('image:') ? (
            <Button testID="another-picture" kind="secondary" label={t('pictureAnother')} onPress={() => router.push('/from-picture')} />
          ) : (
            <Button testID="more-designs" kind="secondary" label={busy ? t('generating') : t('moreDesigns')} onPress={more} busy={busy} />
          )}
        </View>
      }
    />
  );
}
