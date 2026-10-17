import 'server-only';

export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: Buffer;
};

/** A base64 string without its trailing `=` padding. */
function withoutPadding(value: string) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '=') end--;
  return value.slice(0, end);
}

export function getGmailConfig(): GmailConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  const encodedKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim();

  if (!clientId || !clientSecret || !redirectUri || !encodedKey) {
    throw new Error('Gmail connection is not configured. Check the server environment setup.');
  }

  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new Error('Gmail connection is not configured. Check the server environment setup.');
  }

  const isLocalhost = parsedRedirect.hostname === 'localhost' || parsedRedirect.hostname === '127.0.0.1';
  if ((parsedRedirect.protocol !== 'https:' && !(isLocalhost && parsedRedirect.protocol === 'http:')) || parsedRedirect.pathname !== '/auth/gmail/callback' || parsedRedirect.search || parsedRedirect.hash) {
    throw new Error('Gmail connection is not configured. Check the server environment setup.');
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) {
    throw new Error('Gmail connection is not configured. Check the server environment setup.');
  }

  const tokenEncryptionKey = Buffer.from(encodedKey, 'base64');
  const canonicalKey = withoutPadding(tokenEncryptionKey.toString('base64'));
  if (tokenEncryptionKey.length !== 32 || canonicalKey !== withoutPadding(encodedKey)) {
    throw new Error('Gmail connection is not configured. Check the server environment setup.');
  }

  return { clientId, clientSecret, redirectUri: parsedRedirect.toString(), tokenEncryptionKey };
}
