'use client';

import { motion } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import { TrendingUp } from 'lucide-react';

export function TrendingTag() {
  const { tags } = useAppStore();

  const trendingTags = tags
    .filter((t) => t._count && t._count.bookmarks > 0)
    .sort((a, b) => (b._count?.bookmarks || 0) - (a._count?.bookmarks || 0))
    .slice(0, 8);

  if (trendingTags.length === 0) return null;

  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
        <div className="flex items-center gap-1 text-amber-400 flex-shrink-0 pr-1">
          <TrendingUp className="w-3.5 h-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-wider">Trending</span>
        </div>
        {trendingTags.map((tag) => (
          <motion.button
            key={tag.id}
            whileTap={{ scale: 0.95 }}
            className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-secondary/30 border border-border/30 hover:border-border/60 hover:bg-secondary/60 transition-colors"
            style={{ borderColor: `${tag.color}30`, color: tag.color || undefined }}
          >
            #{tag.name}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
