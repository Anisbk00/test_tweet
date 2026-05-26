/**
 * X API v2 Client — Direct implementation in Next.js
 *
 * This eliminates the dependency on the Python service for the primary
 * data retrieval method. Works on Vercel serverless functions.
 *
 * Authentication methods:
 * 1. Bearer Token — App-only (search, tweet lookup)
 * 2. OAuth 1.0a — User context (following, followers, lists)
 * 3. OAuth 2.0 — User context (bookmarks, timeline) with PKCE flow
 *
 * When the Python Twikit service is available (TWIKIT_SERVICE_URL),
 * it serves as a fallback for when X API fails (rate limits, missing scopes).
 */

import crypto from 'crypto';

// ============================================================
// Configuration
// ============================================================

const X_API_BASE = 'https://api.twitter.com/2';
const X_UPLOAD_BASE = 'https://upload.twitter.com/1.1';

function getEnv(key: string): string {
  return process.env[key] || '';
}

export function getXApiConfig() {
  return {
    bearerToken: getEnv('X_API_BEARER_TOKEN'),
    consumerKey: getEnv('X_API_KEY'),
    consumerSecret: getEnv('X_API_KEY_SECRET'),
    accessToken: getEnv('X_ACCESS_TOKEN'),
    accessTokenSecret: getEnv('X_ACCESS_TOKEN_SECRET'),
    clientId: getEnv('X_CLIENT_ID'),
    clientSecret: getEnv('X_CLIENT_SECRET'),
    redirectUri: getEnv('X_OAUTH_REDIRECT_URI') || `${getEnv('NEXTAUTH_URL') || 'http://localhost:3000'}/api/auth/x/callback`,
  };
}

export function hasBearerToken(): boolean {
  return !!getEnv('X_API_BEARER_TOKEN');
}

export function hasOAuth1Credentials(): boolean {
  return !!getEnv('X_API_KEY') && !!getEnv('X_ACCESS_TOKEN') && !!getEnv('X_ACCESS_TOKEN_SECRET');
}

export function hasOAuth2Credentials(): boolean {
  return !!getEnv('X_CLIENT_ID') && !!getEnv('X_CLIENT_SECRET');
}

// ============================================================
// Types
// ============================================================

export interface XApiTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  conversation_id?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    bookmark_count: number;
    impression_count: number;
  };
  entities?: {
    urls?: Array<{ expanded_url?: string; media_key?: string }>;
    media?: Array<{ media_key: string }>;
  };
  attachments?: {
    media_keys?: string[];
  };
  referenced_tweets?: Array<{ type: string; id: string }>;
}

export interface XApiUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
}

export interface XApiMedia {
  media_key: string;
  type: 'photo' | 'video' | 'animated_gif';
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
  variants?: Array<{
    bit_rate?: number;
    content_type: string;
    url: string;
  }>;
}

export interface XApiList {
  id: string;
  name: string;
  description?: string;
  member_count?: number;
  follower_count?: number;
  private?: boolean;
  created_at?: string;
}

export interface XApiResponse<T> {
  data?: T;
  includes?: {
    users?: XApiUser[];
    media?: XApiMedia[];
    tweets?: XApiTweet[];
  };
  meta?: {
    result_count?: number;
    next_token?: string;
    previous_token?: string;
  };
  errors?: Array<{ message: string; code?: number }>;
  title?: string;
  detail?: string;
  type?: string;
}

// Standardized format matching the Python service output
export interface StandardPost {
  id: string;
  content: string;
  author: {
    id: string;
    name: string;
    username: string;
    avatar_url: string;
  };
  media: {
    url: string;
    type: string;
    preview_url: string;
  }[];
  metrics: {
    replies: number;
    reposts: number;
    likes: number;
    views: number;
    bookmarks: number;
  };
  posted_at: string | null;
  created_at: string;
  provider: 'x_api';
}

export interface StandardPaginatedResponse {
  data: StandardPost[];
  cursor: string | null;
  has_more: boolean;
  count: number;
  provider: 'x_api';
}

