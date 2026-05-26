'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import { parseJSON, parseMediaUrls, formatCount, getMediaDisplayUrl } from '@/lib/utils';
import { Image as ImageIcon, Film, FileImage, Grid3X3, Play } from 'lucide-react';

type MediaFilter = 'all' | 'photo' | 'video' | 'gif';

export function MediaGallery() {
  const { bookmarks, setSelectedBookmark, setDetailOpen } = useAppStore();
  const [filter, setFilter] = useState<MediaFilter>('all');

  const mediaBookmarks = useMemo(() => {
    return bookmarks.filter((b) => {
      const types = parseJSON<string[]>(b.mediaTypes, []);
      const urls = parseMediaUrls(b.mediaUrls);
      if (urls.length === 0) return false;
      if (filter === 'all') return true;
      return types.includes(filter);
    });
  }, [bookmarks, filter]);

  const mediaItems = useMemo(() => {
    return mediaBookmarks.flatMap((b) => {
      const urls = parseMediaUrls(b.mediaUrls);
      const types = parseJSON<string[]>(b.mediaTypes, []);
      const previewUrls = parseMediaUrls(b.previewUrls || '[]');
      return urls.map((url, i) => ({
        url,
        previewUrl: previewUrls[i],
        type: types[i] || 'photo',
        bookmark: b,
      }));
    });
  }, [mediaBookmarks]);

  const counts = useMemo(() => {
    const all = bookmarks.filter((b) => parseMediaUrls(b.mediaUrls).length > 0);
    return {
      all: all.length,
      photo: all.filter((b) => parseJSON<string[]>(b.mediaTypes, []).includes('photo')).length,
      video: all.filter((b) => parseJSON<string[]>(b.mediaTypes, []).includes('video')).length,
      gif: all.filter((b) => parseJSON<string[]>(b.mediaTypes, []).includes('gif')).length,
    };
  }, [bookmarks]);

  const handleItemClick = (bookmarkId: string) => {
    const b = bookmarks.find((bk) => bk.id === bookmarkId);
    if (b) {
      setSelectedBookmark(b);
      setDetailOpen(true);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Media Gallery</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mediaItems.length} media items
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto hide-scrollbar">
        {[
          { key: 'all' as MediaFilter, icon: Grid3X3, label: 'All', count: counts.all },
          { key: 'photo' as MediaFilter, icon: ImageIcon, label: 'Photos', count: counts.photo },
          { key: 'video' as MediaFilter, icon: Film, label: 'Videos', count: counts.video },
          { key: 'gif' as MediaFilter, icon: FileImage, label: 'GIFs', count: counts.gif },
        ].map((tab) => (
          <motion.button
            key={tab.key}
            whileTap={{ scale: 0.95 }}
            onClick={() => setFilter(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              filter === tab.key
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-secondary/30 text-muted-foreground border border-border/30 hover:text-foreground'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            <span className="text-[10px] opacity-60">({tab.count})</span>
          </motion.button>
        ))}
      </div>

      {/* Media Grid - Instagram style */}
      {mediaItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ImageIcon className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <h3 className="text-lg font-semibold mb-1">No media yet</h3>
          <p className="text-sm text-muted-foreground">Bookmarks with images and videos will appear here.</p>
        </div>
      ) : (
        <div className="media-grid">
          {mediaItems.map((item, i) => (
            <motion.div
              key={`${item.url}-${i}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.02, 0.5) }}
              whileHover={{ zIndex: 10 }}
              onClick={() => handleItemClick(item.bookmark.id)}
              className="group relative aspect-square overflow-hidden cursor-pointer bg-secondary/30"
            >
              {item.type === 'video' || item.type === 'gif' ? (
                <img
                  src={getMediaDisplayUrl(item.url, item.previewUrl, item.type)}
                  alt="Bookmark media"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                  loading="lazy"
                />
              ) : (
                <img
                  src={item.url}
                  alt="Bookmark media"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                  loading="lazy"
                />
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-200 flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white text-sm flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    ♥ {formatCount(item.bookmark.likeCount)}
                  </span>
                  <span className="flex items-center gap-1">
                    ↻ {formatCount(item.bookmark.repostCount)}
                  </span>
                </div>
              </div>

              {/* Type badge */}
              {item.type !== 'photo' && (
                <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm">
                  {item.type === 'video' ? (
                    <Play className="w-3 h-3 text-white fill-white" />
                  ) : (
                    <span className="text-[8px] text-white font-bold uppercase">GIF</span>
                  )}
                </div>
              )}

              {/* Multiple media indicator */}
              {(() => {
                const urls = parseMediaUrls(item.bookmark.mediaUrls);
                return urls.length > 1 ? (
                  <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm">
                    <span className="text-[8px] text-white font-medium">1/{urls.length}</span>
                  </div>
                ) : null;
              })()}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
