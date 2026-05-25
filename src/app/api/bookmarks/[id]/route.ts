import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const bookmark = await db.bookmark.findUnique({
      where: { id },
      include: {
        collections: {
          select: { id: true, name: true, color: true, icon: true },
        },
        tags: {
          select: { id: true, name: true, color: true },
        },
      },
    });

    if (!bookmark || bookmark.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Bookmark not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ bookmark });
  } catch (error) {
    console.error('Get bookmark error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
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
    const { addCollectionIds, removeCollectionIds, addTagIds, removeTagIds, aiSummary } = body;

    const bookmark = await db.bookmark.findUnique({
      where: { id },
    });

    if (!bookmark || bookmark.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Bookmark not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (addCollectionIds || removeCollectionIds) {
      updateData.collections = {
        connect: addCollectionIds?.map((cid: string) => ({ id: cid })) || [],
        disconnect: removeCollectionIds?.map((cid: string) => ({ id: cid })) || [],
      };
    }

    if (addTagIds || removeTagIds) {
      updateData.tags = {
        connect: addTagIds?.map((tid: string) => ({ id: tid })) || [],
        disconnect: removeTagIds?.map((tid: string) => ({ id: tid })) || [],
      };
    }

    if (aiSummary !== undefined) {
      updateData.aiSummary = aiSummary;
    }

    const updated = await db.bookmark.update({
      where: { id },
      data: updateData,
      include: {
        collections: { select: { id: true, name: true, color: true } },
        tags: { select: { id: true, name: true, color: true } },
      },
    });

    // Log activity
    await db.activity.create({
      data: {
        userId: session.userId,
        type: 'bookmark_update',
        metadata: JSON.stringify({ bookmarkId: id }),
      },
    });

    return NextResponse.json({ bookmark: updated });
  } catch (error) {
    console.error('Update bookmark error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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

    const bookmark = await db.bookmark.findUnique({
      where: { id },
    });

    if (!bookmark || bookmark.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Bookmark not found' },
        { status: 404 }
      );
    }

    // Soft delete - mark as not bookmarked
    await db.bookmark.update({
      where: { id },
      data: { isBookmarked: false },
    });

    // Log activity
    await db.activity.create({
      data: {
        userId: session.userId,
        type: 'bookmark_delete',
        metadata: JSON.stringify({ bookmarkId: id }),
      },
    });

    return NextResponse.json({ message: 'Bookmark removed' });
  } catch (error) {
    console.error('Delete bookmark error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
