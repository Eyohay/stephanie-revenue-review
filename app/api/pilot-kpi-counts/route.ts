import { getPilotKpiCounts } from '@/lib/pipedrive/queries';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pilot-kpi-counts
 * Returns the three PipeDrive pilot-ending KPI counts (Pre-Launch excluded).
 * Called client-side by StatsSection after the page renders with Neon values.
 * Keeps PipeDrive out of the critical render path so tab switching is instant.
 */
export async function GET() {
  try {
    const counts = await getPilotKpiCounts(new Date());
    return NextResponse.json(counts, {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
    });
  } catch (err) {
    console.error('[/api/pilot-kpi-counts]', err);
    return NextResponse.json({ error: 'Failed to fetch PipeDrive counts' }, { status: 500 });
  }
}
