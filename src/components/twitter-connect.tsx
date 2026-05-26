'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import * as api from '@/lib/api';
import {
  Loader2,
  Key,
  Shield,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Cookie,
  Zap,
  Info,
  Cloud,
} from 'lucide-react';
import { toast } from 'sonner';

interface XConfig {
  configured: boolean;
  method: string | null;
  hasOAuth2: boolean;
  hasOAuth1: boolean;
  hasBearerToken: boolean;
  hasTwikit: boolean;
}

export function TwitterConnect() {
  const { user, setAuth, token } = useAppStore();
  const [authToken, setAuthToken] = useState('');
  const [ct0, setCt0] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'input' | 'validating' | 'syncing' | 'done'>('input');
  const [showCookieFallback, setShowCookieFallback] = useState(false);
  const [xConfig, setXConfig] = useState<XConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await api.auth.getXConfig();
        setXConfig(config as XConfig);
      } catch {
        setXConfig({ configured: false, method: null, hasOAuth2: false, hasOAuth1: false, hasBearerToken: false, hasTwikit: false });
      }
      setIsLoadingConfig(false);
    }
    loadConfig();
  }, []);

  const handleOAuth2Connect = async () => {
    setError('');
    try {
      api.auth.connectXOAuth2();
      // The page will redirect to X's OAuth page
    } catch (err: any) {
      setError(err.message || 'Failed to initiate OAuth 2.0 flow');
    }
  };

  const handleCookieConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    setStep('validating');

    try {
      const result = await api.auth.connectTwitter(authToken, ct0);

      if (result.success) {
        // Refresh user data
        const meResult = await api.auth.me();
        if (meResult?.user && token) {
          setAuth(token, meResult.user);
        }

        const displayName = result.username || meResult?.user?.xUsername || 'user';
        toast.success(`Connected as @${displayName}`);
        setStep('syncing');

        // Trigger initial sync
        try {
          setIsSyncing(true);
          await api.bookmarks.sync();
          toast.success('Bookmarks synced!');
        } catch (syncErr: any) {
          console.error('Initial sync failed:', syncErr);
          toast.error('Sync will continue in background');
        }

        setStep('done');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
      setStep('input');
    }
    setIsLoading(false);
  };

  const oauth2Available = xConfig?.hasOAuth2 ?? false;
  const twikitAvailable = xConfig?.hasTwikit ?? false;

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center">
          <Zap className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Connect X/Twitter</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Link your X account to sync and organize your bookmarks.
        </p>
      </motion.div>

      {step === 'done' ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-8"
        >
          <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Connected!</h2>
          <p className="text-sm text-muted-foreground">
            Your X/Twitter account is connected. Your bookmarks are being synced.
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            The page will refresh automatically...
          </p>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-4"
        >
          {/* Connection method status */}
          {user?.xConnected && user?.xAuthMethod && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-400">
                  Connected via {user.xAuthMethod === 'x_api' ? 'X API (OAuth 2.0)' : user.xAuthMethod === 'cookie' ? 'Cookie-based' : 'Twikit (Cookies)'}
                </p>
                <p className="text-xs text-muted-foreground">
                  @{user.xUsername || 'user'}
                </p>
              </div>
            </motion.div>
          )}

          {/* Primary method: OAuth 2.0 */}
          {oauth2Available && (
            <div className="space-y-3">
              <motion.button
                onClick={handleOAuth2Connect}
                disabled={isLoading}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-neutral-900 to-neutral-800 text-white font-semibold shadow-lg shadow-neutral-900/25 hover:shadow-neutral-900/40 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 border border-neutral-700/50"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Sign in with X
              </motion.button>

              <div className="flex items-center gap-2 px-1">
                <Shield className="w-3.5 h-3.5 text-emerald-400/60" />
                <p className="text-[11px] text-muted-foreground/60">
                  Secure OAuth 2.0 PKCE flow — your credentials are never shared
                </p>
              </div>
            </div>
          )}

          {/* OAuth 2.0 not configured warning */}
          {!oauth2Available && !isLoadingConfig && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400/60 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-amber-400/80">OAuth 2.0 not configured</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Set X_CLIENT_ID and X_CLIENT_SECRET in your environment variables to enable the &quot;Sign in with X&quot; button. 
                  You can still use cookies below.
                </p>
              </div>
            </div>
          )}

          {/* Divider with "or" */}
          <div className="relative flex items-center gap-4 py-1">
            <div className="flex-1 h-px bg-border/30" />
            <span className="text-xs text-muted-foreground/50 font-medium">or</span>
            <div className="flex-1 h-px bg-border/30" />
          </div>

          {/* Fallback method: Cookie-based (Twikit) */}
          {!showCookieFallback ? (
            <motion.button
              onClick={() => setShowCookieFallback(true)}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full p-4 rounded-xl bg-secondary/30 border border-border/30 hover:bg-secondary/50 transition-colors flex items-center gap-3 text-left"
            >
              <Cookie className="w-5 h-5 text-amber-400/60 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Connect with Twitter Cookies</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {twikitAvailable 
                    ? 'Alternative method using cookies directly' 
                    : 'Direct API access using your X cookies'}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground/50" />
            </motion.button>
          ) : (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-xl bg-secondary/20 border border-border/30 overflow-hidden"
            >
              <button
                onClick={() => setShowCookieFallback(false)}
                className="w-full p-3 flex items-center gap-2 text-left hover:bg-secondary/30 transition-colors"
              >
                <Cookie className="w-4 h-4 text-amber-400/60" />
                <span className="text-xs font-medium text-muted-foreground flex-1">
                  Connect with Twitter Cookies (Direct API)
                </span>
                <ChevronUp className="w-4 h-4 text-muted-foreground/50" />
              </button>

              <form onSubmit={handleCookieConnect} className="px-4 pb-4 space-y-3">
                {/* Info note */}
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-amber-400/60 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-muted-foreground/70">
                    {twikitAvailable 
                      ? 'This method uses your Twitter cookies to access X\'s API directly. No Python service needed.'
                      : 'Your cookies are used to access X\'s internal API directly. No additional services needed — this works on Vercel.'}
                  </p>
                </div>

                {/* Instructions */}
                <div className="p-3 rounded-lg bg-card/40 border border-border/10">
                  <h3 className="font-semibold text-xs mb-1.5 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-amber-400/80" />
                    How to get your cookies
                  </h3>
                  <ol className="text-[10px] text-muted-foreground/70 space-y-1 list-decimal list-inside">
                    <li>Open <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="text-amber-400/80 underline inline-flex items-center gap-0.5">x.com<ExternalLink className="w-2 h-2" /></a> and log in</li>
                    <li>Open browser DevTools (F12 or Cmd+Option+I)</li>
                    <li>Go to Application &rarr; Cookies &rarr; https://x.com</li>
                    <li>Find and copy the <code className="px-1 py-0.5 rounded bg-secondary/50 text-amber-400/80 font-mono">auth_token</code> value</li>
                    <li>Find and copy the <code className="px-1 py-0.5 rounded bg-secondary/50 text-amber-400/80 font-mono">ct0</code> value</li>
                  </ol>
                  <p className="text-[9px] text-muted-foreground/40 mt-2">
                    Your cookies are stored locally and encrypted. They are never shared with third parties.
                  </p>
                </div>

                {/* auth_token input */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block font-medium">auth_token</label>
                  <input
                    type="password"
                    placeholder="Paste your auth_token cookie value"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-secondary/50 border border-border/30 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 transition-all font-mono text-xs"
                    required
                  />
                </div>

                {/* ct0 input */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block font-medium">ct0</label>
                  <input
                    type="password"
                    placeholder="Paste your ct0 cookie value"
                    value={ct0}
                    onChange={(e) => setCt0(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-secondary/50 border border-border/30 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 transition-all font-mono text-xs"
                    required
                  />
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400"
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {error}
                  </motion.div>
                )}

                <motion.button
                  type="submit"
                  disabled={isLoading || !authToken || !ct0}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-amber-500/80 to-orange-500/80 text-white font-semibold shadow-lg shadow-amber-500/15 hover:shadow-amber-500/25 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {step === 'validating' ? 'Validating...' : 'Syncing bookmarks...'}
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      Connect & Sync
                    </>
                  )}
                </motion.button>
              </form>
            </motion.div>
          )}

          {/* Loading config state */}
          {isLoadingConfig && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground/50">Checking available connection methods...</span>
            </div>
          )}

          {/* Config status info */}
          {!isLoadingConfig && xConfig && (
            <div className="space-y-1.5 px-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className={`w-1.5 h-1.5 rounded-full ${xConfig.hasOAuth2 ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                <span className="text-[10px] text-muted-foreground/40">
                  OAuth 2.0 {xConfig.hasOAuth2 ? '✓' : '—'}
                </span>
                <div className={`w-1.5 h-1.5 rounded-full ${(xConfig as any).hasCookie ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                <span className="text-[10px] text-muted-foreground/40">
                  Cookie {((xConfig as any).hasCookie !== false) ? '✓' : '—'}
                </span>
                <div className={`w-1.5 h-1.5 rounded-full ${xConfig.hasBearerToken ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                <span className="text-[10px] text-muted-foreground/40">
                  Bearer {xConfig.hasBearerToken ? '✓' : '—'}
                </span>
                <div className={`w-1.5 h-1.5 rounded-full ${xConfig.hasTwikit ? 'bg-amber-400' : 'bg-muted-foreground/30'}`} />
                <span className="text-[10px] text-muted-foreground/40">
                  Twikit {xConfig.hasTwikit ? '✓' : '—'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Cloud className="w-3 h-3 text-muted-foreground/30" />
                <span className="text-[10px] text-muted-foreground/30">
                  Vercel-ready • Cookie-based direct • X API v2 • Twikit optional
                </span>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
