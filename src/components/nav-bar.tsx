'use client';

import { motion } from 'framer-motion';
import { useAppStore, type Page } from '@/lib/store';
import { Home, FolderOpen, Image, Search, Compass, User } from 'lucide-react';

const navItems: { page: Page; icon: React.ComponentType<any>; label: string }[] = [
  { page: 'home', icon: Home, label: 'Home' },
  { page: 'collections', icon: FolderOpen, label: 'Collections' },
  { page: 'media', icon: Image, label: 'Media' },
  { page: 'search', icon: Search, label: 'Search' },
  { page: 'discover', icon: Compass, label: 'Discover' },
  { page: 'profile', icon: User, label: 'Profile' },
];

export function NavBar() {
  const { currentPage, setCurrentPage } = useAppStore();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-border/50 safe-bottom">
      <div className="flex items-center justify-around px-2 py-1">
        {navItems.map((item) => {
          const isActive = currentPage === item.page;
          return (
            <motion.button
              key={item.page}
              onClick={() => setCurrentPage(item.page)}
              whileTap={{ scale: 0.85 }}
              className={`relative flex flex-col items-center justify-center py-2 px-3 rounded-xl transition-colors ${
                isActive ? 'text-amber-400' : 'text-muted-foreground'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -top-1 w-6 h-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-400"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <item.icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] mt-0.5 font-medium">{item.label}</span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}
