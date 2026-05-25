'use client';

import { motion } from 'framer-motion';
import { useAppStore, type Page } from '@/lib/store';
import { Bookmark, Home, FolderOpen, Image, Search, Compass, User } from 'lucide-react';

const navItems: { page: Page; icon: React.ComponentType<any>; label: string }[] = [
  { page: 'home', icon: Home, label: 'Home' },
  { page: 'collections', icon: FolderOpen, label: 'Collections' },
  { page: 'media', icon: Image, label: 'Media' },
  { page: 'search', icon: Search, label: 'Search' },
  { page: 'discover', icon: Compass, label: 'Discover' },
  { page: 'profile', icon: User, label: 'Profile' },
];

export function Header() {
  const { currentPage, setCurrentPage, user } = useAppStore();

  const isConnected = user?.xConnected || false;

  return (
    <header className="sticky top-0 z-50 glass border-b border-border/50 safe-top">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <motion.button
          onClick={() => setCurrentPage('home')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-2.5"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md shadow-amber-500/20">
            <Bookmark className="w-4 h-4 text-white fill-white/30" />
          </div>
          <span className="font-bold text-lg bg-gradient-to-r from-amber-200 to-orange-300 bg-clip-text text-transparent hidden sm:block">
            BookmarkVault
          </span>
        </motion.button>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = currentPage === item.page;
            return (
              <motion.button
                key={item.page}
                onClick={() => setCurrentPage(item.page)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`relative px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-amber-400'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="header-indicator"
                    className="absolute inset-0 bg-amber-500/10 rounded-xl border border-amber-500/20"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </span>
              </motion.button>
            );
          })}
        </nav>

        {/* Connection status */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full shadow-sm ${isConnected ? 'bg-emerald-400 shadow-emerald-400/50' : 'bg-muted-foreground/50'}`} />
          <span className="text-xs text-muted-foreground hidden sm:block">
            {isConnected ? `@${user?.xUsername || 'connected'}` : 'Not connected'}
          </span>
        </div>
      </div>
    </header>
  );
}
