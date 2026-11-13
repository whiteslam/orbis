const FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i;

/**
 * The Digital Asset Links statements for /.well-known/assetlinks.json.
 * `handle_all_urls` lets the Android app open Orbis links; `get_login_creds`
 * lets passkeys work inside its WebView. Empty until the app id and every
 * signing-certificate fingerprint are set and well formed, so a typo never
 * publishes a half-trusted statement.
 */
export function assetLinks(appId: string | undefined, fingerprints: string | undefined): object[] {
  const packageName = appId?.trim();
  if (!packageName || !fingerprints) return [];
  const list = fingerprints.split(',').map((value) => value.trim());
  if (list.length === 0 || !list.every((value) => FINGERPRINT.test(value))) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: list.map((value) => value.toUpperCase()),
      },
    },
  ];
}