// ============================================================
// OAuth 1.0a Helpers
// ============================================================

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function generateOAuth1Header(
  method: string,
  url: string,
  params: Record<string, string> = {}
): string {
  const config = getXApiConfig();
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: config.accessToken,
    oauth_version: '1.0',
  };

  // Collect all parameters (OAuth + query)
  const allParams: Record<string, string> = { ...oauthParams, ...params };

  // Create parameter string (sorted)
  const paramStr = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  // Create base string
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramStr)}`;

  // Create signing key
  const signingKey = `${percentEncode(config.consumerSecret)}&${percentEncode(config.accessTokenSecret)}`;

  // Generate signature
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  // Build header
  const headerParams = {
    ...oauthParams,
    oauth_signature: signature,
  };

  return (
    'OAuth ' +
    Object.keys(headerParams)
      .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
      .join(', ')
  );
}

// ============================================================
// OAuth 2.0 PKCE Helpers
// ============================================================

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function sha256(str: string): Buffer {
  return crypto.createHash('sha256').update(str).digest();
}

export interface PKCEPair {
  code_verifier: string;
  code_challenge: string;
  state: string;
}

export function generatePKCEPair(): PKCEPair {
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(sha256(codeVerifier));
  const state = base64URLEncode(crypto.randomBytes(16));
  return { code_verifier: codeVerifier, code_challenge: codeChallenge, state };
}

export function getOAuth2AuthorizeUrl(
  pkce: PKCEPair,
  redirectUri?: string,
  scope?: string
): string {
  const config = getXApiConfig();
  const redirect = redirectUri || config.redirectUri;
  const scopes = scope || 'tweet.read users.read bookmark.read like.read list.read follows.read';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirect,
    scope: scopes,
    state: pkce.state,
    code_challenge: pkce.code_challenge,
    code_challenge_method: 'S256',
  });

  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

export interface OAuth2Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export async function exchangeOAuth2Code(
  code: string,
  codeVerifier: string,
  redirectUri?: string
): Promise<OAuth2Tokens> {
  const config = getXApiConfig();
  const redirect = redirectUri || config.redirectUri;

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: redirect,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OAuth2 token exchange failed: ${error}`);
  }

  return response.json();
}

