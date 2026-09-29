import { describe, expect, it } from 'vitest';
import { askPayload, askSystem } from '@/lib/ask/prompt';

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
