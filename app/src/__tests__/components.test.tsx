import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChecksList, sortChecks, summarize } from '../components/ChecksList';
import { ChecksTab } from '../features/studio/tabs/ChecksTab';
import { Banner } from '../ui/Banner';
import { ErrorState, Loading } from '../ui/States';
import type { Check } from '../api/types';

const checks: Check[] = [
  { id: 'a', level: 'pass', message: 'Panels OK' },
  { id: 'b', level: 'fail', message: 'Logo crosses a seam' },
  { id: 'c', level: 'warn', message: 'Low resolution' },
];

describe('state components', () => {
  it('shows a loading label', async () => {
    await render(<Loading label="Loading…" testID="l" />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows an error with a working retry', async () => {
    const retry = jest.fn();
    await render(<ErrorState message="Can't reach the server" retryLabel="Try again" onRetry={retry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });

  it('banner action fires', async () => {
    const act = jest.fn();
    await render(<Banner tone="warn" text="Offline" action="Retry" onAction={act} />);
    await fireEvent.press(screen.getByText('Retry'));
    expect(act).toHaveBeenCalled();
  });
});

describe('manufacturing checks', () => {
  it('lists failures first and never adds a pass', async () => {
    expect(sortChecks(checks).map((c) => c.level)).toEqual(['fail', 'warn', 'pass']);
    expect(summarize(checks)).toEqual({ fail: 1, warn: 1, info: 0, pass: 1 });
    await render(<ChecksList checks={checks} compact />);
    expect(screen.queryByText('Panels OK')).toBeNull();
    expect(screen.getByText('Logo crosses a seam')).toBeTruthy();
  });

  it('shows nothing as ready while the current design is still being checked', async () => {
    await render(<ChecksTab checks={checks} ready={true} fresh={false} sizes={['M']} onSizes={() => {}} />);
    expect(screen.queryByText('Ready for production')).toBeNull();
    expect(screen.getByText('Checking the design…')).toBeTruthy();
  });

  it('reports blocked when the server says not ready', async () => {
    await render(<ChecksTab checks={checks} ready={false} fresh sizes={['M']} onSizes={() => {}} />);
    expect(screen.getByText('Fix the failed checks before ordering')).toBeTruthy();
  });
});
