'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, type Page } from '@/lib/store';
import * as api from '@/lib/api';
import { LoginScreen } from '@/components/login-screen';
import { AppShell } from '@/components/app-shell';

export default function Home() {
  const { isAuthenticated, token, setAuth, setCurrentPage, currentPage } = useAppStore();
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  // Initialize app - check auth, seed if needed
  useEffect(() => {
    async function init() {
      if (token) {
        try {
          const user = await api.auth.me();
          if (user) {
            setAuth(token, user);
          }
        } catch {
          useAppStore.getState().logout();
        }
      }
      setIsInitialized(true);
    }
    init();
  }, [token, setAuth]);

  const handleLogin = useCallback(async (email: string, password: string) => {
    const result = await api.auth.login(email, password);
    setAuth(result.token, result.user);
  }, [setAuth]);

  const handleSeedAndLogin = useCallback(async () => {
    setIsSeeding(true);
    try {
      await api.seed.run();
      const result = await api.auth.login('demo@bookmarkvault.app', 'password');
      setAuth(result.token, result.user);
    } catch (err) {
      console.error('Seed failed:', err);
      try {
        const result = await api.auth.login('demo@bookmarkvault.app', 'password');
        setAuth(result.token, result.user);
      } catch (err2) {
        console.error('Login failed:', err2);
      }
    }
    setIsSeeding(false);
  }, [setAuth]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </div>
          <div className="shimmer h-1 w-24 rounded-full" />
        </motion.div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onSeedAndLogin={handleSeedAndLogin}
        isSeeding={isSeeding}
      />
    );
  }

  return <AppShell />;
}
