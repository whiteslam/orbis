/**
 * Career: reading RSS items by scanning, for the feeds (We Work Remotely,
 * Jobspresso). Pure. No XML parser and no backtracking regexes: a feed is
 * cut at its <item> tags with indexOf.
 */
import { decodeEntities } from '../text.ts';

/** The inner XML of every <item> in the feed. */
export function rssItems(xml: string): string[] {
  const items: string[] = [];
  let at = 0;
  while (at < xml.length) {
    const open = xml.indexOf('<item', at);
    if (open === -1) break;
    const bodyStart = xml.indexOf('>', open);
    const close = bodyStart === -1 ? -1 : xml.indexOf('</item>', bodyStart);
    if (close === -1) break;
    // "<items>" or "<item_x>" isn't an item.
    const next = xml[open + 5];
    if (next === '>' || next === ' ' || next === '\n' || next === '\t' || next === '\r') items.push(xml.slice(bodyStart + 1, close));
    at = close + 7;
  }
  return items;
}

/** CDATA sections unwrapped; plain XML text decoded once. */
function xmlText(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed.includes('<![CDATA[')) return decodeEntities(trimmed);
  let out = '';
  let at = 0;
  while (at < trimmed.length) {
    const start = trimmed.indexOf('<![CDATA[', at);
    if (start === -1) {
      out += decodeEntities(trimmed.slice(at));
      break;
    }
    out += decodeEntities(trimmed.slice(at, start));
    const end = trimmed.indexOf(']]>', start + 9);
    if (end === -1) {
      out += trimmed.slice(start + 9);
      break;
    }
    out += trimmed.slice(start + 9, end);
    at = end + 3;
  }
  return out.trim();
}

/**
 * The text of the first <tag> in an item (namespaced tags like
 * "job_listing:company" work), or null when it's missing. HTML inside stays
 * HTML for the caller to turn into text.
 */
export function rssField(item: string, tag: string): string | null {
  let at = 0;
  while (at < item.length) {
    const open = item.indexOf(`<${tag}`, at);
    if (open === -1) return null;
    const after = item[open + tag.length + 1];
    const tagEnd = item.indexOf('>', open);
    if (tagEnd === -1) return null;
    if (after === '>' || after === ' ' || after === '/') {
      if (item[tagEnd - 1] === '/') return '';
      const close = item.indexOf(`</${tag}>`, tagEnd);
      return close === -1 ? null : xmlText(item.slice(tagEnd + 1, close));
    }
    at = tagEnd + 1;
  }
  return null;
}
