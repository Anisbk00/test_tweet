'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import * as api from '@/lib/api';
import { formatCount, formatDate, parseJSON, parseMediaUrls, getInitials, getAvatarColor } from '@/lib/utils';
import { Search, X, Filter, SlidersHorizontal, Calendar, User, Tag, Image as ImageIcon, ArrowUp } from 'lucide-react';

type SearchFilter = {
  mediaType: string;
  dateFrom: string;
  dateTo: string;
  author: string;
  tag: string;
  collection: string;
  sort: string;
};

export function SearchView() {
  const { bookmarks, tags, collections } = useAppStore();
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<SearchFilter>({
    mediaType: '',
    dateFrom: '',
    dateTo: '',
    author: '',
    tag: '',
    collection: '',
    sort: 'relevance',
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim() && !filters.mediaType && !filters.tag && !filters.collection) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const params: Record<string, string> = {};
      if (q.trim()) params.q = q;
      if (filters.mediaType) params.mediaType = filters.mediaType;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      if (filters.author) params.author = filters.author;
      if (filters.tag) params.tag = filters.tag;
      if (filters.collection) params.collection = filters.collection;
      if (filters.sort) params.sort = filters.sort;

      const res = await api.search.query(params);
      const resultsList = res?.bookmarks || res?.data || [];
      setResults(Array.isArray(resultsList) ? resultsList : []);
    } catch (err) {
      console.error('Search failed:', err);
    }
    setIsSearching(false);
  }, [filters]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => performSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, performSearch]);

  const activeFilterCount = Object.values(filters).filter((v) => v && v !== 'relevance').length;

  return (
    <div className="max-w-3xl mx-auto p-4">
      {/* Search bar */}
      <div className="relative mb-6">
        <div className="relative flex items-center">
          <Search className="absolute left-4 w-5 h-5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your bookmarks..."
            className="w-full pl-12 pr-20 py-3.5 rounded-2xl bg-card/80 border border-border/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 transition-all"
          />
          {query && (
            <motion.button
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
              className="absolute right-16 p-1.5 rounded-full hover:bg-secondary/50 text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </motion.button>
          )}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowFilters(!showFilters)}
            className={`absolute right-3 p-2 rounded-xl transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-[8px] text-white flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </motion.button>
        </div>
      </div>

      {/* Filters panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 p-4 rounded-2xl bg-card/60 border border-border/20 overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-3">
              {/* Media type filter */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" /> Media Type
                </label>
                <select
                  value={filters.mediaType}
                  onChange={(e) => setFilters({ ...filters, mediaType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                >
                  <option value="">All</option>
                  <option value="photo">Photos</option>
                  <option value="video">Videos</option>
                  <option value="gif">GIFs</option>
                  <option value="none">Text Only</option>
                </select>
              </div>

              {/* Sort */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                  <ArrowUp className="w-3 h-3" /> Sort By
                </label>
                <select
                  value={filters.sort}
                  onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                >
                  <option value="relevance">Relevance</option>
                  <option value="date">Date</option>
                  <option value="likes">Most Liked</option>
                </select>
              </div>

              {/* Tag filter */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Tag
                </label>
                <select
                  value={filters.tag}
                  onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                >
                  <option value="">All Tags</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* Collection filter */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                  <Filter className="w-3 h-3" /> Collection
                </label>
                <select
                  value={filters.collection}
                  onChange={(e) => setFilters({ ...filters, collection: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                >
                  <option value="">All Collections</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setFilters({ mediaType: '', dateFrom: '', dateTo: '', author: '', tag: '', collection: '', sort: 'relevance' })}
                className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                Clear all
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      {isSearching ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer rounded-2xl h-24" />
          ))}
        </div>
      ) : results.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground mb-3">{results.length} results found</p>
          {results.map((bookmark: any, i: number) => (
            <motion.div
              key={bookmark.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              onClick={() => {
                useAppStore.getState().setSelectedBookmark(bookmark);
                useAppStore.getState().setDetailOpen(true);
              }}
              className="flex items-start gap-3 p-3.5 rounded-2xl bg-card/50 border border-border/20 hover:border-border/50 cursor-pointer transition-all"
            >
              <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${getAvatarColor(bookmark.xAuthorName)} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5`}>
                {getInitials(bookmark.xAuthorName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-sm truncate">{bookmark.xAuthorName}</span>
                  <span className="text-muted-foreground text-xs">@{bookmark.xAuthorUsername}</span>
                </div>
                <p className="text-sm line-clamp-2 mb-1.5">{bookmark.content}</p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>♥ {formatCount(bookmark.likeCount)}</span>
                  <span>{formatDate(bookmark.postedAt)}</span>
                  {Array.isArray(bookmark.tags) && bookmark.tags.length > 0 && (
                    <span className="text-amber-400">#{bookmark.tags[0].name}</span>
                  )}
                </div>
              </div>
              {(() => {
                const urls = parseMediaUrls(bookmark.mediaUrls);
                return urls.length > 0 ? (
                  <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0">
                    <img src={urls[0]} alt="Bookmark media" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ) : null;
              })()}
            </motion.div>
          ))}
        </div>
      ) : query ? (
        <div className="text-center py-16">
          <Search className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-muted-foreground">No results found for &ldquo;{query}&rdquo;</p>
        </div>
      ) : (
        <div className="text-center py-16">
          <Search className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <h3 className="font-semibold mb-1">Search your bookmarks</h3>
          <p className="text-sm text-muted-foreground">Find posts by content, author, tags, or media type</p>

          {/* Quick searches */}
          <div className="mt-6 flex flex-wrap gap-2 justify-center">
            {['AI', 'Design', 'Startup', 'Python', 'React'].map((term) => (
              <motion.button
                key={term}
                whileTap={{ scale: 0.95 }}
                onClick={() => setQuery(term)}
                className="px-4 py-2 rounded-xl bg-secondary/30 border border-border/20 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              >
                {term}
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
