import type { ConfigContext, ExpoConfig } from 'expo/config';

// Everything that differs between your builds comes from environment variables
// (app/.env for local runs, `eas env` for EAS builds). app.json holds the defaults.
// See app/.env.example for the full list.

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;
const flag = (name: string, fallback: boolean): boolean => {
  const v = env(name)?.toLowerCase();
  return v ? !['0', 'false', 'no', 'off'].includes(v) : fallback;
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const scheme = env('APP_SCHEME') ?? (config.scheme as string | undefined) ?? 'urjersey';
  // Plain http is only for talking to a dev server on your own network. Turn it off for store builds.
  const allowHttp = flag('APP_ALLOW_HTTP', true);
  const projectId = env('EAS_PROJECT_ID');
  return {
    ...config,
    name: env('APP_NAME') ?? config.name ?? 'UrJersey',
    slug: env('APP_SLUG') ?? config.slug ?? 'urjersey',
    scheme,
    version: env('APP_VERSION') ?? config.version,
    owner: env('EXPO_OWNER') ?? config.owner,
    ios: {
      ...config.ios,
      bundleIdentifier: env('IOS_BUNDLE_ID') ?? config.ios?.bundleIdentifier,
      infoPlist: { ...config.ios?.infoPlist, NSAppTransportSecurity: { NSAllowsLocalNetworking: allowHttp } },
    },
    android: {
      ...config.android,
      package: env('ANDROID_PACKAGE') ?? config.android?.package,
      // Kept from app.json; not in the config type.
      ...({ usesCleartextTraffic: allowHttp } as object),
      intentFilters: [{ action: 'VIEW', data: [{ scheme }], category: ['BROWSABLE', 'DEFAULT'] }],
    },
    extra: {
      ...config.extra,
      apiUrl: env('EXPO_PUBLIC_API_URL') ?? config.extra?.apiUrl ?? null,
      ...(projectId ? { eas: { projectId } } : {}),
    },
    ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
  };
};
