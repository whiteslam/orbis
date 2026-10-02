import { describe, expect, it } from 'vitest';
import { askPayload, askSystem } from '@/lib/ask/prompt';
import { readAbout } from '@/lib/ask/about';

describe('askSystem', () => {
  it('keeps the typed answer format', () => {
    const system = askSystem();
    expect(system).toMatch(/under 120 words/);
    expect(system).not.toMatch(/spoken/i);
  });

  it('asks for a short spoken answer in the speaker’s language', () => {
    const system = askSystem({ spokenLanguage: 'Tamil' });
    expect(system).toMatch(/Reply in Tamil/);
    expect(system).toMatch(/spoken aloud/);
    expect(system).toMatch(/under 60 words/);
    expect(system).not.toMatch(/under 120 words/);
  });
});

describe('askPayload', () => {
  it('sends earlier turns only when there are some', () => {
    expect(JSON.parse(askPayload('How much?', { a: 1 }))).toEqual({ question: 'How much?', data: { a: 1 } });
    const withHistory = JSON.parse(askPayload('And last week?', { a: 1 }, [{ question: 'Spend today?', answer: '₹400' }]));
    expect(withHistory.earlier).toEqual([{ question: 'Spend today?', answer: '₹400' }]);
  });
});

describe('asking about something Orbis showed', () => {
  const about = { kind: 'news' as const, title: 'Oil jumps on Gulf tension', detail: 'Fuel costs may rise.', url: 'https://example.com/oil' };

  it('widens the rules only when there is an item, and never to buy or sell advice', () => {
    expect(askSystem()).not.toMatch(/"about"/);
    const system = askSystem({ about });
    expect(system).toMatch(/"about"/);
    expect(system).toMatch(/never tell them to buy, sell or hold/);
  });

  it('sends the item with the question', () => {
    expect(JSON.parse(askPayload('What does this mean for me?', {}, [], about)).about).toEqual(about);
  });

  it('accepts only a well-formed item from the browser', () => {
    expect(readAbout(about)).toEqual(about);
    expect(readAbout({ ...about, kind: 'mail' })).toBeNull();
    expect(readAbout({ ...about, title: '' })).toBeNull();
    expect(readAbout({ ...about, url: 'javascript:alert(1)' })).toEqual({ kind: 'news', title: about.title, detail: about.detail });
  });
});
