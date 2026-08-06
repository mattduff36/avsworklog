import {
  Boxes,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Gauge,
  LayoutDashboard,
  PackageSearch,
  Quote,
  ShieldCheck,
  Truck,
  UserRound,
  UsersRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleName } from '@/types/roles';

export interface DemoRouteDefinition {
  href: string;
  label: string;
  shortLabel: string;
  family: 'Overview' | 'Workforce' | 'Operations' | 'Commercial' | 'Account';
  module: ModuleName | null;
  accent: string;
  icon: LucideIcon;
  navigation: boolean;
}

export const DEMO_ROUTES: DemoRouteDefinition[] = [
  {
    href: '/demo',
    label: 'Design review map',
    shortLabel: 'Demo map',
    family: 'Overview',
    module: null,
    accent: 'yellow',
    icon: LayoutDashboard,
    navigation: false,
  },
  {
    href: '/demo/dashboard',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    family: 'Overview',
    module: null,
    accent: 'yellow',
    icon: Gauge,
    navigation: true,
  },
  {
    href: '/demo/timesheets',
    label: 'Timesheets',
    shortLabel: 'Timesheets',
    family: 'Workforce',
    module: 'timesheets',
    accent: 'blue',
    icon: CalendarDays,
    navigation: true,
  },
  {
    href: '/demo/timesheets/[id]',
    label: 'Timesheet detail',
    shortLabel: 'Timesheet',
    family: 'Workforce',
    module: 'timesheets',
    accent: 'blue',
    icon: FileText,
    navigation: false,
  },
  {
    href: '/demo/approvals',
    label: 'Approvals',
    shortLabel: 'Approvals',
    family: 'Workforce',
    module: 'approvals',
    accent: 'amber',
    icon: ShieldCheck,
    navigation: true,
  },
  {
    href: '/demo/van-inspections/new',
    label: 'New van inspection',
    shortLabel: 'Inspection',
    family: 'Operations',
    module: 'inspections',
    accent: 'orange',
    icon: ClipboardCheck,
    navigation: true,
  },
  {
    href: '/demo/absence',
    label: 'Absence',
    shortLabel: 'Absence',
    family: 'Workforce',
    module: 'absence',
    accent: 'violet',
    icon: CalendarDays,
    navigation: true,
  },
  {
    href: '/demo/fleet',
    label: 'Fleet',
    shortLabel: 'Fleet',
    family: 'Operations',
    module: 'admin-vans',
    accent: 'cyan',
    icon: Truck,
    navigation: true,
  },
  {
    href: '/demo/workshop-tasks',
    label: 'Workshop tasks',
    shortLabel: 'Workshop',
    family: 'Operations',
    module: 'workshop-tasks',
    accent: 'rust',
    icon: Wrench,
    navigation: true,
  },
  {
    href: '/demo/inventory',
    label: 'Inventory',
    shortLabel: 'Inventory',
    family: 'Operations',
    module: 'inventory',
    accent: 'indigo',
    icon: PackageSearch,
    navigation: true,
  },
  {
    href: '/demo/quotes',
    label: 'Quotes',
    shortLabel: 'Quotes',
    family: 'Commercial',
    module: 'quotes',
    accent: 'yellow',
    icon: Quote,
    navigation: true,
  },
  {
    href: '/demo/customers',
    label: 'Customers',
    shortLabel: 'Customers',
    family: 'Commercial',
    module: 'customers',
    accent: 'yellow',
    icon: UsersRound,
    navigation: true,
  },
  {
    href: '/demo/profile',
    label: 'Profile',
    shortLabel: 'Profile',
    family: 'Account',
    module: null,
    accent: 'yellow',
    icon: UserRound,
    navigation: true,
  },
  {
    href: '/demo/login',
    label: 'Login',
    shortLabel: 'Login',
    family: 'Account',
    module: null,
    accent: 'yellow',
    icon: Boxes,
    navigation: false,
  },
];

export const DEMO_NAV_ROUTES = DEMO_ROUTES.filter((route) => route.navigation);

export function getDemoRoute(pathname: string): DemoRouteDefinition | null {
  if (pathname.startsWith('/demo/timesheets/') && pathname !== '/demo/timesheets') {
    return DEMO_ROUTES.find((route) => route.href === '/demo/timesheets/[id]') || null;
  }

  return DEMO_ROUTES.find((route) => route.href === pathname) || null;
}
