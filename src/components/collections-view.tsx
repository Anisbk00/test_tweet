'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import * as api from '@/lib/api';
import { formatCount, parseJSON, parseMediaUrls, getMediaDisplayUrl } from '@/lib/utils';
import { Plus, FolderOpen, MoreHorizontal, Pencil, Trash2, Bookmark, Image, Video, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { SafeImg } from '@/components/safe-img';

export function CollectionsView() {
  const { collections, setCollections, bookmarks } = useAppStore();
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#10b981');

  const colorOptions = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1'];

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      const res = await api.collections.create({ name: newName, color: newColor });
      // API returns { collection: {...} }, extract the collection object
      const col = res?.collection || res;
      setCollections([...collections, col]);
      setNewName('');
      setIsCreating(false);
      toast.success('Collection created!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create collection');
    }
  }, [newName, newColor, collections, setCollections]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.collections.delete(id);
      setCollections(collections.filter((c) => c.id !== id));
      if (selectedCollection === id) setSelectedCollection(null);
      toast.success('Collection deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
  }, [collections, setCollections, selectedCollection]);

  const selectedCol = collections.find((c) => c.id === selectedCollection);
  const colBookmarks = selectedCollection
    ? bookmarks.filter((b) => Array.isArray(b.collections) && b.collections.some((c) => c.id === selectedCollection))
    : [];

  return (
    <div className="max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Collections</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {collections.length} collections · {bookmarks.length} bookmarks
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-medium shadow-lg shadow-amber-500/20"
        >
          <Plus className="w-4 h-4" /> New
        </motion.button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {isCreating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 p-4 rounded-2xl bg-card/80 border border-border/30"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Collection name..."
              className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 mb-3"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="flex items-center gap-2 mb-3">
              {colorOptions.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewColor(color)}
                  className={`w-7 h-7 rounded-full transition-all ${newColor === color ? 'ring-2 ring-offset-2 ring-offset-card scale-110' : ''}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                className="px-4 py-2 rounded-xl bg-amber-500/20 text-amber-400 text-sm font-medium border border-amber-500/30"
              >
                Create
              </button>
              <button
                onClick={() => { setIsCreating(false); setNewName(''); }}
                className="px-4 py-2 rounded-xl bg-secondary/50 text-muted-foreground text-sm"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collections Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {collections.map((col, i) => {
          const colBooks = bookmarks.filter((b) => Array.isArray(b.collections) && b.collections.some((c) => c.id === col.id));
          const coverMedia = colBooks.find((b) => {
            const urls = parseMediaUrls(b.mediaUrls);
            return urls.length > 0;
          });
          const coverUrl = coverMedia ? (() => {
            const urls = parseMediaUrls(coverMedia.mediaUrls);
            const types = parseJSON<string[]>(coverMedia.mediaTypes, []);
            const previewUrls = parseMediaUrls(coverMedia.previewUrls || '[]');
            return urls.length > 0 ? getMediaDisplayUrl(urls[0], previewUrls[0], types[0] || 'photo') : null;
          })() : null;

          return (
            <motion.div
              key={col.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ y: -4 }}
              onClick={() => setSelectedCollection(selectedCollection === col.id ? null : col.id)}
              className="group cursor-pointer rounded-2xl bg-card/50 border border-border/30 hover:border-border/60 overflow-hidden transition-all"
            >
              {/* Cover image */}
              <div className="aspect-[4/3] relative overflow-hidden bg-secondary/30">
                {coverUrl ? (
                  <SafeImg src={coverUrl} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: `${col.color || '#888888'}15` }}>
                    <span className="text-4xl">{col.icon || '📁'}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="flex items-center gap-1 text-white/80 text-[10px]">
                    <Bookmark className="w-3 h-3" /> {colBooks.length} items
                  </div>
                </div>
              </div>

              {/* Info */}
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
                  <h3 className="font-semibold text-sm truncate">{col.name}</h3>
                </div>
                {col.description && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{col.description}</p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Selected collection detail */}
      <AnimatePresence>
        {selectedCol && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="mt-8"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedCol.color }} />
                <h2 className="text-xl font-bold">{selectedCol.name}</h2>
                <span className="text-sm text-muted-foreground">{colBookmarks.length} bookmarks</span>
              </div>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => handleDelete(selectedCol.id)}
                className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </motion.button>
            </div>

            {colBookmarks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No bookmarks in this collection yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {colBookmarks.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-card/50 border border-border/20 hover:border-border/40 transition-colors cursor-pointer"
                    onClick={() => {
                      useAppStore.getState().setSelectedBookmark(b);
                      useAppStore.getState().setDetailOpen(true);
                    }}
                  >
                    {(() => {
                      const urls = parseMediaUrls(b.mediaUrls);
                      const types = parseJSON<string[]>(b.mediaTypes, []);
                      const previewUrls = parseMediaUrls(b.previewUrls || '[]');
                      return urls.length > 0 ? (
                        <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0">
                          <SafeImg src={getMediaDisplayUrl(urls[0], previewUrls[0], types[0] || 'photo')} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center flex-shrink-0">
                          {types[0] === 'video' ? <Video className="w-4 h-4 text-muted-foreground" /> : <FileText className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      );
                    })()}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-1">{b.content}</p>
                      <p className="text-[10px] text-muted-foreground">@{b.xAuthorUsername || 'unknown'}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatCount(b.likeCount)} ♥</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
