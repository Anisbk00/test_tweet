'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import * as api from '@/lib/api';
import { formatCount, parseJSON, getInitials, getAvatarColor } from '@/lib/utils';
import { Compass, Sparkles, TrendingUp, Zap, ArrowRight, Star, Hash } from 'lucide-react';
import { toast } from 'sonner';

interface Recommendation {
  id: string;
  reason: string;
  bookmark: any;
}

export function DiscoveryView() {
  const { bookmarks, tags, collections, setSelectedBookmark, setDetailOpen } = useAppStore();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDiscovery() {
      setIsLoading(true);
      try {
        const [recsRes, trendingRes] = await Promise.allSettled([
          api.discovery.recommendations(),
          api.discovery.trending(),
        ]);
        if (recsRes.status === 'fulfilled') {
          const recsData = recsRes.value as any;
          const recsList = recsData?.recommendations || recsData?.data || [];
          setRecommendations(Array.isArray(recsList) ? recsList : []);
        }
        if (trendingRes.status === 'fulfilled') {
          const trendingData = trendingRes.value as any;
          // Trending API returns { trendingTags, trendingTopics, trendingCreators }
          const trendingList = trendingData?.trendingTags || trendingData?.data || [];
          setTrending(Array.isArray(trendingList) ? trendingList : []);
        }
      } catch (err) {
        console.error('Failed to load discovery:', err);
      }
      setIsLoading(false);
    }
    loadDiscovery();
  }, []);

  // Generate heuristic recommendations based on user data
  const topAuthors = (() => {
    const authorMap: Record<string, { name: string; username: string; count: number; totalLikes: number }> = {};
    bookmarks.forEach((b) => {
      if (!b.xAuthorUsername) return;
      if (!authorMap[b.xAuthorUsername]) {
        authorMap[b.xAuthorUsername] = { name: b.xAuthorName || '', username: b.xAuthorUsername, count: 0, totalLikes: 0 };
      }
      authorMap[b.xAuthorUsername].count++;
      authorMap[b.xAuthorUsername].totalLikes += b.likeCount;
    });
    return Object.values(authorMap).sort((a, b) => b.count - a.count).slice(0, 5);
  })();

  const mediaBreakdown = (() => {
    let photos = 0, videos = 0, gifs = 0, text = 0;
    bookmarks.forEach((b) => {
      const types = parseJSON<string[]>(b.mediaTypes, []);
      if (types.includes('photo')) photos++;
      else if (types.includes('video')) videos++;
      else if (types.includes('gif')) gifs++;
      else text++;
    });
    return { photos, videos, gifs, text };
  })();

  return (
    <div className="max-w-4xl mx-auto p-4">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 flex items-center justify-center border border-amber-500/20">
            <Compass className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Discover</h1>
            <p className="text-sm text-muted-foreground">AI-powered insights from your archive</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer rounded-2xl h-40" />
          ))}
        </div>
      ) : (
        <>
          {/* AI Insights Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-5 rounded-2xl bg-gradient-to-br from-amber-500/10 via-card/80 to-orange-500/10 border border-amber-500/20"
          >
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h2 className="font-semibold text-sm text-amber-400">AI Insights</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-background/40">
                <p className="text-2xl font-bold">{bookmarks.length}</p>
                <p className="text-xs text-muted-foreground">Total Bookmarks</p>
              </div>
              <div className="p-3 rounded-xl bg-background/40">
                <p className="text-2xl font-bold">{topAuthors.length}</p>
                <p className="text-xs text-muted-foreground">Top Creators</p>
              </div>
              <div className="p-3 rounded-xl bg-background/40">
                <p className="text-2xl font-bold">{mediaBreakdown.photos + mediaBreakdown.videos}</p>
                <p className="text-xs text-muted-foreground">Media Posts</p>
              </div>
              <div className="p-3 rounded-xl bg-background/40">
                <p className="text-2xl font-bold">{tags.length}</p>
                <p className="text-xs text-muted-foreground">Tags Used</p>
              </div>
            </div>
          </motion.div>

          {/* Top Creators */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-4 h-4 text-amber-400" />
              <h2 className="font-semibold">Top Creators</h2>
            </div>
            <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2">
              {topAuthors.map((author, i) => (
                <motion.div
                  key={author.username}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex-shrink-0 w-32 text-center"
                >
                  <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${getAvatarColor(author.name)} flex items-center justify-center text-white font-bold text-lg mx-auto mb-2`}>
                    {getInitials(author.name)}
                  </div>
                  <p className="font-semibold text-xs truncate">{author.name}</p>
                  <p className="text-[10px] text-muted-foreground">@{author.username}</p>
                  <p className="text-[10px] text-amber-400 mt-0.5">{author.count} saved</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Trending Tags */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              <h2 className="font-semibold">Trending in Your Archive</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {tags
                .filter((t) => t._count && t._count.bookmarks > 0)
                .sort((a, b) => (b._count?.bookmarks || 0) - (a._count?.bookmarks || 0))
                .slice(0, 9)
                .map((tag, i) => (
                  <motion.div
                    key={tag.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="p-3 rounded-xl bg-card/50 border border-border/20 hover:border-border/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Hash className="w-3.5 h-3.5" style={{ color: tag.color || undefined }} />
                      <span className="font-medium text-sm" style={{ color: tag.color || undefined }}>{tag.name}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{tag._count?.bookmarks || 0} bookmarks</p>
                  </motion.div>
                ))}
            </div>
          </div>

          {/* Recommended for you */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-amber-400" />
              <h2 className="font-semibold">Recommended for You</h2>
            </div>
            <div className="space-y-2">
              {bookmarks
                .sort((a, b) => b.likeCount - a.likeCount)
                .slice(0, 5)
                .map((bookmark, i) => (
                  <motion.div
                    key={bookmark.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => {
                      setSelectedBookmark(bookmark);
                      setDetailOpen(true);
                    }}
                    className="flex items-center gap-3 p-3 rounded-xl bg-card/50 border border-border/20 hover:border-border/40 cursor-pointer transition-colors"
                  >
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarColor(bookmark.xAuthorName)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
                      {getInitials(bookmark.xAuthorName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-1">{bookmark.content}</p>
                      <p className="text-[10px] text-muted-foreground">@{bookmark.xAuthorUsername}</p>
                    </div>
                    <span className="text-[10px] text-amber-400 flex-shrink-0">♥ {formatCount(bookmark.likeCount)}</span>
                  </motion.div>
                ))}
            </div>
          </div>

          {/* Content Mix */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h2 className="font-semibold">Your Content Mix</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-card/50 border border-border/20">
                <p className="text-2xl font-bold text-blue-400">{mediaBreakdown.photos}</p>
                <p className="text-xs text-muted-foreground">Photos</p>
                <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-400"
                    style={{ width: `${bookmarks.length > 0 ? (mediaBreakdown.photos / bookmarks.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div className="p-4 rounded-xl bg-card/50 border border-border/20">
                <p className="text-2xl font-bold text-purple-400">{mediaBreakdown.videos}</p>
                <p className="text-xs text-muted-foreground">Videos</p>
                <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-400"
                    style={{ width: `${bookmarks.length > 0 ? (mediaBreakdown.videos / bookmarks.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div className="p-4 rounded-xl bg-card/50 border border-border/20">
                <p className="text-2xl font-bold text-pink-400">{mediaBreakdown.gifs}</p>
                <p className="text-xs text-muted-foreground">GIFs</p>
                <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-pink-400"
                    style={{ width: `${bookmarks.length > 0 ? (mediaBreakdown.gifs / bookmarks.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div className="p-4 rounded-xl bg-card/50 border border-border/20">
                <p className="text-2xl font-bold text-emerald-400">{mediaBreakdown.text}</p>
                <p className="text-xs text-muted-foreground">Text Only</p>
                <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400"
                    style={{ width: `${bookmarks.length > 0 ? (mediaBreakdown.text / bookmarks.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
