import {
  BookOpen,
  Briefcase,
  Car,
  CircleDollarSign,
  Dumbbell,
  Film,
  Fuel,
  Gift,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  Plane,
  Receipt,
  RefreshCcw,
  Repeat,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  TrendingUp,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

// Apple system colours (light mode). Each category keeps one colour everywhere it appears.
const STYLES: Record<string, { color: string; icon: LucideIcon }> = {
  'Food & dining': { color: '#ff9500', icon: Utensils },
  Groceries: { color: '#34c759', icon: ShoppingBasket },
  Transport: { color: '#007aff', icon: Car },
  Fuel: { color: '#5856d6', icon: Fuel },
  Shopping: { color: '#ffcc00', icon: ShoppingBag },
  'Bills & utilities': { color: '#30b0c7', icon: Receipt },
  'Rent & housing': { color: '#a2845e', icon: Home },
  Health: { color: '#ff3b30', icon: HeartPulse },
  Fitness: { color: '#fa114f', icon: Dumbbell },
  Entertainment: { color: '#ff2d55', icon: Film },
  Travel: { color: '#af52de', icon: Plane },
  Education: { color: '#32ade6', icon: BookOpen },
  Subscriptions: { color: '#00c7be', icon: Repeat },
  'Personal care': { color: '#ff6482', icon: Sparkles },
  'Gifts & donations': { color: '#bf5af2', icon: Gift },
  'EMI & loans': { color: '#636366', icon: Landmark },
  Salary: { color: '#34c759', icon: Briefcase },
  Business: { color: '#30b0c7', icon: TrendingUp },
  Freelance: { color: '#5856d6', icon: Laptop },
  'Interest & dividends': { color: '#00c7be', icon: CircleDollarSign },
  Refund: { color: '#007aff', icon: RefreshCcw },
  Gift: { color: '#bf5af2', icon: Gift },
};

const FALLBACK = { color: '#8e8e93', icon: Wallet };

export function categoryStyle(category: string | null | undefined) {
  return (category && STYLES[category]) || FALLBACK;
}
