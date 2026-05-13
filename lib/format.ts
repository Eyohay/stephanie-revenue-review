export function formatUSD(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatUSDPrecise(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** "in 3 days" / "3 days ago" / "today" — future-positive */
export function relativeDays(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const diffMs = date.getTime() - Date.now();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  const ago = Math.abs(days);
  return `${ago} day${ago === 1 ? '' : 's'} ago`;
}

/** "3 days ago" / "in 2 days" / "today" — past-positive (matches active-clients-billing) */
export function daysAgo(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 0) {
    const future = Math.abs(days);
    if (future === 1) return 'in 1 day';
    return `in ${future} days`;
  }
  return `${days} days ago`;
}

/** Full calendar months between a past date and now (floor) */
export function monthsApart(past: Date | string, now: Date): number {
  const p = typeof past === 'string' ? new Date(past) : past;
  return (
    (now.getFullYear() - p.getFullYear()) * 12 +
    (now.getMonth() - p.getMonth())
  );
}

// Eastern-time anchored "current month" name. Used for the auto-rolling Tab 2
// heading and forecast tile labels so the dashboard rolls over at midnight ET.
export function currentMonthNameET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'America/New_York' }).format(now);
}
export function currentMonthShortET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'America/New_York' }).format(now);
}
