import type { ConfigContext, ExpoConfig } from 'expo/config';
import { AndroidConfig, withAndroidManifest } from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';

// Everything that differs between your builds comes from environment variables
// (app/.env for local runs, `eas env` for EAS builds). app.json holds the defaults.
// See app/.env.example for the full list.

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;
const flag = (name: string, fallback: boolean): boolean => {
  const v = env(name)?.toLowerCase();
  return v ? !['0', 'false', 'no', 'off'].includes(v) : fallback;
};

const withAndroidCleartextTraffic: ConfigPlugin<{ enabled: boolean }> = (config, { enabled }) =>
  withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$['android:usesCleartextTraffic'] = enabled ? 'true' : 'false';
    return modConfig;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  const scheme = env('APP_SCHEME') ?? (config.scheme as string | undefined) ?? 'unsattai';
  // Plain http is only for talking to a dev server on your own network. Turn it off for store builds.
  const allowHttp = flag('APP_ALLOW_HTTP', true);
  const projectId = env('EAS_PROJECT_ID');
  const nextConfig: ExpoConfig = {
    ...config,
    name: env('APP_NAME') ?? config.name ?? 'Unsattai',
    slug: env('APP_SLUG') ?? config.slug ?? 'unsattai',
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
      intentFilters: [{ action: 'VIEW', data: [{ scheme }], category: ['BROWSABLE', 'DEFAULT'] }],
    },
    extra: {
      ...config.extra,
      apiUrl: env('EXPO_PUBLIC_API_URL') ?? config.extra?.apiUrl ?? null,
      ...(projectId ? { eas: { projectId } } : {}),
    },
    ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
  };
  return withAndroidCleartextTraffic(nextConfig, { enabled: allowHttp }) as ExpoConfig;
};
