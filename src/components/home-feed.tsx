'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import { PostCard } from '@/components/post-card';
import { TrendingTag } from '@/components/trending-tag';
import { RefreshCw, SlidersHorizontal, LayoutGrid, List } from 'lucide-react';
import * as api from '@/lib/api';
import { toast } from 'sonner';

type SortOption = 'savedAt' | 'postedAt' | 'likeCount';
type ViewMode = 'masonry' | 'list';

export function HomeFeed() {
  const { bookmarks, setBookmarks, collections } = useAppStore();
  const [sortBy, setSortBy] = useState<SortOption>('savedAt');
  const [viewMode, setViewMode] = useState<ViewMode>('masonry');
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<HTMLDivElement>(null);

  const filteredBookmarks = bookmarks
    .filter((b) => {
      if (!selectedCollection) return true;
      return Array.isArray(b.collections) && b.collections.some((c) => c.id === selectedCollection);
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'likeCount':
          return b.likeCount - a.likeCount;
        case 'postedAt':
          return new Date(b.postedAt || 0).getTime() - new Date(a.postedAt || 0).getTime();
        case 'savedAt':
        default:
          return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
      }
    });

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const result = await api.sync.trigger();
      // Safely reload bookmarks
      try {
        const res = await api.bookmarks.list({ limit: '100' });
        const bookmarksList = res?.bookmarks || res?.data || [];
        setBookmarks(Array.isArray(bookmarksList) ? bookmarksList : []);
      } catch (reloadErr) {
        console.warn('Failed to reload bookmarks after sync:', reloadErr);
      }
      if (result?.success || result?.syncedCount > 0) {
        toast.success(`Synced ${result.syncedCount || 0} bookmarks`);
      } else if (result?.syncedCount === 0) {
        toast.info('No new bookmarks to sync');
      } else {
        toast.error('Sync completed with issues');
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
      // If sync is stuck (409), try resetting and retrying once
      if (err.message?.includes('Sync already in progress')) {
        try {
          toast.info('Resetting stuck sync lock...');
          await api.sync.reset();
          const result = await api.sync.trigger();
          try {
            const res = await api.bookmarks.list({ limit: '100' });
            const bookmarksList = res?.bookmarks || res?.data || [];
            setBookmarks(Array.isArray(bookmarksList) ? bookmarksList : []);
          } catch (reloadErr) {
            console.warn('Failed to reload bookmarks after retry:', reloadErr);
          }
          if (result?.success || result?.syncedCount > 0) {
            toast.success(`Synced ${result.syncedCount || 0} bookmarks`);
          } else {
            toast.info('No new bookmarks to sync');
          }
        } catch (retryErr: any) {
          toast.error(retryErr.message || 'Sync retry failed');
        }
      } else {
        toast.error(err.message || 'Sync failed. Make sure Twitter is connected.');
      }
    }
    setIsSyncing(false);
  }, [setBookmarks]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.5 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore]);

  const displayedBookmarks = filteredBookmarks.slice(0, page * 20);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Filter bar */}
      <div className="sticky top-14 z-40 glass border-b border-border/30">
        <div className="px-4 py-3 flex items-center gap-3">
          {/* Collection pills */}
          <div className="flex-1 flex items-center gap-2 overflow-x-auto hide-scrollbar">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setSelectedCollection(null)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                !selectedCollection
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-secondary/50 text-muted-foreground border border-border/50 hover:text-foreground'
              }`}
            >
              All
            </motion.button>
            {collections.map((col) => (
              <motion.button
                key={col.id}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedCollection(col.id === selectedCollection ? null : col.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedCollection === col.id
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-secondary/50 text-muted-foreground border border-border/50 hover:text-foreground'
                }`}
              >
                {col.icon} {col.name}
              </motion.button>
            ))}
          </div>

          {/* View & sort controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleSync}
              disabled={isSyncing}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setViewMode(viewMode === 'masonry' ? 'list' : 'masonry')}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              {viewMode === 'masonry' ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </motion.button>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-secondary/50 border border-border/50 rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            >
              <option value="savedAt">Recently Saved</option>
              <option value="postedAt">Recently Posted</option>
              <option value="likeCount">Most Liked</option>
            </select>
          </div>
        </div>
      </div>

      {/* Trending tags */}
      <TrendingTag />

      {/* Feed */}
      <div className="p-4">
        {filteredBookmarks.length === 0 ? (
          <EmptyState onSync={handleSync} isSyncing={isSyncing} hasEverSynced={bookmarks.length > 0} />
        ) : viewMode === 'masonry' ? (
          <div className="masonry-grid">
            {displayedBookmarks.map((bookmark, i) => (
              <motion.div
                key={bookmark.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.3 }}
              >
                <PostCard bookmark={bookmark} />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="space-y-3 max-w-2xl mx-auto">
            {displayedBookmarks.map((bookmark, i) => (
              <motion.div
                key={bookmark.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.2 }}
              >
                <PostCard bookmark={bookmark} variant="list" />
              </motion.div>
            ))}
          </div>
        )}

        {/* Infinite scroll trigger */}
        <div ref={observerRef} className="h-10" />
      </div>
    </div>
  );
}

function EmptyState({ onSync, isSyncing, hasEverSynced }: { onSync: () => void; isSyncing: boolean; hasEverSynced: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mb-4">
        <LayoutGrid className="w-8 h-8 text-muted-foreground" />
      </div>
      {hasEverSynced ? (
        <>
          <h3 className="text-lg font-semibold mb-1">No matching bookmarks</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            Try changing your filters or sync to get the latest bookmarks.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-lg font-semibold mb-1">No bookmarks yet</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            Sync your X/Twitter bookmarks to start organizing and discovering your saved content.
          </p>
        </>
      )}
      <button
        onClick={onSync}
        disabled={isSyncing}
        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 text-sm font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
        {isSyncing ? 'Syncing...' : 'Sync Bookmarks'}
      </button>
    </div>
  );
}
