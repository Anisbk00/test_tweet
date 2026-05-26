import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Page = 'home' | 'collections' | 'media' | 'search' | 'discover' | 'profile';

interface User {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  xUsername: string | null;
  xConnected: boolean;
  xAuthMethod: string | null; // 'x_api' | 'twikit' | 'auto' | 'none'
}

export interface Bookmark {
  id: string;
  xPostId: string;
  xAuthorName: string | null;
  xAuthorUsername: string | null;
  xAuthorAvatar: string | null;
  content: string;
  mediaUrls: string;
  mediaTypes: string;
  previewUrls: string;
  replyCount: number;
  repostCount: number;
  likeCount: number;
  viewCount: number;
  bookmarkCount: number;
  postedAt: string | null;
  savedAt: string;
  collections: { id: string; name: string; color: string | null; icon: string | null }[];
  tags: { id: string; name: string; color: string | null }[];
  aiSummary: string | null;
}

interface Collection {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  color: string | null;
  icon: string | null;
  isSmart: boolean;
  sortOrder: number;
  createdAt: string;
  _count?: { bookmarks: number };
}

interface Tag {
  id: string;
  name: string;
  color: string | null;
  _count?: { bookmarks: number };
}

interface AppStore {
  // Auth
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;

  // Navigation
  currentPage: Page;
  previousPage: Page | null;
  setCurrentPage: (page: Page) => void;

  // Data
  bookmarks: Bookmark[];
  collections: Collection[];
  tags: Tag[];
  setBookmarks: (bookmarks: Bookmark[]) => void;
  setCollections: (collections: Collection[]) => void;
  setTags: (tags: Tag[]) => void;

  // UI State
  selectedBookmark: Bookmark | null;
  setSelectedBookmark: (bookmark: Bookmark | null) => void;
  selectedCollection: Collection | null;
  setSelectedCollection: (collection: Collection | null) => void;
  isDetailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Sync
  lastSyncAt: string | null;
  setLastSyncAt: (date: string) => void;

  // X disconnect
  disconnectX: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      // Auth
      token: null,
      user: null,
      isAuthenticated: false,
      setAuth: (token, user) => set({ token, user, isAuthenticated: true }),
      logout: () => set({ token: null, user: null, isAuthenticated: false }),

      // Navigation
      currentPage: 'home',
      previousPage: null,
      setCurrentPage: (page) =>
        set((state) => ({
          previousPage: state.currentPage,
          currentPage: page,
        })),

      // Data
      bookmarks: [],
      collections: [],
      tags: [],
      setBookmarks: (bookmarks) => set({ bookmarks }),
      setCollections: (collections) => set({ collections }),
      setTags: (tags) => set({ tags }),

      // UI State
      selectedBookmark: null,
      setSelectedBookmark: (bookmark) => set({ selectedBookmark: bookmark }),
      selectedCollection: null,
      setSelectedCollection: (collection) => set({ selectedCollection: collection }),
      isDetailOpen: false,
      setDetailOpen: (open) => set({ isDetailOpen: open }),
      searchQuery: '',
      setSearchQuery: (query) => set({ searchQuery: query }),
      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),

      // Sync
      lastSyncAt: null,
      setLastSyncAt: (date) => set({ lastSyncAt: date }),

      // X disconnect
      disconnectX: () => set((state) => ({
        user: state.user ? { ...state.user, xConnected: false, xAuthMethod: 'none' } : null,
      })),
    }),
    {
      name: 'bookmarkvault-store',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        currentPage: state.currentPage,
      }),
    }
  )
);
