import React, { useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { LoginPage, RegisterPage, PartnerProgramPage } from './pages/AuthPages.tsx';
import { ShopCatalogPage, ProductDetailPage, CheckoutPage } from './pages/ShopPages.tsx';
import {
  OrdersListPage,
  OrderDetailPage,
  CustomerDashboardPage,
} from './pages/OrderPages.tsx';
import { PartnerPortalPage } from './pages/PartnerPortalPage.tsx';
import { AdminDashboardPage } from './pages/AdminDashboardPage.tsx';
import { Button, Skeleton } from './components/ui/DesignSystem.tsx';
import { ShieldAlert } from 'lucide-react';

const AppRouter: React.FC = () => {
  const { user, loadingAuth, currentPath, searchParams, navigate } = useAuth();

  const fullCurrentUrl =
    currentPath + (searchParams.toString() ? `?${searchParams.toString()}` : '');

  const isProtectedPath =
    currentPath === '/shop' ||
    currentPath === '/store' ||
    currentPath.startsWith('/product/') ||
    currentPath === '/checkout' ||
    currentPath === '/orders' ||
    currentPath.startsWith('/orders/') ||
    currentPath === '/dashboard' ||
    currentPath === '/partner' ||
    currentPath.startsWith('/partner/') ||
    currentPath === '/admin' ||
    currentPath.startsWith('/admin/');

  useEffect(() => {
    if (loadingAuth) return;

    if (!user && isProtectedPath) {
      navigate(`/login?returnTo=${encodeURIComponent(fullCurrentUrl)}`, { replace: true });
      return;
    }

    if (user && (currentPath === '/login' || currentPath === '/register')) {
      const returnTo = searchParams.get('returnTo');
      const target =
        returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
          ? returnTo
          : user.role === 'ADMIN'
            ? '/admin'
            : user.role === 'PARTNER'
              ? '/partner'
              : '/shop';
      navigate(target, { replace: true });
    }
  }, [loadingAuth, user, isProtectedPath, currentPath, fullCurrentUrl, navigate, searchParams]);

  // 1. Public Routes
  if (currentPath === '/') {
    return <LandingPage />;
  }

  if (currentPath === '/partner-program') {
    return <PartnerProgramPage />;
  }

  if (currentPath === '/login') {
    return <LoginPage />;
  }

  if (currentPath === '/register') {
    return <RegisterPage />;
  }

  // 2. Loading Auth State for Protected Routes
  if (loadingAuth || (!user && isProtectedPath)) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  // 3. Protected Customer & Store Routes
  if (currentPath === '/shop' || currentPath === '/store') {
    return <ShopCatalogPage />;
  }

  if (currentPath.startsWith('/product/')) {
    const slug = decodeURIComponent(currentPath.replace('/product/', '').split('/')[0] || '');
    return <ProductDetailPage slug={slug} />;
  }

  if (currentPath === '/checkout') {
    return <CheckoutPage />;
  }

  if (currentPath === '/orders') {
    return <OrdersListPage />;
  }

  if (currentPath.startsWith('/orders/')) {
    const orderId = decodeURIComponent(currentPath.replace('/orders/', '').split('/')[0] || '');
    return <OrderDetailPage orderId={orderId} />;
  }

  if (currentPath === '/dashboard') {
    return <CustomerDashboardPage />;
  }

  // 4. Protected Partner B2B Portal
  if (currentPath === '/partner' || currentPath.startsWith('/partner/')) {
    if (user?.role !== 'PARTNER' && user?.role !== 'ADMIN') {
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
            <ShieldAlert className="w-8 h-8 text-amber-600 mx-auto" />
            <h1 className="text-lg font-bold text-slate-900">Akses Khusus Partner B2B</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Akun Anda saat ini terdaftar sebagai pelanggan ritel ({user?.role}). Untuk
              mengakses PartnerHub, ajukan permohonan kemitraan terlebih dahulu.
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/shop')}>
                Ke Katalog Toko
              </Button>
              <Button variant="primary" size="sm" onClick={() => navigate('/partner-program')}>
                Daftar Program Partner
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return <PartnerPortalPage />;
  }

  // 5. Protected Admin Console (/admin/*)
  if (currentPath === '/admin' || currentPath.startsWith('/admin/')) {
    if (user?.role !== 'ADMIN') {
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
          <div className="bg-white border border-red-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
            <ShieldAlert className="w-8 h-8 text-red-600 mx-auto" />
            <h1 className="text-lg font-bold text-slate-900">403 — Akses Administrator Ditolak</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Area ini hanya dapat diakses oleh akun dengan otorisasi ADMIN yang terverifikasi di
              server.
            </p>
            <Button variant="primary" size="sm" onClick={() => navigate('/shop')}>
              Kembali ke Katalog Toko
            </Button>
          </div>
        </div>
      );
    }
    return <AdminDashboardPage />;
  }

  // 404 Not Found Fallback
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
        <p className="font-mono text-xs font-bold text-emerald-700">404 NOT FOUND</p>
        <h1 className="text-lg font-bold text-slate-900">Halaman Tidak Ditemukan</h1>
        <p className="text-xs text-slate-600">
          Alamat URL yang Anda tuju tidak tersedia di platform AdViora.
        </p>
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>
            Ke Beranda Utama
          </Button>
          {user && (
            <Button variant="primary" size="sm" onClick={() => navigate('/shop')}>
              Buka Katalog Toko
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
