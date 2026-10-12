import React, { useState } from 'react';
import {
  Bell,
  LogOut,
  Menu,
  Package,
  Shield,
  ShoppingBag,
  User,
  X,
  Briefcase,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button, formatDateTime } from '../ui/DesignSystem.tsx';

export const StoreHeader: React.FC = () => {
  const {
    user,
    currentPath,
    navigate,
    logout,
    notifications,
    unreadCount,
    markAllNotificationsRead,
  } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          AdViora
        </a>

        {/* Zone 2: Authenticated Store Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="/shop"
            onClick={(e) => {
              e.preventDefault();
              navigate('/shop');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 ${
              currentPath.startsWith('/shop') || currentPath.startsWith('/product')
                ? 'text-slate-900 border-b-2 border-emerald-600 font-semibold'
                : ''
            }`}
          >
            Katalog Toko
          </a>
          <a
            href="/orders"
            onClick={(e) => {
              e.preventDefault();
              navigate('/orders');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 ${
              currentPath.startsWith('/orders')
                ? 'text-slate-900 border-b-2 border-emerald-600 font-semibold'
                : ''
            }`}
          >
            Pesanan Saya
          </a>
          <a
            href="/dashboard"
            onClick={(e) => {
              e.preventDefault();
              navigate('/dashboard');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 ${
              currentPath === '/dashboard'
                ? 'text-slate-900 border-b-2 border-emerald-600 font-semibold'
                : ''
            }`}
          >
            Akun & Keamanan
          </a>
          {(user?.role === 'PARTNER' || user?.role === 'ADMIN') && (
            <a
              href="/partner"
              onClick={(e) => {
                e.preventDefault();
                navigate('/partner');
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 ${
                currentPath.startsWith('/partner')
                  ? 'text-slate-900 border-b-2 border-emerald-600 font-semibold'
                  : ''
              }`}
            >
              Partner Hub
            </a>
          )}
          {user?.role === 'ADMIN' && (
            <a
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                navigate('/admin');
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 ${
                currentPath.startsWith('/admin')
                  ? 'text-emerald-700 border-b-2 border-emerald-600 font-semibold'
                  : ''
              }`}
            >
              Admin Console
            </a>
          )}
        </nav>

        {/* Zone 3: Notification Center & Account Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {user && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  const next = !notifOpen;
                  setNotifOpen(next);
                  if (next && unreadCount > 0) {
                    void markAllNotificationsRead();
                  }
                }}
                aria-label="Pusat Notifikasi"
                className="relative min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="ml-1 text-[11px] font-mono font-bold text-emerald-700 tabular-nums">
                    ({unreadCount})
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-sm p-4 z-50">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-900">
                      Notifikasi Sistem & Stok
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Tutup
                    </button>
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 my-1">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-500 py-6 text-center">
                        Belum ada pemberitahuan baru.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            setNotifOpen(false);
                            if (n.linkUrl) navigate(n.linkUrl);
                          }}
                          className="py-3 px-1 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span className="font-medium text-slate-700">{n.category}</span>
                            <span>{formatDateTime(n.createdAt)}</span>
                          </div>
                          <p className="text-xs font-semibold text-slate-900 mt-0.5">{n.title}</p>
                          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                            {n.message}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {user ? (
            <div className="hidden sm:flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span>@{user.username}</span>
                <span aria-hidden="true">·</span>
                <span className="text-slate-500">{user.role}</span>
              </button>
              <Button variant="outline" size="sm" onClick={() => void logout()}>
                <LogOut className="w-3.5 h-3.5" />
                <span>Keluar</span>
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={() => navigate('/login')}>
              Masuk Akun
            </Button>
          )}

          {/* Mobile Drawer Toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Menu Navigasi"
            className="md:hidden min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2">
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              navigate('/shop');
            }}
            className="w-full min-h-[44px] px-3 py-2 rounded-lg text-left text-sm font-medium text-slate-800 hover:bg-slate-50 flex items-center gap-2.5"
          >
            <ShoppingBag className="w-4 h-4 text-slate-500" />
            <span>Katalog Toko</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              navigate('/orders');
            }}
            className="w-full min-h-[44px] px-3 py-2 rounded-lg text-left text-sm font-medium text-slate-800 hover:bg-slate-50 flex items-center gap-2.5"
          >
            <Package className="w-4 h-4 text-slate-500" />
            <span>Pesanan Saya</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              navigate('/dashboard');
            }}
            className="w-full min-h-[44px] px-3 py-2 rounded-lg text-left text-sm font-medium text-slate-800 hover:bg-slate-50 flex items-center gap-2.5"
          >
            <User className="w-4 h-4 text-slate-500" />
            <span>Akun & Keamanan</span>
          </button>
          {(user?.role === 'PARTNER' || user?.role === 'ADMIN') && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                navigate('/partner');
              }}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg text-left text-sm font-medium text-slate-800 hover:bg-slate-50 flex items-center gap-2.5"
            >
              <Briefcase className="w-4 h-4 text-slate-500" />
              <span>Partner Hub B2B</span>
            </button>
          )}
          {user?.role === 'ADMIN' && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                navigate('/admin');
              }}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg text-left text-sm font-semibold text-emerald-700 hover:bg-emerald-50 flex items-center gap-2.5"
            >
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>Admin Console</span>
            </button>
          )}
          {user && (
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Masuk sebagai <strong className="text-slate-800">@{user.username}</strong>
              </span>
              <Button variant="outline" size="sm" onClick={() => void logout()}>
                Keluar
              </Button>
            </div>
          )}
        </div>
      )}
    </header>
  );
};
