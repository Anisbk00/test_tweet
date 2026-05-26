'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore, type Bookmark as BookmarkType } from '@/lib/store';
import { formatCount, formatDate, parseJSON, parseMediaUrls, getInitials, getAvatarColor, getMediaDisplayUrl } from '@/lib/utils';
import { Heart, MessageCircle, Repeat2, Eye, Bookmark, Play } from 'lucide-react';
import { SafeImg } from '@/components/safe-img';

interface PostCardProps {
  bookmark: BookmarkType;
  variant?: 'masonry' | 'list';
}

export function PostCard({ bookmark, variant = 'masonry' }: PostCardProps) {
  const { setSelectedBookmark, setDetailOpen } = useAppStore();
  const [isHovered, setIsHovered] = useState(false);
  const mediaUrls = parseMediaUrls(bookmark.mediaUrls);
  const mediaTypes = parseJSON<string[]>(bookmark.mediaTypes, []);
  const previewUrls = parseMediaUrls(bookmark.previewUrls || '[]');
  const tags = Array.isArray(bookmark.tags) ? bookmark.tags : [];
  const hasMedia = mediaUrls.length > 0;
  const firstMediaType = mediaTypes[0] || 'photo';

  const handleOpen = () => {
    setSelectedBookmark(bookmark);
    setDetailOpen(true);
  };

  if (variant === 'list') {
    return (
      <motion.div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleOpen}
        className="group cursor-pointer rounded-2xl bg-card/50 border border-border/30 hover:border-border/60 hover:bg-card/80 transition-all duration-200 overflow-hidden"
      >
        <div className="flex gap-3 p-4">
          {/* Author avatar */}
          <div className="flex-shrink-0">
            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getAvatarColor(bookmark.xAuthorName)} flex items-center justify-center text-white text-xs font-bold`}>
              {getInitials(bookmark.xAuthorName)}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm truncate">{bookmark.xAuthorName}</span>
              <span className="text-muted-foreground text-xs">@{bookmark.xAuthorUsername}</span>
              <span className="text-muted-foreground text-xs">· {formatDate(bookmark.postedAt)}</span>
            </div>
            <p className="text-sm leading-relaxed line-clamp-2">{bookmark.content}</p>

            {/* Media thumbnail */}
            {hasMedia && (
              <div className="mt-2 flex gap-1">
                {mediaUrls.slice(0, 3).map((url, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden bg-secondary">
                    <SafeImg
                      src={getMediaDisplayUrl(url, previewUrls[i], mediaTypes[i] || 'photo')}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {mediaTypes[i] === 'video' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Play className="w-5 h-5 text-white fill-white" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Metrics */}
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> {formatCount(bookmark.replyCount)}</span>
              <span className="flex items-center gap-1"><Repeat2 className="w-3.5 h-3.5" /> {formatCount(bookmark.repostCount)}</span>
              <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {formatCount(bookmark.likeCount)}</span>
              <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {formatCount(bookmark.viewCount)}</span>
            </div>
          </div>

          {/* Bookmark indicator */}
          <div className="flex-shrink-0">
            <Bookmark className="w-4 h-4 text-amber-400 fill-amber-400" />
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleOpen}
      layout
      className="group cursor-pointer rounded-2xl bg-card/50 border border-border/30 hover:border-border/60 hover:bg-card/80 transition-all duration-200 overflow-hidden"
    >
      {/* Media */}
      {hasMedia && (
        <div className="relative overflow-hidden">
          <div className={`w-full ${firstMediaType === 'video' ? 'aspect-video' : firstMediaType === 'gif' ? 'aspect-square' : 'aspect-[4/3]'}`}>
            <SafeImg
              src={getMediaDisplayUrl(mediaUrls[0], previewUrls[0], firstMediaType)}
              alt=""
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          </div>

          {/* Video/GIF overlay */}
          {(firstMediaType === 'video' || firstMediaType === 'gif') && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm">
              <div className="flex items-center gap-1">
                <Play className="w-3 h-3 text-white fill-white" />
                <span className="text-[10px] text-white font-medium uppercase">{firstMediaType}</span>
              </div>
            </div>
          )}

          {/* Media count */}
          {mediaUrls.length > 1 && (
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm">
              <span className="text-[10px] text-white font-medium">+{mediaUrls.length - 1}</span>
            </div>
          )}

          {/* Hover overlay */}
          {isHovered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"
            />
          )}
        </div>
      )}

      {/* Content */}
      <div className="p-3.5">
        {/* Author row */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${getAvatarColor(bookmark.xAuthorName)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
            {getInitials(bookmark.xAuthorName)}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-xs truncate block">{bookmark.xAuthorName}</span>
            <span className="text-muted-foreground text-[10px]">@{bookmark.xAuthorUsername}</span>
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatDate(bookmark.postedAt)}</span>
        </div>

        {/* Text */}
        {!hasMedia && (
          <p className="text-sm leading-relaxed line-clamp-6 mb-2">{bookmark.content}</p>
        )}
        {hasMedia && (
          <p className="text-xs leading-relaxed line-clamp-2 mb-2">{bookmark.content}</p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium"
                style={{
                  backgroundColor: `${tag.color}15`,
                  color: tag.color || 'oklch(0.65 0 0)',
                }}
              >
                #{tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Metrics */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><Heart className="w-3 h-3" /> {formatCount(bookmark.likeCount)}</span>
          <span className="flex items-center gap-0.5"><Repeat2 className="w-3 h-3" /> {formatCount(bookmark.repostCount)}</span>
          <span className="flex items-center gap-0.5"><MessageCircle className="w-3 h-3" /> {formatCount(bookmark.replyCount)}</span>
          <span className="flex items-center gap-0.5"><Bookmark className="w-3 h-3 text-amber-400 fill-amber-400" /> {formatCount(bookmark.bookmarkCount)}</span>
        </div>
      </div>
    </motion.div>
  );
}
