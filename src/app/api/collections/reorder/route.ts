import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orders } = body as { orders: { id: string; sortOrder: number }[] };

    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json(
        { error: 'orders array is required' },
        { status: 400 }
      );
    }

    // Update all collection sort orders in a transaction
    await db.$transaction(
      orders.map((item) =>
        db.collection.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    return NextResponse.json({ message: 'Collections reordered' });
  } catch (error) {
    console.error('Reorder collections error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
