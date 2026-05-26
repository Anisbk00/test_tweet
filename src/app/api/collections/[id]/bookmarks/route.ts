import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// POST /api/collections/[id]/bookmarks - Add bookmarks to collection
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { bookmarkIds } = body;

    if (!bookmarkIds || !Array.isArray(bookmarkIds)) {
      return NextResponse.json(
        { error: 'bookmarkIds array is required' },
        { status: 400 }
      );
    }

    const collection = await db.collection.findUnique({
      where: { id },
    });

    if (!collection || collection.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      );
    }

    await db.collection.update({
      where: { id },
      data: {
        bookmarks: {
          connect: bookmarkIds.map((bid: string) => ({ id: bid })),
        },
      },
    });

    return NextResponse.json({
      message: 'Bookmarks added to collection',
      count: bookmarkIds.length,
    });
  } catch (error) {
    console.error('Add bookmarks to collection error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/collections/[id]/bookmarks - Remove bookmarks from collection
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const bookmarkIdsParam = searchParams.get('bookmarkIds');

    if (!bookmarkIdsParam) {
      return NextResponse.json(
        { error: 'bookmarkIds query parameter is required' },
        { status: 400 }
      );
    }

    const bookmarkIds = bookmarkIdsParam.split(',');

    const collection = await db.collection.findUnique({
      where: { id },
    });

    if (!collection || collection.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      );
    }

    await db.collection.update({
      where: { id },
      data: {
        bookmarks: {
          disconnect: bookmarkIds.map((bid: string) => ({ id: bid })),
        },
      },
    });

    return NextResponse.json({
      message: 'Bookmarks removed from collection',
      count: bookmarkIds.length,
    });
  } catch (error) {
    console.error('Remove bookmarks from collection error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
