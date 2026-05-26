'use client';

import { useEffect, useState, useRef } from 'react';
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
  const hasLoaded = useRef(false);

  const isTwitterConnected = user?.xConnected || false;

  // Load all data on mount (only when Twitter is connected)
  useEffect(() => {
    if (!isTwitterConnected) {
      return;
    }

    if (hasLoaded.current) return;
    hasLoaded.current = true;

    let cancelled = false;
    async function load() {
      try {
        const [bookmarksRes, collectionsRes, tagsRes] = await Promise.allSettled([
          api.bookmarks.list('limit=100'),
          api.collections.list(),
          api.tags.list(),
        ]);
        if (!cancelled) {
          // Safely extract data from settled results
          const safeBookmarks = (res: PromiseSettledResult<any>) => {
            if (res.status !== 'fulfilled') return [];
            const data = res.value;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.bookmarks)) return data.bookmarks;
            if (Array.isArray(data?.data)) return data.data;
            return [];
          };

          const safeArray = (res: PromiseSettledResult<any>) => {
            if (res.status !== 'fulfilled') return [];
            const data = res.value;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.data)) return data.data;
            if (Array.isArray(data?.collections)) return data.collections;
            return [];
          };

          const bookmarksList = safeBookmarks(bookmarksRes);
          const collectionsList = safeArray(collectionsRes);
          const tagsList = safeArray(tagsRes);

          setBookmarks(bookmarksList);
          setCollections(collectionsList);
          setTags(tagsList);
          setIsDataLoaded(true);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
        if (!cancelled) {
          // Still mark as loaded to prevent infinite loading
          setIsDataLoaded(true);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isTwitterConnected, setBookmarks, setCollections, setTags]);

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
            {isDataLoaded ? <PageComponent /> : <LoadingSkeleton />}
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
