import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const collections = await db.collection.findMany({
      where: { userId: session.userId },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { bookmarks: true },
        },
        tags: {
          select: { id: true, name: true, color: true },
        },
      },
    });

    return NextResponse.json({
      collections: collections.map((c) => ({
        ...c,
        bookmarkCount: c._count.bookmarks,
        _count: undefined,
      })),
    });
  } catch (error) {
    console.error('Get collections error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, coverUrl, color, icon, isSmart, smartQuery } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Collection name is required' },
        { status: 400 }
      );
    }

    // Get the max sort order
    const maxSort = await db.collection.aggregate({
      where: { userId: session.userId },
      _max: { sortOrder: true },
    });

    const collection = await db.collection.create({
      data: {
        userId: session.userId,
        name,
        description: description || null,
        coverUrl: coverUrl || null,
        color: color || null,
        icon: icon || null,
        isSmart: isSmart || false,
        smartQuery: smartQuery || null,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
      },
    });

    // Log activity
    await db.activity.create({
      data: {
        userId: session.userId,
        type: 'collection_create',
        metadata: JSON.stringify({ collectionId: collection.id, name }),
      },
    });

    return NextResponse.json({ collection }, { status: 201 });
  } catch (error) {
    console.error('Create collection error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