export async function refreshOAuth2Token(refreshToken: string): Promise<OAuth2Tokens> {
  const config = getXApiConfig();

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: config.clientId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OAuth2 token refresh failed: ${error}`);
  }

  return response.json();
}

// ============================================================
// X API v2 Request Helpers
// ============================================================

class XApiError extends Error {
  status: number;
  code?: string;
  rateLimitReset?: number;

  constructor(message: string, status: number, code?: string, rateLimitReset?: number) {
    super(message);
    this.name = 'XApiError';
    this.status = status;
    this.code = code;
    this.rateLimitReset = rateLimitReset;
  }
}

async function bearerFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<XApiResponse<T>> {
  const config = getXApiConfig();
  const url = new URL(`${X_API_BASE}${endpoint}`);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.bearerToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 429) {
    const reset = response.headers.get('x-rate-limit-reset');
    throw new XApiError(
      'Rate limit exceeded',
      429,
      'rate_limit_exceeded',
      reset ? parseInt(reset) : undefined
    );
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new XApiError(
      `X API error: ${errorBody}`,
      response.status
    );
  }

  return response.json();
}

async function oauth1Fetch<T>(
  method: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<XApiResponse<T>> {
  const url = `${X_API_BASE}${endpoint}`;
  const authHeader = generateOAuth1Header(method, url, params);

  const fullUrl = new URL(url);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') fullUrl.searchParams.set(k, v);
  });

  const response = await fetch(fullUrl.toString(), {
    method,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 429) {
    const reset = response.headers.get('x-rate-limit-reset');
    throw new XApiError(
      'Rate limit exceeded',
      429,
      'rate_limit_exceeded',
      reset ? parseInt(reset) : undefined
    );
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new XApiError(
      `X API error: ${errorBody}`,
      response.status
    );
  }

  return response.json();
}

async function oauth2Fetch<T>(
  accessToken: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<XApiResponse<T>> {
  const url = new URL(`${X_API_BASE}${endpoint}`);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 429) {
    const reset = response.headers.get('x-rate-limit-reset');
    throw new XApiError(
      'Rate limit exceeded',
      429,
      'rate_limit_exceeded',
      reset ? parseInt(reset) : undefined
    );
  }

  if (response.status === 401) {
    throw new XApiError('OAuth2 token expired or invalid', 401, 'token_expired');
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new XApiError(
      `X API error: ${errorBody}`,
      response.status
    );
  }

  return response.json();
}

// ============================================================
// Transform X API v2 Response → StandardPost
// ============================================================

function transformTweetToStandardPost(
  tweet: XApiTweet,
  users: XApiUser[] = [],
  media: XApiMedia[] = []
): StandardPost {
  const author = users.find((u) => u.id === tweet.author_id);

  // Process media
  const tweetMedia: StandardPost['media'] = [];
  const mediaKeys = tweet.attachments?.media_keys || tweet.entities?.media?.map((m) => m.media_key) || [];

  for (const key of mediaKeys) {
    const m = media.find((x) => x.media_key === key);
    if (m) {
      let url = m.url || '';
      // For videos, use the highest bitrate variant
      if (m.type === 'video' && m.variants?.length) {
        const mp4Variants = m.variants
          .filter((v) => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
        if (mp4Variants.length > 0) {
          url = mp4Variants[0].url;
        }
      }
      tweetMedia.push({
        url,
        type: m.type,
        preview_url: m.preview_image_url || m.url || '',
      });
    }
  }

  return {
    id: tweet.id,
    content: tweet.text || '',
    author: {
      id: author?.id || tweet.author_id || '',
      name: author?.name || '',
      username: author?.username || '',
      avatar_url: author?.profile_image_url?.replace('_normal', '_bigger') || '',
    },
    media: tweetMedia,
    metrics: {
      replies: tweet.public_metrics?.reply_count || 0,
      reposts: tweet.public_metrics?.retweet_count || 0,
      likes: tweet.public_metrics?.like_count || 0,
      views: tweet.public_metrics?.impression_count || 0,
      bookmarks: tweet.public_metrics?.bookmark_count || 0,
    },
    posted_at: tweet.created_at || null,
    created_at: tweet.created_at || new Date().toISOString(),
    provider: 'x_api',
  };
}

// ============================================================
// Public API Methods
// ============================================================

/**
 * Get user's bookmarks using OAuth 2.0 access token.
 * Requires scope: bookmark.read
 */
export async function getBookmarks(
  accessToken: string,
  maxResults: number = 100,
  paginationToken?: string
): Promise<StandardPaginatedResponse> {
  const params: Record<string, string> = {
    'tweet.fields': 'created_at,author_id,public_metrics,entities,attachments,referenced_tweets,conversation_id',
    'user.fields': 'name,username,profile_image_url',
    'media.fields': 'media_key,type,url,preview_image_url,variants,alt_text',
    'expansions': 'author_id,attachments.media_keys',
    max_results: Math.min(maxResults, 1000).toString(),
  };

  if (paginationToken) {
    params.pagination_token = paginationToken;
  }

  const response = await oauth2Fetch<XApiTweet[]>(
    accessToken,
    '/users/:id/bookmarks', // This will be replaced with actual user ID
    params
  );

  // We need the actual user ID - get it from the token
  // Actually, we need to call with the correct path
  throw new Error('Use getBookmarksForUser instead');
}

/**
 * Get user's bookmarks using OAuth 2.0 access token with known user ID.
 * Requires scope: bookmark.read, users.read
 */
export async function getBookmarksForUser(
  accessToken: string,
  xUserId: string,
  maxResults: number = 100,
  paginationToken?: string
): Promise<StandardPaginatedResponse> {
  const params: Record<string, string> = {
    'tweet.fields': 'created_at,author_id,public_metrics,entities,attachments,referenced_tweets,conversation_id',
    'user.fields': 'name,username,profile_image_url',
    'media.fields': 'media_key,type,url,preview_image_url,variants,alt_text',
    'expansions': 'author_id,attachments.media_keys',
    max_results: Math.min(Math.max(maxResults, 5), 1000).toString(),
  };

  if (paginationToken) {
    params.pagination_token = paginationToken;
  }

  const response = await oauth2Fetch<XApiTweet[]>(
    accessToken,
    `/users/${xUserId}/bookmarks`,
    params
  );

  if (response.errors && !response.data) {
    throw new XApiError(
      response.errors[0].message || 'Failed to fetch bookmarks',
      400,
      response.errors[0].code?.toString()
    );
  }

  const tweets = response.data || [];
  const users = response.includes?.users || [];
  const media = response.includes?.media || [];

  return {
    data: tweets.map((t) => transformTweetToStandardPost(t, users, media)),
    cursor: response.meta?.next_token || null,
    has_more: !!response.meta?.next_token,
    count: tweets.length,
    provider: 'x_api',
  };
}

/**
 * Get user's timeline using OAuth 2.0 access token.
 * Requires scope: tweet.read, users.read
 */
export async function getTimeline(
  accessToken: string,
  xUserId: string,
  maxResults: number = 100,
  paginationToken?: string
): Promise<StandardPaginatedResponse> {
  const params: Record<string, string> = {
    'tweet.fields': 'created_at,author_id,public_metrics,entities,attachments,referenced_tweets,conversation_id',
    'user.fields': 'name,username,profile_image_url',
    'media.fields': 'media_key,type,url,preview_image_url,variants,alt_text',
    'expansions': 'author_id,attachments.media_keys',
    max_results: Math.min(Math.max(maxResults, 5), 100).toString(),
    exclude: 'retweets,replies',
  };

  if (paginationToken) {
    params.pagination_token = paginationToken;
  }

  const response = await oauth2Fetch<XApiTweet[]>(
    accessToken,
    `/users/${xUserId}/timelines/reverse_chronological`,
    params
  );

  if (response.errors && !response.data) {
    throw new XApiError(
      response.errors[0].message || 'Failed to fetch timeline',
      400,
      response.errors[0].code?.toString()
    );
  }

  const tweets = response.data || [];
  const users = response.includes?.users || [];
  const media = response.includes?.media || [];

  return {
    data: tweets.map((t) => transformTweetToStandardPost(t, users, media)),
    cursor: response.meta?.next_token || null,
    has_more: !!response.meta?.next_token,
    count: tweets.length,
    provider: 'x_api',
  };
}

/**
 * Get user's following list using OAuth 1.0a.
 */
export async function getFollowing(
  targetUserId: string,
  maxResults: number = 100,
  paginationToken?: string
): Promise<XApiResponse<XApiUser>> {
  const params: Record<string, string> = {
    'user.fields': 'name,username,profile_image_url,description,public_metrics',
    max_results: Math.min(maxResults, 1000).toString(),
  };

  if (paginationToken) {
    params.pagination_token = paginationToken;
  }

  return oauth1Fetch<XApiUser>('GET', `/users/${targetUserId}/following`, params);
}

/**
 * Get user's followers using OAuth 1.0a.
 */
export async function getFollowers(
  targetUserId: string,
  maxResults: number = 100,
  paginationToken?: string
): Promise<XApiResponse<XApiUser>> {
  const params: Record<string, string> = {
    'user.fields': 'name,username,profile_image_url,description,public_metrics',
    max_results: Math.min(maxResults, 1000).toString(),
  };

  if (paginationToken) {
    params.pagination_token = paginationToken;
  }

  return oauth1Fetch<XApiUser>('GET', `/users/${targetUserId}/followers`, params);
}

/**
 * Get user's lists using OAuth 1.0a.
 */
export async function getUserLists(
  userId: string,
  maxResults: number = 100,
  paginationToken?: string
): Promise<XApiResponse<XApiList>> {
  const params: Record<string, string> = {
    'list.fields': 'name,description,member_count,follower_count,private,created_at',
    max_results: Math.min(maxResults, 100).toString(),
  };

  if (paginationToken) {
    params.pagination_token = paginationToken;
  }

  return oauth1Fetch<XApiList>('GET', `/users/${userId}/owned_lists`, params);
}

/**
 * Get tweets from a list using OAuth 1.0a.
 */
export async function getListTweets(
  listId: string,
  maxResults: number = 100,
  paginationToken?: string
): Promise<StandardPaginatedResponse> {
  const params: Record<string, string> = {
    'tweet.fields': 'created_at,author_id,public_metrics,entities,attachments,referenced_tweets,conversation_id',
    'user.fields': 'name,username,profile_image_url',
    'media.fields': 'media_key,type,url,preview_image_url,variants,alt_text',
    'expansions': 'author_id,attachments.media_keys',
    max_results: Math.min(Math.max(maxResults, 5), 100).toString(),
  };

  if (paginationToken) {
    params.pagination_token = paginationToken;
  }

  const response = await oauth1Fetch<XApiTweet[]>(
    'GET',
    `/lists/${listId}/tweets`,
    params
  );

  const tweets = response.data || [];
  const users = response.includes?.users || [];
  const media = response.includes?.media || [];

  return {
    data: tweets.map((t) => transformTweetToStandardPost(t, users, media)),
    cursor: response.meta?.next_token || null,
    has_more: !!response.meta?.next_token,
    count: tweets.length,
    provider: 'x_api',
  };
}

/**
 * Search tweets using Bearer Token (app-only).
 */
export async function searchTweets(
  query: string,
  maxResults: number = 50,
  nextToken?: string
): Promise<StandardPaginatedResponse> {
  const params: Record<string, string> = {
    query,
    'tweet.fields': 'created_at,author_id,public_metrics,entities,attachments,referenced_tweets,conversation_id',
    'user.fields': 'name,username,profile_image_url',
    'media.fields': 'media_key,type,url,preview_image_url,variants,alt_text',
    'expansions': 'author_id,attachments.media_keys',
    max_results: Math.min(Math.max(maxResults, 10), 100).toString(),
  };

  if (nextToken) {
    params.next_token = nextToken;
  }

  const response = await bearerFetch<XApiTweet[]>('/tweets/search/recent', params);

  const tweets = response.data || [];
  const users = response.includes?.users || [];
  const media = response.includes?.media || [];

  return {
    data: tweets.map((t) => transformTweetToStandardPost(t, users, media)),
    cursor: response.meta?.next_token || null,
    has_more: !!response.meta?.next_token,
    count: tweets.length,
    provider: 'x_api',
  };
}

/**
 * Get a specific tweet by ID using Bearer Token.
 */
export async function getTweet(tweetId: string): Promise<StandardPost | null> {
  const params: Record<string, string> = {
    'tweet.fields': 'created_at,author_id,public_metrics,entities,attachments,referenced_tweets,conversation_id',
    'user.fields': 'name,username,profile_image_url',
    'media.fields': 'media_key,type,url,preview_image_url,variants,alt_text',
    'expansions': 'author_id,attachments.media_keys',
  };

  const response = await bearerFetch<XApiTweet>(`/tweets/${tweetId}`, params);

  if (!response.data) return null;

  return transformTweetToStandardPost(
    response.data,
    response.includes?.users || [],
    response.includes?.media || []
  );
}

/**
 * Get the authenticated user's info using OAuth 2.0 access token.
 */
export async function getMe(accessToken: string): Promise<XApiUser | null> {
  const response = await oauth2Fetch<XApiUser>(accessToken, '/users/me', {
    'user.fields': 'name,username,profile_image_url,description,public_metrics',
  });

  return response.data || null;
}

/**
 * Get a user by username using Bearer Token.
 */
export async function getUserByUsername(username: string): Promise<XApiUser | null> {
  const response = await bearerFetch<XApiUser>(`/users/by/username/${username}`, {
    'user.fields': 'name,username,profile_image_url,description,public_metrics',
  });

  return response.data || null;
}

export { XApiError };
