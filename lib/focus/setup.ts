/**
 * The first things worth setting up, for Today's checklist. Pure: each step
 * is shown only while it is undone, and says which Settings section does it.
 */
import type { SettingsSection } from '@/lib/shell/tabs';

export type SetupStep = { id: 'ai' | 'google' | 'day' | 'name'; label: string; section: SettingsSection };

export function setupSteps(input: { aiOn: boolean; googleConnected: boolean; routineCount: number; hasName: boolean }): SetupStep[] {
  const steps: Array<SetupStep & { done: boolean }> = [
    { id: 'name', label: 'Tell Orbis your name', section: 'you', done: input.hasName },
    { id: 'ai', label: 'Turn on AI for the brief and Ask Orbis', section: 'ai', done: input.aiOn },
    { id: 'google', label: 'Connect Google for mail and calendar', section: 'connections', done: input.googleConnected },
    { id: 'day', label: 'Set the times your day already has', section: 'day', done: input.routineCount > 0 },
  ];
  return steps.filter((step) => !step.done).map((step) => ({ id: step.id, label: step.label, section: step.section }));
}
