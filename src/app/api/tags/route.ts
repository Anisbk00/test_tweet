import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tags = await db.tag.findMany({
      where: { userId: session.userId },
      include: {
        _count: {
          select: { bookmarks: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      tags: tags.map((t) => ({
        ...t,
        bookmarkCount: t._count.bookmarks,
        _count: undefined,
      })),
    });
  } catch (error) {
    console.error('Get tags error:', error);
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
    const { name, color } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Tag name is required' },
        { status: 400 }
      );
    }

    // Check if tag already exists for this user
    const existing = await db.tag.findUnique({
      where: {
        userId_name: {
          userId: session.userId,
          name,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Tag already exists', tag: existing },
        { status: 409 }
      );
    }

    const tag = await db.tag.create({
      data: {
        userId: session.userId,
        name,
        color: color || null,
      },
    });

    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    console.error('Create tag error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
