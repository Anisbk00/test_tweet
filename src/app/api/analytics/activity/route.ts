import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;

    // Get activity for the last 365 days for heatmap
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);

    const activities = await db.activity.findMany({
      where: {
        userId,
        createdAt: { gte: oneYearAgo },
      },
      select: { createdAt: true, type: true },
    });

    // Group by date
    const heatmapData: Record<string, number> = {};
    for (const activity of activities) {
      const dateKey = activity.createdAt.toISOString().split('T')[0];
      heatmapData[dateKey] = (heatmapData[dateKey] || 0) + 1;
    }

    // Convert to array format
    const heatmap = Object.entries(heatmapData).map(([date, count]) => ({
      date,
      count,
    }));

    // Activity by type
    const activityByType: Record<string, number> = {};
    for (const activity of activities) {
      activityByType[activity.type] = (activityByType[activity.type] || 0) + 1;
    }

    // Streak calculation
    const today = new Date();
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let checkDate = new Date(today);

    for (let i = 0; i < 365; i++) {
      const dateKey = checkDate.toISOString().split('T')[0];
      if (heatmapData[dateKey] && heatmapData[dateKey] > 0) {
        tempStreak++;
        if (i === currentStreak) {
          currentStreak++;
        }
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }

    return NextResponse.json({
      heatmap,
      activityByType,
      currentStreak,
      longestStreak,
      totalActivities: activities.length,
    });
  } catch (error) {
    console.error('Analytics activity error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
