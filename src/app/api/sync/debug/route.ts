import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { normalizeCookies, validateCookiesDetailed } from '@/lib/x-cookie-api';

/**
 * GET /api/sync/debug
 *
 * Debug endpoint that makes a raw X GraphQL API request with the user's
 * stored cookies and returns the full raw response for diagnostics.
 * This helps identify exactly what X's API is returning.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        xConnected: true,
        xCookies: true,
        xUserId: true,
      },
    });

    if (!user?.xCookies) {
      return NextResponse.json({ error: 'No cookies stored. Please connect your X account first.' }, { status: 400 });
    }

    let cookies: { auth_token: string; ct0: string; twid?: string };
    try {
      cookies = JSON.parse(user.xCookies);
    } catch {
      return NextResponse.json({ error: 'Failed to parse stored cookies.' }, { status: 400 });
    }

    if (!cookies.auth_token || !cookies.ct0) {
      return NextResponse.json({ error: 'Missing auth_token or ct0 in stored cookies.' }, { status: 400 });
    }

    const normalized = normalizeCookies({
      auth_token: cookies.auth_token,
      ct0: cookies.ct0,
      twid: cookies.twid || undefined,
    });

    // Step 1: Validate cookies
    const validationResult = await validateCookiesDetailed(normalized);

    // Step 2: Make raw X GraphQL API request
    const FALLBACK_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
    const queryIds = [
      { id: 'ojgFx9G-r0OkXCFVN9k5oA', name: 'Bookmarks' },
      { id: '6u3VcFdASPZrP2wkuU3C3A', name: 'Bookmarks (alt)' },
      { id: 'fHKoSa-2dbV1UbhUy3EvcA', name: 'BookmarkSearchTimeline' },
      { id: '5kB8iO1n19yXfcxM4e30Nw', name: 'BookmarkSearchTimeline (alt)' },
    ];

    const BOOKMARKS_FEATURES = {
      rweb_video_screen_enabled: false,
      rweb_cashtags_enabled: true,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: false,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      premium_content_api_read_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_grok_analyze_button_fetch_trends_enabled: false,
      responsive_web_grok_analyze_post_followups_enabled: false,
      responsive_web_jetfuel_frame: true,
      responsive_web_grok_share_attachment_enabled: true,
      responsive_web_grok_annotations_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      content_disclosure_indicator_enabled: true,
      content_disclosure_ai_generated_indicator_enabled: true,
      responsive_web_grok_show_grok_translated_post: true,
      responsive_web_grok_analysis_button_from_backend: true,
      post_ctas_fetch_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: false,
      responsive_web_grok_image_annotation_enabled: true,
      responsive_web_grok_imagine_annotation_enabled: true,
      responsive_web_grok_community_note_auto_translation_is_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    };

    // Build cookie string
    let cookieStr = `auth_token=${normalized.auth_token}; ct0=${normalized.ct0}`;
    if (normalized.twid) {
      cookieStr += `; twid=${encodeURIComponent(normalized.twid)}`;
    }

    const results: Array<{
      queryId: string;
      operationName: string;
      status: number;
      response: any;
      error?: string;
      timeMs: number;
    }> = [];

    // Test each query ID
    for (const qid of queryIds.slice(0, 2)) { // Only test Bookmarks endpoint to save time
      const isSearch = qid.name.includes('Search');
      const operationName = isSearch ? 'BookmarkSearchTimeline' : 'Bookmarks';
      const variables = isSearch
        ? { rawQuery: '', count: 5 }
        : { count: 5 };

      const url = new URL(`https://x.com/i/api/graphql/${qid.id}/${operationName}`);
      url.searchParams.set('variables', JSON.stringify(variables));
      url.searchParams.set('features', JSON.stringify(BOOKMARKS_FEATURES));

      const start = Date.now();
      try {
        const response = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${FALLBACK_BEARER}`,
            'Cookie': cookieStr,
            'X-CSRF-TOKEN': normalized.ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
            'X-Twitter-Client-Language': 'en',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Origin': 'https://x.com',
            'Referer': 'https://x.com/',
          },
          signal: AbortSignal.timeout(15000),
        });

        const timeMs = Date.now() - start;
        const responseText = await response.text();
        let responseJson: any;
        try {
          responseJson = JSON.parse(responseText);
        } catch {
          responseJson = { _raw: responseText.substring(0, 1000) };
        }

        results.push({
          queryId: qid.id,
          operationName,
          status: response.status,
          response: responseJson,
          timeMs,
        });
      } catch (error) {
        results.push({
          queryId: qid.id,
          operationName,
          status: 0,
          response: null,
          error: error instanceof Error ? error.message : String(error),
          timeMs: Date.now() - start,
        });
      }
    }

    return NextResponse.json({
      cookieValidation: {
        valid: validationResult.valid,
        user: validationResult.user,
        error: validationResult.error,
        details: validationResult.details,
      },
      rawApiResponses: results,
      debugInfo: {
        auth_token_length: normalized.auth_token.length,
        ct0_length: normalized.ct0.length,
        twid_provided: !!normalized.twid,
        twid_preview: normalized.twid ? normalized.twid.substring(0, 20) + '...' : null,
        xUserId: user.xUserId,
      },
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
