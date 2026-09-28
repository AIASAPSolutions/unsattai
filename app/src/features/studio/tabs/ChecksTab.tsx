import { View } from 'react-native';
import { SIZES, type Check, type Size } from '../../../api/types';
import { ChecksList, PrintNotes } from '../../../components/ChecksList';
import { useT } from '../../../i18n';
import { Banner } from '../../../ui/Banner';
import { Card } from '../../../ui/Card';
import { Chip } from '../../../ui/Chip';
import { Loading } from '../../../ui/States';
import { T } from '../../../ui/Text';
import { space } from '../../../ui/theme';

/** Shows the server's checks for the current spec only; while a re-check runs nothing is shown as passing. */
export function ChecksTab({ checks, ready, fresh, sizes, onSizes }: {
  checks: Check[] | null; ready: boolean | null; fresh: boolean; sizes: Size[]; onSizes: (s: Size[]) => void;
}) {
  const t = useT();
  const toggle = (s: Size) => onSizes(sizes.includes(s) ? sizes.filter((x) => x !== s) : SIZES.filter((x) => x === s || sizes.includes(x)));
  return (
    <View>
      <Card title={t('checksTitle')}>
        {!fresh || !checks ? <Loading label={t('checking')} /> : (
          <>
            <Banner tone={ready ? 'pass' : 'fail'} text={ready ? t('checksReady') : t('checksBlocked')} testID="checks-summary" />
            <ChecksList checks={checks} />
          </>
        )}
      </Card>
      <Card title={t('checkSizes')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {SIZES.map((s) => <Chip key={s} testID={`check-size-${s}`} label={s} selected={sizes.includes(s)} onPress={() => toggle(s)} />)}
        </View>
        <T variant="caption" style={{ marginTop: space(1) }}>{t('checkSizesHint')}</T>
      </Card>
      <Card title={t('printNotes')}>
        <PrintNotes />
      </Card>
    </View>
  );
}
