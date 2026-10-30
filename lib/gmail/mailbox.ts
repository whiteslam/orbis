/**
 * The one reading of a From (or To) header's address that every parser here
 * shares. Pure and client-safe.
 *
 * A header is written by whoever sent the mail, and RFC 5322 lets it carry
 * comments, "( … )" (nested), and quoted display names, either of which can
 * hold a "<x@y>" of its own. The mailbox the provider authenticated is the
 * angle-addr outside them, so they are read past: `a@evil.example (<hr@acme.com>)`
 * is a@evil.example, and so is `"Acme <hr@acme.com>" <a@evil.example>`.
 */

/**
 * The bare address in a header, lowercased: the one non-empty `<…>` outside
 * comments and quoted strings, else the whole value with its comments taken
 * out. An empty `<>` is skipped, as if it were not there.
 *
 * Null when the header is ambiguous: more than one `<…>`, an unquoted `@`
 * outside it (a decoded display name such as `HR <hr@acme.com> <a@evil.example>`),
 * or a comment or quoted string left open, which would otherwise swallow the
 * real address (`hr@acme.com ( <a@evil.example>`).
 * Which address the provider authenticated can't be told, so no sender is
 * trusted.
 */
export function mailboxOf(header: string): string | null {
  let bare = '';
  let angle: string | null = null;
  let current: string | null = null;
  let depth = 0;
  let quoted = false;
  let ambiguous = false;
  let phraseAt = false;
  const put = (text: string) => {
    if (current === null) bare += text;
    else current += text;
  };
  for (let i = 0; i < header.length; i += 1) {
    const char = header[i];
    if (depth > 0) {
      if (char === '\\') i += 1;
      else if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      continue;
    }
    if (quoted) {
      put(char);
      if (char === '\\' && i + 1 < header.length) put(header[(i += 1)]);
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '(') depth = 1;
    else if (char === '"') {
      quoted = true;
      put(char);
    } else if (current !== null && char === '>') {
      if (current.trim()) {
        if (angle !== null) ambiguous = true;
        angle = current;
      }
      current = null;
    } else if (char === '<') {
      if (current !== null) ambiguous = true;
      current = '';
    } else {
      if (current === null && char === '@') phraseAt = true;
      put(char);
    }
  }
  // An unclosed "<" still says where the address starts.
  if (current?.trim()) {
    if (angle !== null) ambiguous = true;
    angle = current;
  }
  if (ambiguous || depth > 0 || quoted || (angle !== null && phraseAt)) return null;
  return (angle ?? bare).trim().toLowerCase();
}
