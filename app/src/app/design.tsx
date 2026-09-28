import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { parseDesignLink } from '../features/links/parseDesignLink';
import { errorMessage, useT } from '../i18n';
import { checkPrompt } from '../lib/validation';
import { EMPTY_BRIEF, useFlow } from '../state/flow';
import { usePrefs } from '../state/prefs';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { ErrorState, Loading } from '../ui/States';

/** App link entry: prefills the brief and optionally starts "check what we understood". */
export default function DesignLinkScreen() {
  const t = useT();
  const params = useLocalSearchParams();
  const setBrief = useFlow((s) => s.setBrief);
  const understand = useFlow((s) => s.understand);
  const setLanguage = usePrefs((s) => s.setLanguage);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const link = parseDesignLink(params);
    const lang = link.language ?? usePrefs.getState().language;
    if (link.language) setLanguage(link.language);
    setBrief({
      ...EMPTY_BRIEF,
      prompt: link.prompt ?? '',
      garment: link.garment ?? EMPTY_BRIEF.garment,
      team_name: link.team_name ?? '',
    });
    if (!link.autostart || !link.prompt || checkPrompt(link.prompt)) {
      router.replace('/');
      return;
    }
    understand(lang)
      .then(() => router.replace('/confirm'))
      .catch((e) => setError(errorMessage(t, e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen testID="screen-design-link">
      {error ? (
        <>
          <ErrorState message={error} retryLabel={t('retry')} onRetry={() => {
            setError(null);
            understand(usePrefs.getState().language).then(() => router.replace('/confirm')).catch((e) => setError(errorMessage(t, e)));
          }} />
          <Button kind="secondary" label={t('editBrief')} onPress={() => router.replace('/')} />
        </>
      ) : <Loading label={t('understanding')} />}
    </Screen>
  );
}
