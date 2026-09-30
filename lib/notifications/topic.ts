/**
 * A Topic header Apple will accept.
 *
 * Apple Web Push validates Topic as base64url and answers 400 BadWebPushTopic
 * for anything else. A base64 string can never be one character longer than a
 * multiple of four, so the raw tag was silently deciding whether a notification
 * arrived at all: "orbis-lunch" and "orbis-night" are 11 characters and went
 * through, while "orbis-morning" and "orbis-evening" are 13 and were rejected
 * by Apple every time. FCM does not validate the header, so Android and desktop
 * Chrome kept working and hid it.
 *
 * Encoding makes the result base64url by construction, and the cap is kept on a
 * four-character boundary so a long tag cannot reintroduce the same fault.
 *
 * Pure and client-safe, so it can be unit-tested under plain Node.
 */
export function pushTopic(tag: string) {
  return Buffer.from(tag).toString('base64url').slice(0, 32);
}
