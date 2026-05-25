'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/lib/store';
import * as api from '@/lib/api';
import { Loader2, Key, Shield, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export function TwitterConnect() {
  const { user, setAuth, token } = useAppStore();
  const [authToken, setAuthToken] = useState('');
  const [ct0, setCt0] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'input' | 'validating' | 'syncing' | 'done'>('input');

  const handleConnect = async (e: React.FormEvent) => {
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

        toast.success(`Connected as @${result.username || 'user'}`);
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

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center">
          <Key className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Connect X/Twitter</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          To fetch your bookmarks and saved content, we need your Twitter authentication cookies.
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
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onSubmit={handleConnect}
          className="space-y-4"
        >
          {/* Instructions */}
          <div className="p-4 rounded-2xl bg-card/60 border border-border/20">
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              How to get your cookies
            </h3>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
              <li>Open <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline inline-flex items-center gap-0.5">x.com<ExternalLink className="w-2.5 h-2.5" /></a> and log in</li>
              <li>Open browser DevTools (F12 or Cmd+Option+I)</li>
              <li>Go to Application → Cookies → https://x.com</li>
              <li>Find and copy the <code className="px-1 py-0.5 rounded bg-secondary/50 text-amber-400 font-mono">auth_token</code> value</li>
              <li>Find and copy the <code className="px-1 py-0.5 rounded bg-secondary/50 text-amber-400 font-mono">ct0</code> value</li>
            </ol>
            <p className="text-[10px] text-muted-foreground/60 mt-3">
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
              className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all font-mono text-sm"
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
              className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all font-mono text-sm"
              required
            />
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </motion.div>
          )}

          <motion.button
            type="submit"
            disabled={isLoading || !authToken || !ct0}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {step === 'validating' ? 'Validating...' : 'Syncing bookmarks...'}
              </>
            ) : (
              <>
                <Key className="w-4 h-4" />
                Connect & Sync
              </>
            )}
          </motion.button>
        </motion.form>
      )}
    </div>
  );
}
