'use client';

import { motion } from 'framer-motion';
import { useAppStore, type Bookmark as BookmarkType } from '@/lib/store';
import { formatCount, formatDate, parseJSON, getInitials, getAvatarColor } from '@/lib/utils';
import { X, Heart, MessageCircle, Repeat2, Eye, Bookmark, Share, ExternalLink, Play, Calendar, Tag } from 'lucide-react';

export function PostDetail() {
  const { selectedBookmark, setDetailOpen, setSelectedBookmark } = useAppStore();

  if (!selectedBookmark) return null;

  const bookmark = selectedBookmark;
  const mediaUrls = parseJSON<string[]>(bookmark.mediaUrls, []);
  const mediaTypes = parseJSON<string[]>(bookmark.mediaTypes, []);

  const handleClose = () => {
    setDetailOpen(false);
    setTimeout(() => setSelectedBookmark(null), 200);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Content */}
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[90vh] sm:rounded-3xl rounded-t-3xl bg-card border border-border/30 overflow-hidden flex flex-col"
      >
        {/* Handle bar for mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/30">
          <h3 className="font-semibold text-sm">Post Detail</h3>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </motion.button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Author */}
          <div className="px-5 pt-4 pb-3 flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${getAvatarColor(bookmark.xAuthorName)} flex items-center justify-center text-white font-bold`}>
              {getInitials(bookmark.xAuthorName)}
            </div>
            <div className="flex-1">
              <div className="font-bold">{bookmark.xAuthorName}</div>
              <div className="text-sm text-muted-foreground">@{bookmark.xAuthorUsername}</div>
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="px-4 py-1.5 rounded-full bg-amber-500/20 text-amber-400 text-sm font-medium border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
            >
              Follow
            </motion.button>
          </div>

          {/* Content */}
          <div className="px-5 pb-4">
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{bookmark.content}</p>
          </div>

          {/* Media */}
          {mediaUrls.length > 0 && (
            <div className="px-5 pb-4 space-y-2">
              {mediaUrls.map((url, i) => (
                <div key={i} className="relative rounded-2xl overflow-hidden bg-secondary">
                  <img
                    src={url}
                    alt=""
                    className="w-full object-cover max-h-80"
                    loading="lazy"
                  />
                  {mediaTypes[i] === 'video' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <Play className="w-7 h-7 text-white fill-white ml-1" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Metrics */}
          <div className="px-5 py-3 flex items-center gap-5 text-sm text-muted-foreground border-y border-border/20">
            <span className="font-semibold text-foreground">{formatCount(bookmark.likeCount)}</span> Likes
            <span className="font-semibold text-foreground">{formatCount(bookmark.repostCount)}</span> Reposts
            <span className="font-semibold text-foreground">{formatCount(bookmark.replyCount)}</span> Replies
          </div>

          {/* Action buttons */}
          <div className="px-5 py-3 flex items-center justify-between">
            <motion.button whileTap={{ scale: 0.85 }} className="p-2 rounded-full hover:bg-red-500/10 hover:text-red-400 transition-colors">
              <Heart className="w-5 h-5" />
            </motion.button>
            <motion.button whileTap={{ scale: 0.85 }} className="p-2 rounded-full hover:bg-blue-500/10 hover:text-blue-400 transition-colors">
              <MessageCircle className="w-5 h-5" />
            </motion.button>
            <motion.button whileTap={{ scale: 0.85 }} className="p-2 rounded-full hover:bg-green-500/10 hover:text-green-400 transition-colors">
              <Repeat2 className="w-5 h-5" />
            </motion.button>
            <motion.button whileTap={{ scale: 0.85 }} className="p-2 rounded-full text-amber-400">
              <Bookmark className="w-5 h-5 fill-amber-400" />
            </motion.button>
            <motion.button whileTap={{ scale: 0.85 }} className="p-2 rounded-full hover:bg-secondary/50 transition-colors">
              <Share className="w-5 h-5" />
            </motion.button>
          </div>

          {/* Collections & Tags */}
          <div className="px-5 py-4 space-y-3 border-t border-border/20">
            {bookmark.collections.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                  <Bookmark className="w-3 h-3" /> Collections
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {bookmark.collections.map((col) => (
                    <span
                      key={col.id}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium"
                      style={{
                        backgroundColor: `${col.color}15`,
                        color: col.color || undefined,
                        borderColor: `${col.color}30`,
                      }}
                    >
                      {col.icon} {col.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {bookmark.tags.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                  <Tag className="w-3 h-3" /> Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {bookmark.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-secondary/50 border border-border/30"
                      style={{ color: tag.color || undefined }}
                    >
                      #{tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              Saved {new Date(bookmark.savedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Eye className="w-3 h-3" />
              {formatCount(bookmark.viewCount)} views
            </div>
          </div>

          {/* Open in X button */}
          <div className="px-5 pb-6">
            <motion.a
              href={`https://x.com/${bookmark.xAuthorUsername}/status/${bookmark.xPostId}`}
              target="_blank"
              rel="noopener noreferrer"
              whileTap={{ scale: 0.98 }}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-secondary/50 border border-border/30 text-sm font-medium hover:bg-secondary/80 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Open in X
            </motion.a>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
