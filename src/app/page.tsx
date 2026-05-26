'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import * as api from '@/lib/api';
import { LoginScreen } from '@/components/login-screen';
import { AppShell } from '@/components/app-shell';

export default function Home() {
  const { isAuthenticated, token, setAuth } = useAppStore();
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize app - check auth
  useEffect(() => {
    async function init() {
      // Handle OAuth callback redirect params
      const params = new URLSearchParams(window.location.search);
      const xConnected = params.get('x_connected');
      const xMethod = params.get('x_method');
      const xError = params.get('error');

      // Clean URL params after reading them
      if (xConnected || xError) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      // If we just completed OAuth in a new tab (from the preview iframe),
      // try to notify the parent/opener window
      if (xConnected === 'true' && window.opener) {
        try {
          window.opener.postMessage({ type: 'x_oauth_complete', method: xMethod }, '*');
        } catch {
          // ignore cross-origin errors
        }
      }

      if (token) {
        try {
          const user = await api.auth.me();
          if (user?.user) {
            setAuth(token, user.user);

            // Show toast for OAuth callback
            if (xConnected === 'true' && user.user.xConnected) {
              const method = xMethod === 'x_api' ? 'X API (OAuth 2.0)' : 'Cookie-based';
              const { toast } = await import('sonner');
              toast.success(`Connected via ${method} as @${user.user.xUsername || 'user'}`);

              // If we're in a popup tab, try to close after short delay
              if (window.opener) {
                setTimeout(() => {
                  try { window.close(); } catch { /* ignore */ }
                }, 2000);
              }
            }
          } else {
            // Token is invalid, log out
            useAppStore.getState().logout();
          }
        } catch {
          // Token expired or invalid, clear auth
          useAppStore.getState().logout();
        }
      }

      // Show error toast if OAuth failed
      if (xError) {
        const { toast } = await import('sonner');
        const errorDetail = params.get('error_detail') || 'Connection failed';
        toast.error(errorDetail);
      }

      setIsInitialized(true);
    }
    init();
  }, [token, setAuth]);

  // Listen for OAuth completion from a popup/new tab
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'x_oauth_complete') {
        // Refresh user data from the server
        (async () => {
          try {
            const user = await api.auth.me();
            if (user?.user && token) {
              setAuth(token, user.user);
              const { toast } = await import('sonner');
              const method = event.data.method === 'x_api' ? 'X API (OAuth 2.0)' : 'Cookie-based';
              toast.success(`Connected via ${method} as @${user.user.xUsername || 'user'}`);
            }
          } catch {
            // ignore
          }
        })();
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [token, setAuth]);

  const handleLogin = useCallback(async (email: string, password: string) => {
    const result = await api.auth.login(email, password);
    setAuth(result.token, result.user);
  }, [setAuth]);

  const handleRegister = useCallback(async (email: string, password: string, name: string) => {
    const result = await api.auth.register(email, password, name);
    setAuth(result.token, result.user);
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
        onRegister={handleRegister}
      />
    );
  }

  return <AppShell />;
}
