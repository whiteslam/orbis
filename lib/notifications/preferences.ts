// Notification preferences shared by the settings screen and its actions.
// Matches docs/superpowers/specs/2026-09-24-daily-notifications-design.md.

export const NOTIFICATION_SLOTS = [
  { id: 'morning', label: 'Morning', hint: 'Today at a glance and a workout nudge', defaultTime: '06:30' },
  { id: 'lunch', label: 'Lunch', hint: 'Afternoon plan, food and hydration', defaultTime: '14:00' },
  { id: 'evening', label: 'Evening', hint: 'Wrap-up: spending, habits, one suggestion', defaultTime: '19:00' },
  { id: 'night', label: 'Night', hint: 'Wind-down and a preview of tomorrow', defaultTime: '22:00' },
] as const;

export type SlotId = (typeof NOTIFICATION_SLOTS)[number]['id'];

export type NotificationPreferences = {
  enabled: boolean;
  timezone: string;
  slots: Record<SlotId, { enabled: boolean; time: string }>;
};

export type NotificationSettings = {
  state: 'ready' | 'setup' | 'unavailable';
  preferences: NotificationPreferences;
  deviceEndpoints: string[];
  pushConfigured: boolean;
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: false,
  timezone: 'Asia/Kolkata',
  slots: Object.fromEntries(NOTIFICATION_SLOTS.map((slot) => [slot.id, { enabled: true, time: slot.defaultTime }])) as NotificationPreferences['slots'],
};
