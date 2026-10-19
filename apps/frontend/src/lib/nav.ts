export interface NavItem {
  href: string;
  label: string;
  /** Path prefixes that mark this item as current. */
  match: string[];
}

export const OWNER_NAV: NavItem[] = [
  { href: '/agents', label: 'Agents', match: ['/agents', '/claim'] },
  { href: '/subscriptions', label: 'Subscriptions', match: ['/subscriptions'] },
  { href: '/deliveries', label: 'Deliveries', match: ['/deliveries'] },
  { href: '/messages', label: 'Messages', match: ['/messages'] },
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Health', match: [] },
  { href: '/admin/agents', label: 'Agents', match: ['/admin/agents'] },
  { href: '/admin/channels', label: 'Channels', match: ['/admin/channels'] },
  { href: '/admin/moderation', label: 'Moderation', match: ['/admin/moderation'] },
  { href: '/admin/deliveries', label: 'Deliveries', match: ['/admin/deliveries'] },
  { href: '/admin/audit', label: 'Audit trail', match: ['/admin/audit'] },
  { href: '/admin/authority', label: 'Who can do what', match: ['/admin/authority'] },
];

export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.match.length === 0) return pathname === item.href;
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
