'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, type Page } from '@/lib/store';
import * as api from '@/lib/api';
import { NavBar } from '@/components/nav-bar';
import { Header } from '@/components/header';
import { HomeFeed } from '@/components/home-feed';
import { CollectionsView } from '@/components/collections-view';
import { MediaGallery } from '@/components/media-gallery';
import { SearchView } from '@/components/search-view';
import { DiscoveryView } from '@/components/discovery-view';
import { ProfileView } from '@/components/profile-view';
import { PostDetail } from '@/components/post-detail';
import { TwitterConnect } from '@/components/twitter-connect';
import { AlertCircle, RefreshCw } from 'lucide-react';

const pageComponents: Record<Page, React.ComponentType> = {
  home: HomeFeed,
  collections: CollectionsView,
  media: MediaGallery,
  search: SearchView,
  discover: DiscoveryView,
  profile: ProfileView,
};

export function AppShell() {
  const { user, setBookmarks, setCollections, setTags, selectedBookmark, isDetailOpen, currentPage } = useAppStore();
  const [isDataLoaded, setIsDataLoaded] = useState(() => !user?.xConnected);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const hasLoaded = useRef(false);

  const isTwitterConnected = user?.xConnected || false;

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setIsRetrying(true);
    setRetryCount((c) => c + 1);
  }, []);

  // Load all data on mount and on retry (only when Twitter is connected)
  useEffect(() => {
    if (!isTwitterConnected) {
      return;
    }

    if (retryCount === 0 && hasLoaded.current) return;
    hasLoaded.current = true;

    let cancelled = false;

    async function load() {
      try {
        const [bookmarksRes, collectionsRes, tagsRes] = await Promise.allSettled([
          api.bookmarks.list({ limit: '100' }),
          api.collections.list(),
          api.tags.list(),
        ]);
        if (!cancelled) {
          // Safely extract data from settled results
          const safeBookmarks = (res: PromiseSettledResult<any>) => {
            if (res.status !== 'fulfilled') return null;
            const data = res.value;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.bookmarks)) return data.bookmarks;
            if (Array.isArray(data?.data)) return data.data;
            return null;
          };

          const safeArray = (res: PromiseSettledResult<any>) => {
            if (res.status !== 'fulfilled') return null;
            const data = res.value;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.data)) return data.data;
            if (Array.isArray(data?.collections)) return data.collections;
            return null;
          };

          const bookmarksList = safeBookmarks(bookmarksRes);
          const collectionsList = safeArray(collectionsRes);
          const tagsList = safeArray(tagsRes);

          // Check if ALL three requests failed
          const allFailed = bookmarksList === null && collectionsList === null && tagsList === null;
          if (allFailed) {
            const failedReasons = [bookmarksRes, collectionsRes, tagsRes]
              .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
              .map((r) => r.reason?.message || 'Unknown error');
            setLoadError(failedReasons.join('; ') || 'All data requests failed');
            setIsDataLoaded(false);
          } else {
            setBookmarks(bookmarksList || []);
            setCollections(collectionsList || []);
            setTags(tagsList || []);
            setIsDataLoaded(true);
          }
        }
      } catch (err: any) {
        console.error('Failed to load data:', err);
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load data');
          setIsDataLoaded(false);
        }
      }
      if (!cancelled) {
        setIsRetrying(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isTwitterConnected, retryCount, setBookmarks, setCollections, setTags]);

  // If Twitter not connected, show connect screen
  if (!isTwitterConnected) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1">
          <TwitterConnect />
        </main>
      </div>
    );
  }

  const PageComponent = pageComponents[currentPage];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pb-20 md:pb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {loadError ? (
              <DataLoadError error={loadError} onRetry={handleRetry} isRetrying={isRetrying} />
            ) : isDataLoaded ? (
              <PageComponent />
            ) : (
              <LoadingSkeleton />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
      <NavBar />
      <AnimatePresence>
        {isDetailOpen && selectedBookmark && <PostDetail />}
      </AnimatePresence>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-3 overflow-hidden">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="shimmer rounded-xl h-8 w-24 flex-shrink-0" />
        ))}
      </div>
      <div className="masonry-grid">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="shimmer rounded-2xl" style={{ height: `${120 + Math.random() * 100}px` }} />
        ))}
      </div>
    </div>
  );
}

function DataLoadError({ error, onRetry, isRetrying }: { error: string; onRetry: () => void; isRetrying: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
        <AlertCircle className="w-8 h-8 text-red-400" />
      </div>
      <h3 className="text-lg font-semibold mb-1">Failed to load data</h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-1">
        We couldn&apos;t load your bookmarks, collections, or tags.
      </p>
      <p className="text-xs text-muted-foreground/60 max-w-xs mb-6">
        {error}
      </p>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/50 border border-border/50 text-sm font-medium hover:bg-secondary/70 transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
        {isRetrying ? 'Retrying...' : 'Retry'}
      </button>
    </div>
  );
}
