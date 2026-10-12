import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import type { NotificationItem, UserProfile } from '../types/commerce.ts';

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  csrfToken: string | null;
  loadingAuth: boolean;
  currentPath: string;
  searchParams: URLSearchParams;
  notifications: NotificationItem[];
  unreadCount: number;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  refreshSession: () => Promise<UserProfile | null>;
  logout: () => Promise<void>;
  apiFetch: <T = unknown>(
    path: string,
    options?: RequestInit
  ) => Promise<{ ok: boolean; status: number; data?: T; error?: { code: string; message: string } }>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  refreshNotifications: () => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true);
  const [locationStr, setLocationStr] = useState<string>(
    () => window.location.pathname + window.location.search
  );
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const onPopState = () => {
      setLocationStr(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (options?.replace) {
      window.history.replaceState({}, '', to);
    } else {
      window.history.pushState({}, '', to);
    }
    setLocationStr(window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const showToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `tst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const apiFetch = useCallback(
    async <T = unknown>(
      path: string,
      options?: RequestInit
    ): Promise<{
      ok: boolean;
      status: number;
      data?: T;
      error?: { code: string; message: string };
    }> => {
      const headers = new Headers(options?.headers || {});
      if (!headers.has('Content-Type') && options?.body) {
        headers.set('Content-Type', 'application/json');
      }
      if (csrfToken && options?.method && options.method.toUpperCase() !== 'GET') {
        headers.set('X-CSRF-Token', csrfToken);
      }

      try {
        const res = await fetch(path, {
          ...options,
          headers,
          credentials: 'same-origin',
        });
        const json = await res.json().catch(() => ({}));
        return {
          ok: res.ok && json.ok !== false,
          status: res.status,
          data: (json.data !== undefined ? json.data : json) as T,
          error: json.error,
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          error: {
            code: 'NETWORK_ERROR',
            message:
              err instanceof Error ? err.message : 'Koneksi ke server terputus. Periksa jaringan Anda.',
          },
        };
      }
    },
    [csrfToken]
  );

  const refreshSession = useCallback(async (): Promise<UserProfile | null> => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const json = await res.json();
      if (res.ok && json.authenticated && json.user) {
        setUser(json.user);
        setCsrfToken(json.csrfToken || null);
        return json.user as UserProfile;
      } else {
        setUser(null);
        setCsrfToken(null);
        return null;
      }
    } catch {
      setUser(null);
      setCsrfToken(null);
      return null;
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    const res = await apiFetch<NotificationItem[]>('/api/notifications');
    if (res.ok && Array.isArray(res.data)) {
      setNotifications(res.data);
    }
  }, [user, apiFetch]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!user) return;
    await apiFetch('/api/notifications/mark-read', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, [user, apiFetch]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (user) {
      void refreshNotifications();
      const timer = setInterval(() => {
        void refreshNotifications();
      }, 20000);
      return () => clearInterval(timer);
    } else {
      setNotifications([]);
    }
  }, [user, refreshNotifications]);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setCsrfToken(null);
    setNotifications([]);
    showToast({
      type: 'info',
      title: 'Sesi Berakhir',
      message: 'Anda telah berhasil keluar dari akun AdViora.',
    });
    navigate('/', { replace: true });
  }, [apiFetch, navigate, showToast]);

  const qIndex = locationStr.indexOf('?');
  const currentPath = qIndex === -1 ? locationStr : locationStr.slice(0, qIndex);
  const searchParams = new URLSearchParams(qIndex === -1 ? '' : locationStr.slice(qIndex));
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        csrfToken,
        loadingAuth,
        currentPath,
        searchParams,
        notifications,
        unreadCount,
        navigate,
        refreshSession,
        logout,
        apiFetch,
        showToast,
        refreshNotifications,
        markAllNotificationsRead,
      }}
    >
      {children}

      {/* Non-intrusive Toast Stack */}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-start gap-3"
          >
            {t.type === 'success' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            )}
            {t.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            )}
            {t.type === 'info' && <Info className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-900">{t.title}</p>
              {t.message && <p className="text-xs text-slate-600 mt-0.5">{t.message}</p>}
            </div>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              aria-label="Tutup notifikasi"
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
