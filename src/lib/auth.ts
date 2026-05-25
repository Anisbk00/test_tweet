import { db } from '@/lib/db';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'bookmarkvault-secret-key';

interface TokenPayload {
  userId: string;
  sessionId: string;
  exp: number;
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

export function generateToken(userId: string, sessionId: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      userId,
      sessionId,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    })
  );
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;

    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    if (signature !== expectedSignature) return null;

    const decoded = JSON.parse(base64UrlDecode(payload)) as TokenPayload;

    if (decoded.exp < Date.now()) return null;

    return decoded;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
    .toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  const computedHash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
    .toString('hex');
  return hash === computedHash;
}

export async function getSession(request: NextRequest): Promise<{
  userId: string;
  sessionId: string;
} | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload) return null;

  // Verify session exists in database
  const session = await db.session.findUnique({
    where: { id: payload.sessionId },
  });

  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) return null;

  return { userId: payload.userId, sessionId: payload.sessionId };
}

export async function getCurrentUser(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return null;

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      avatarUrl: true,
      xUserId: true,
      xUsername: true,
      xConnected: true,
      xAuthMethod: true,
      xOAuth2ExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
}
