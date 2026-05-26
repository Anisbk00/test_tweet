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
  Cookie,
  Zap,
  Info,
  Eye,
  EyeOff,
  AlertTriangle,
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
  const [twid, setTwid] = useState('');
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [showCt0, setShowCt0] = useState(false);
  const [showTwid, setShowTwid] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'input' | 'validating' | 'syncing' | 'done'>('input');
  const [xConfig, setXConfig] = useState<XConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [showOAuthOption, setShowOAuthOption] = useState(false);
  const [needsTwid, setNeedsTwid] = useState(false);

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
    } catch (err: any) {
      setError(err.message || 'Failed to initiate OAuth 2.0 flow');
    }
  };

  const handleCookieConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNeedsTwid(false);
    setIsLoading(true);
    setStep('validating');

    try {
      const result = await api.auth.connectTwitter(authToken, ct0, twid || undefined);

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
          const syncMsg = syncErr?.message || '';
          if (syncMsg.includes('401') || syncMsg.includes('Unauthorized') || syncMsg.includes('authentication failed')) {
            toast.error('Sync failed — your cookies may have expired. Please reconnect with fresh cookies including the twid cookie.');
          } else if (syncMsg.includes('timeout') || syncMsg.includes('Timeout')) {
            toast.error('Sync timed out. You can retry from the home page.');
          } else if (syncMsg.includes('twid')) {
            toast.error('Missing twid cookie — please add the twid value and try again.');
          } else {
            toast.error('Sync failed: ' + (syncMsg || 'Could not fetch bookmarks. You can retry from the home page.'));
          }
        } finally {
          setIsSyncing(false);
        }

        setStep('done');
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to connect';
      setError(errMsg);
      
      // Check if the error is about missing twid
      if (errMsg.toLowerCase().includes('twid')) {
        setNeedsTwid(true);
      }
      setStep('input');
    }
    setIsLoading(false);
  };

  const oauth2Available = xConfig?.hasOAuth2 ?? false;

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

          {/* ===== PRIMARY METHOD: Cookie-based (Quick Connect) ===== */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-2xl bg-gradient-to-br from-card/80 via-card/60 to-card/80 border border-border/20 overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 pb-0">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/20 flex items-center justify-center">
                  <Cookie className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-sm">Quick Connect</h2>
                  <p className="text-[11px] text-muted-foreground/60">Paste your X cookies — no redirects, works instantly</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleCookieConnect} className="p-4 space-y-3">
              {/* Instructions */}
              <div className="p-3 rounded-lg bg-card/60 border border-border/10">
                <h3 className="font-semibold text-xs mb-2 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-400/80" />
                  How to get your cookies
                </h3>
                <ol className="text-[11px] text-muted-foreground/70 space-y-1.5 list-decimal list-inside">
                  <li>Open <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="text-amber-400/80 underline inline-flex items-center gap-0.5">x.com<ExternalLink className="w-2.5 h-2.5" /></a> and log in with your X account</li>
                  <li>Open browser DevTools — press <kbd className="px-1 py-0.5 rounded bg-secondary/50 text-[10px] font-mono">F12</kbd> or <kbd className="px-1 py-0.5 rounded bg-secondary/50 text-[10px] font-mono">Cmd+Option+I</kbd></li>
                  <li>Go to <strong>Application</strong> tab → <strong>Cookies</strong> → <code className="px-1 py-0.5 rounded bg-secondary/50 text-amber-400/80 font-mono text-[10px]">https://x.com</code></li>
                  <li>Find and copy these 3 cookies:</li>
                </ol>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/60"></span>
                    <code className="px-1 py-0.5 rounded bg-secondary/50 text-amber-400/80 font-mono text-[10px]">auth_token</code>
                    <span className="text-[10px] text-red-400/60 font-medium">required</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/60"></span>
                    <code className="px-1 py-0.5 rounded bg-secondary/50 text-amber-400/80 font-mono text-[10px]">ct0</code>
                    <span className="text-[10px] text-red-400/60 font-medium">required</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/60"></span>
                    <code className="px-1 py-0.5 rounded bg-secondary/50 text-amber-400/80 font-mono text-[10px]">twid</code>
                    <span className="text-[10px] text-amber-400/60 font-medium">recommended (looks like u=123456 or %7B...%7D)</span>
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground/40 mt-2">
                  Your cookies are stored locally and encrypted. They are never shared with third parties.
                </p>
              </div>

              {/* auth_token input */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block font-medium">
                  auth_token <span className="text-red-400/60">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showAuthToken ? 'text' : 'password'}
                    placeholder="Paste your auth_token cookie value"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    className="w-full px-3 py-2.5 pr-9 rounded-lg bg-secondary/50 border border-border/30 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 transition-all font-mono text-xs"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowAuthToken(!showAuthToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                  >
                    {showAuthToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* ct0 input */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block font-medium">
                  ct0 <span className="text-red-400/60">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showCt0 ? 'text' : 'password'}
                    placeholder="Paste your ct0 cookie value"
                    value={ct0}
                    onChange={(e) => setCt0(e.target.value)}
                    className="w-full px-3 py-2.5 pr-9 rounded-lg bg-secondary/50 border border-border/30 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 transition-all font-mono text-xs"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCt0(!showCt0)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                  >
                    {showCt0 ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* twid input */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block font-medium">
                  twid <span className="text-amber-400/60 font-normal">(recommended)</span>
                </label>
                <div className="relative">
                  <input
                    type={showTwid ? 'text' : 'password'}
                    placeholder="Paste your twid cookie value (e.g., u=1234567890)"
                    value={twid}
                    onChange={(e) => { setTwid(e.target.value); setNeedsTwid(false); }}
                    className={`w-full px-3 py-2.5 pr-9 rounded-lg bg-secondary/50 border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all font-mono text-xs ${
                      needsTwid ? 'border-amber-500/50 ring-1 ring-amber-500/20' : 'border-border/30 focus:border-amber-500/30'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowTwid(!showTwid)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                  >
                    {showTwid ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {needsTwid && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[10px] text-amber-400/80 mt-1 flex items-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    X now requires the twid cookie. Please copy it from your browser cookies.
                  </motion.p>
                )}
                <p className="text-[9px] text-muted-foreground/30 mt-1">
                  The twid cookie contains your user ID. X may reject requests without it. If you skip this, we&apos;ll try to construct it from your user ID after validation.
                </p>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400"
                >
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p>{error}</p>
                    {error.toLowerCase().includes('twid') && !twid && (
                      <p className="mt-1 text-[10px] text-amber-400/70">
                        💡 Tip: Add the twid cookie above — it&apos;s now required by X for authentication.
                      </p>
                    )}
                  </div>
                </motion.div>
              )}

              <motion.button
                type="submit"
                disabled={isLoading || !authToken || !ct0}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {step === 'validating' ? 'Validating cookies...' : 'Syncing bookmarks...'}
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

          {/* ===== SECONDARY METHOD: OAuth 2.0 (advanced) ===== */}
          {oauth2Available && (
            <>
              {!showOAuthOption ? (
                <motion.button
                  onClick={() => setShowOAuthOption(true)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="w-full p-3 rounded-xl bg-secondary/20 border border-border/20 hover:bg-secondary/30 transition-colors flex items-center gap-2.5 text-left"
                >
                  <svg className="w-4 h-4 text-muted-foreground/50" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-muted-foreground/70">Sign in with X (OAuth 2.0)</p>
                    <p className="text-[10px] text-muted-foreground/40">Alternative — may not work in some browsers</p>
                  </div>
                </motion.button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-xl bg-secondary/10 border border-border/20 overflow-hidden"
                >
                  <button
                    onClick={() => setShowOAuthOption(false)}
                    className="w-full p-3 flex items-center gap-2 text-left hover:bg-secondary/20 transition-colors"
                  >
                    <svg className="w-4 h-4 text-muted-foreground/50" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span className="text-xs font-medium text-muted-foreground/60 flex-1">Sign in with X (OAuth 2.0)</span>
                  </button>

                  <div className="px-4 pb-4 space-y-3">
                    <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10 flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 text-amber-400/60 mt-0.5 flex-shrink-0" />
                      <p className="text-[11px] text-muted-foreground/60">
                        OAuth 2.0 redirects you to X&apos;s login page. It may not redirect back in some environments (like iframe previews). If it doesn&apos;t work, use the cookie method above.
                      </p>
                    </div>

                    <motion.button
                      onClick={handleOAuth2Connect}
                      disabled={isLoading}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full py-3 rounded-lg bg-gradient-to-r from-neutral-900 to-neutral-800 text-white font-semibold text-sm shadow-lg shadow-neutral-900/25 hover:shadow-neutral-900/40 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-neutral-700/50"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      Sign in with X
                    </motion.button>

                    <div className="flex items-center gap-2 px-1">
                      <Shield className="w-3 h-3 text-emerald-400/40" />
                      <p className="text-[10px] text-muted-foreground/40">
                        Secure PKCE flow — credentials never shared with the app
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </>
          )}

          {/* OAuth 2.0 not configured — no OAuth option at all */}
          {!oauth2Available && !isLoadingConfig && (
            <div className="p-3 rounded-xl bg-secondary/10 border border-border/10 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
              <p className="text-[10px] text-muted-foreground/30">
                Cookie-based connection is the simplest method. No OAuth setup needed.
              </p>
            </div>
          )}

          {/* Loading config state */}
          {isLoadingConfig && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground/50">Checking available connection methods...</span>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
