import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

// POST /api/tags/[id]/bookmarks - Add tag to bookmarks
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

    const tag = await db.tag.findUnique({
      where: { id },
    });

    if (!tag || tag.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Tag not found' },
        { status: 404 }
      );
    }

    await db.tag.update({
      where: { id },
      data: {
        bookmarks: {
          connect: bookmarkIds.map((bid: string) => ({ id: bid })),
        },
      },
    });

    return NextResponse.json({
      message: 'Tag added to bookmarks',
      count: bookmarkIds.length,
    });
  } catch (error) {
    console.error('Add tag to bookmarks error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
