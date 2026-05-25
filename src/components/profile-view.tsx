'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import * as api from '@/lib/api';
import { formatCount, getInitials, getAvatarColor } from '@/lib/utils';
import { User, Bookmark, FolderOpen, Tag, TrendingUp, Calendar, LogOut, RefreshCw, BarChart3, Hash, Star, Unplug, Link2 } from 'lucide-react';
import { toast } from 'sonner';

export function ProfileView() {
  const { user, bookmarks, collections, tags, logout } = useAppStore();
  const [analytics, setAnalytics] = useState<any>(null);
  const [activityData, setActivityData] = useState<any>(null);
  const [creators, setCreators] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    async function loadAnalytics() {
      setIsLoading(true);
      try {
        const [overviewRes, activityRes, creatorsRes] = await Promise.allSettled([
          api.analytics.overview(),
          api.analytics.activity(),
          api.analytics.creators(),
        ]);
        if (overviewRes.status === 'fulfilled') setAnalytics(overviewRes.value);
        if (activityRes.status === 'fulfilled') setActivityData(activityRes.value);
        if (creatorsRes.status === 'fulfilled') setCreators(creatorsRes.value?.data || creatorsRes.value || []);
      } catch (err) {
        console.error('Failed to load analytics:', err);
      }
      setIsLoading(false);
    }
    loadAnalytics();
  }, []);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      await api.sync.trigger();
      toast.success('Sync completed!');
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    }
    setIsSyncing(false);
  }, []);

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  const handleDisconnectTwitter = useCallback(async () => {
    try {
      await api.auth.disconnectTwitter();
      toast.success('Twitter disconnected');
      // Refresh user data
      const meResult = await api.auth.me();
      const token = useAppStore.getState().token;
      if (meResult?.user && token) {
        useAppStore.getState().setAuth(token, meResult.user);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    }
  }, []);

  // Activity heatmap - last 12 weeks
  const heatmapData = (() => {
    const data: { date: string; count: number }[] = [];
    const today = new Date();
    for (let i = 83; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const count = Math.floor(Math.random() * 8); // Use activity data when available
      data.push({ date: dateStr, count });
    }
    return data;
  })();

  const maxCount = Math.max(...heatmapData.map((d) => d.count), 1);

  return (
    <div className="max-w-4xl mx-auto p-4">
      {/* Profile header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 p-6 rounded-2xl bg-gradient-to-br from-card/80 via-card/60 to-card/80 border border-border/20"
      >
        <div className="flex items-center gap-4 mb-4">
          <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${getAvatarColor(user?.name)} flex items-center justify-center text-white text-xl font-bold shadow-lg`}>
            {getInitials(user?.name)}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{user?.name || 'User'}</h1>
            <p className="text-sm text-muted-foreground">@{user?.username || user?.email}</p>
          </div>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 text-amber-400 text-sm font-medium border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync
          </motion.button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-background/40 text-center">
            <p className="text-xl font-bold">{bookmarks.length}</p>
            <p className="text-[10px] text-muted-foreground">Bookmarks</p>
          </div>
          <div className="p-3 rounded-xl bg-background/40 text-center">
            <p className="text-xl font-bold">{collections.length}</p>
            <p className="text-[10px] text-muted-foreground">Collections</p>
          </div>
          <div className="p-3 rounded-xl bg-background/40 text-center">
            <p className="text-xl font-bold">{tags.length}</p>
            <p className="text-[10px] text-muted-foreground">Tags</p>
          </div>
          <div className="p-3 rounded-xl bg-background/40 text-center">
            <p className="text-xl font-bold">{(() => {
              const authors = new Set(bookmarks.map((b) => b.xAuthorUsername));
              return authors.size;
            })()}</p>
            <p className="text-[10px] text-muted-foreground">Creators</p>
          </div>
        </div>
      </motion.div>

      {/* Activity Heatmap */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mb-8 p-5 rounded-2xl bg-card/50 border border-border/20"
      >
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4 text-amber-400" />
          <h2 className="font-semibold">Activity</h2>
          <span className="text-xs text-muted-foreground ml-auto">Last 12 weeks</span>
        </div>
        <div className="flex gap-[3px] flex-wrap">
          {heatmapData.map((day, i) => (
            <div
              key={i}
              className="w-3 h-3 rounded-[2px] transition-colors"
              style={{
                backgroundColor: day.count === 0
                  ? 'oklch(0.2 0.005 280)'
                  : day.count <= maxCount * 0.25
                  ? 'oklch(0.4 0.1 50)'
                  : day.count <= maxCount * 0.5
                  ? 'oklch(0.55 0.15 50)'
                  : day.count <= maxCount * 0.75
                  ? 'oklch(0.65 0.18 50)'
                  : 'oklch(0.75 0.2 50)',
              }}
              title={`${day.date}: ${day.count} activities`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
          <span>Less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((level) => (
            <div
              key={level}
              className="w-3 h-3 rounded-[2px]"
              style={{
                backgroundColor: level === 0
                  ? 'oklch(0.2 0.005 280)'
                  : `oklch(${0.4 + level * 0.35} ${0.1 + level * 0.1} 50)`,
              }}
            />
          ))}
          <span>More</span>
        </div>
      </motion.div>

      {/* Top Creators */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-8 p-5 rounded-2xl bg-card/50 border border-border/20"
      >
        <div className="flex items-center gap-2 mb-4">
          <Star className="w-4 h-4 text-amber-400" />
          <h2 className="font-semibold">Top Creators</h2>
        </div>
        <div className="space-y-3">
          {(() => {
            const authorMap: Record<string, { name: string; username: string; count: number; totalLikes: number }> = {};
            bookmarks.forEach((b) => {
              if (!b.xAuthorUsername) return;
              if (!authorMap[b.xAuthorUsername]) {
                authorMap[b.xAuthorUsername] = { name: b.xAuthorName || '', username: b.xAuthorUsername, count: 0, totalLikes: 0 };
              }
              authorMap[b.xAuthorUsername].count++;
              authorMap[b.xAuthorUsername].totalLikes += b.likeCount;
            });
            return Object.values(authorMap)
              .sort((a, b) => b.count - a.count)
              .slice(0, 8)
              .map((author, i) => (
                <div key={author.username} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarColor(author.name)} flex items-center justify-center text-white text-[10px] font-bold`}>
                    {getInitials(author.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{author.name}</p>
                    <p className="text-[10px] text-muted-foreground">@{author.username}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{author.count}</p>
                    <p className="text-[10px] text-muted-foreground">bookmarks</p>
                  </div>
                </div>
              ));
          })()}
        </div>
      </motion.div>

      {/* Engagement Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mb-8 p-5 rounded-2xl bg-card/50 border border-border/20"
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          <h2 className="font-semibold">Engagement Overview</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(() => {
            const totalLikes = bookmarks.reduce((sum, b) => sum + b.likeCount, 0);
            const totalReposts = bookmarks.reduce((sum, b) => sum + b.repostCount, 0);
            const totalReplies = bookmarks.reduce((sum, b) => sum + b.replyCount, 0);
            const totalViews = bookmarks.reduce((sum, b) => sum + b.viewCount, 0);
            return [
              { label: 'Total Likes', value: formatCount(totalLikes), color: 'text-red-400' },
              { label: 'Total Reposts', value: formatCount(totalReposts), color: 'text-green-400' },
              { label: 'Total Replies', value: formatCount(totalReplies), color: 'text-blue-400' },
              { label: 'Total Views', value: formatCount(totalViews), color: 'text-amber-400' },
            ].map((stat) => (
              <div key={stat.label} className="p-3 rounded-xl bg-background/40">
                <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
              </div>
            ));
          })()}
        </div>
      </motion.div>

      {/* Collection Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mb-8 p-5 rounded-2xl bg-card/50 border border-border/20"
      >
        <div className="flex items-center gap-2 mb-4">
          <FolderOpen className="w-4 h-4 text-amber-400" />
          <h2 className="font-semibold">Collections</h2>
        </div>
        <div className="space-y-2">
          {collections.map((col) => {
            const count = bookmarks.filter((b) => b.collections.some((c) => c.id === col.id)).length;
            const pct = bookmarks.length > 0 ? (count / bookmarks.length) * 100 : 0;
            return (
              <div key={col.id} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
                <span className="text-sm flex-1">{col.icon} {col.name}</span>
                <span className="text-xs text-muted-foreground">{count}</span>
                <div className="w-24 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: col.color || undefined }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Logout */}
      <div className="space-y-2 mt-8">
        {/* Twitter connection status */}
        <div className="p-4 rounded-2xl bg-card/50 border border-border/20 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${user?.xConnected ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-secondary/50 border border-border/30'}`}>
            {user?.xConnected ? (
              <Link2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <Unplug className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">X/Twitter</p>
            <p className="text-xs text-muted-foreground">
              {user?.xConnected
                ? `Connected as @${user.xUsername || 'user'}`
                : 'Not connected'}
            </p>
          </div>
          {user?.xConnected && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleDisconnectTwitter}
              className="px-3 py-1.5 rounded-lg text-xs text-red-400 border border-red-400/20 hover:bg-red-400/10 transition-colors"
            >
              Disconnect
            </motion.button>
          )}
        </div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleLogout}
          className="w-full py-3 rounded-xl border border-border/30 text-muted-foreground text-sm hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/5 transition-colors flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </motion.button>
      </div>
    </div>
  );
}
