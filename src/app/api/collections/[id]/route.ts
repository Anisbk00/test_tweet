import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

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
    const { name, description, coverUrl, color, icon, sortOrder } = body;

    const collection = await db.collection.findUnique({
      where: { id },
    });

    if (!collection || collection.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      );
    }

    const updated = await db.collection.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(coverUrl !== undefined && { coverUrl }),
        ...(color !== undefined && { color }),
        ...(icon !== undefined && { icon }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    return NextResponse.json({ collection: updated });
  } catch (error) {
    console.error('Update collection error:', error);
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

    const collection = await db.collection.findUnique({
      where: { id },
    });

    if (!collection || collection.userId !== session.userId) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      );
    }

    await db.collection.delete({
      where: { id },
    });

    // Log activity
    await db.activity.create({
      data: {
        userId: session.userId,
        type: 'collection_delete',
        metadata: JSON.stringify({ collectionId: id, name: collection.name }),
      },
    });

    return NextResponse.json({ message: 'Collection deleted' });
  } catch (error) {
    console.error('Delete collection error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
