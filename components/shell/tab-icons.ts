import { BookOpen, Briefcase, HeartPulse, Home, Megaphone, WalletCards, type LucideIcon } from 'lucide-react';
import type { TabId } from '@/lib/shell/tabs';

/** Each tab's icon, shared by the bottom nav, the desktop rail and the Career panel's rail. */
export const TAB_ICONS: Record<TabId, LucideIcon> = { today: Home, money: WalletCards, health: HeartPulse, journal: BookOpen, social: Megaphone, career: Briefcase };
