import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Box,
  CheckCircle2,
  Database,
  Megaphone,
  Package,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { StoreHeader } from '../components/layout/StoreHeader.tsx';
import {
  Button,
  Dialog,
  ErrorState,
  Input,
  OrderStatusLabel,
  Price,
  Select,
  Skeleton,
  StockStatus,
  formatDateTime,
} from '../components/ui/DesignSystem.tsx';
import type { CategorySummary, ProductItem } from '../types/commerce.ts';

type AdminTab =
  | 'overview'
  | 'products'
  | 'orders'
  | 'customers'
  | 'warranty'
  | 'settings';

export const AdminDashboardPage: React.FC = () => {
  const { apiFetch, showToast } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Overview state
  const [overview, setOverview] = useState<Record<string, any> | null>(null);

  // Products & Stock state
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [stockAuditLogs, setStockAuditLogs] = useState<Array<Record<string, any>>>([]);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);

  // Product Form State
  const [pName, setPName] = useState('');
  const [pSlug, setPSlug] = useState('');
  const [pSku, setPSku] = useState('');
  const [pCategoryId, setPCategoryId] = useState('');
  const [pShortDesc, setPShortDesc] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pTerms, setPTerms] = useState('');
  const [pDuration, setPDuration] = useState('12 Bulan (365 Hari)');
  const [pWarrantyDays, setPWarrantyDays] = useState('365');
  const [pRetailPrice, setPRetailPrice] = useState('150000');
  const [pPartnerPrice, setPPartnerPrice] = useState('120000');
  const [pImageUrl, setPImageUrl] = useState(
    '/src/assets/images/product_cloud_workspace_1791793694973.jpg'
  );
  const [pPublished, setPPublished] = useState(true);
  const [savingProduct, setSavingProduct] = useState(false);

  // Restock Vault Modal State
  const [restockProduct, setRestockProduct] = useState<ProductItem | null>(null);
  const [restockLines, setRestockLines] = useState('');
  const [restockNote, setRestockNote] = useState('');
  const [savingRestock, setSavingRestock] = useState(false);

  // Orders State
  const [adminOrders, setAdminOrders] = useState<Array<Record<string, any>>>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [actionOrder, setActionOrder] = useState<Record<string, any> | null>(null);
  const [actionType, setActionType] = useState<'VERIFY_AND_FULFILL' | 'REFUND_ORDER'>(
    'VERIFY_AND_FULFILL'
  );
  const [actionAuditNote, setActionAuditNote] = useState('');
  const [runningOrderAction, setRunningOrderAction] = useState(false);

  // Customers & Partner Applications State
  const [customers, setCustomers] = useState<Array<Record<string, any>>>([]);
  const [partnerApps, setPartnerApps] = useState<Array<Record<string, any>>>([]);

  // Warranty Claims State
  const [warrantyClaims, setWarrantyClaims] = useState<Array<Record<string, any>>>([]);

  // Announcements & Outbox State
  const [announcements, setAnnouncements] = useState<Array<Record<string, any>>>([]);
  const [outboxItems, setOutboxItems] = useState<Array<Record<string, any>>>([]);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [flushingOutbox, setFlushingOutbox] = useState(false);

  const loadTabData = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (activeTab === 'overview') {
      const res = await apiFetch<Record<string, any>>('/api/admin/overview');
      setLoading(false);
      if (!res.ok || !res.data) {
        setError(res.error?.message || 'Gagal memuat ringkasan Admin.');
        return;
      }
      setOverview(res.data);
      return;
    }

    if (activeTab === 'products') {
      const [prodRes, auditRes] = await Promise.all([
        apiFetch<{ products: ProductItem[]; categories: CategorySummary[] }>('/api/admin/products'),
        apiFetch<Array<Record<string, any>>>('/api/admin/stock-audit'),
      ]);
      setLoading(false);
      if (!prodRes.ok || !prodRes.data) {
        setError(prodRes.error?.message || 'Gagal memuat daftar produk.');
        return;
      }
      setProducts(prodRes.data.products);
      setCategories(prodRes.data.categories);
      if (auditRes.ok && auditRes.data) setStockAuditLogs(auditRes.data);
      return;
    }

    if (activeTab === 'orders') {
      const params = new URLSearchParams();
      if (orderStatusFilter !== 'ALL') params.set('status', orderStatusFilter);
      if (orderSearch.trim()) params.set('q', orderSearch.trim());
      const res = await apiFetch<Array<Record<string, any>>>(
        `/api/admin/orders?${params.toString()}`
      );
      setLoading(false);
      if (!res.ok || !res.data) {
        setError(res.error?.message || 'Gagal memuat daftar pesanan.');
        return;
      }
      setAdminOrders(res.data);
      return;
    }

    if (activeTab === 'customers') {
      const [custRes, appRes] = await Promise.all([
        apiFetch<Array<Record<string, any>>>('/api/admin/customers'),
        apiFetch<Array<Record<string, any>>>('/api/admin/partner-applications'),
      ]);
      setLoading(false);
      if (custRes.ok && custRes.data) setCustomers(custRes.data);
      if (appRes.ok && appRes.data) setPartnerApps(appRes.data);
      return;
    }

    if (activeTab === 'warranty') {
      const res = await apiFetch<Array<Record<string, any>>>('/api/admin/warranty-claims');
      setLoading(false);
      if (res.ok && res.data) setWarrantyClaims(res.data);
      return;
    }

    if (activeTab === 'settings') {
      const [ovRes, annRes, outRes] = await Promise.all([
        apiFetch<Record<string, any>>('/api/admin/overview'),
        apiFetch<Array<Record<string, any>>>('/api/admin/announcements'),
        apiFetch<Array<Record<string, any>>>('/api/admin/whatsapp-outbox'),
      ]);
      setLoading(false);
      if (ovRes.ok && ovRes.data) setOverview(ovRes.data);
      if (annRes.ok && annRes.data) setAnnouncements(annRes.data);
      if (outRes.ok && outRes.data) setOutboxItems(outRes.data);
      return;
    }
  }, [activeTab, apiFetch, orderSearch, orderStatusFilter]);

  useEffect(() => {
    void loadTabData();
  }, [loadTabData]);

  const openCreateProductModal = () => {
    setEditingProduct(null);
    setPName('');
    setPSlug('');
    setPSku('');
    setPCategoryId(categories[0]?.id || 'cat_cloud_productivity');
    setPShortDesc('');
    setPDesc('');
    setPTerms('1. Lisensi resmi AdViora.\n2. Garansi penuh sesuai masa aktif.');
    setPDuration('12 Bulan (365 Hari)');
    setPWarrantyDays('365');
    setPRetailPrice('150000');
    setPPartnerPrice('120000');
    setPImageUrl('/src/assets/images/product_cloud_workspace_1791793694973.jpg');
    setPPublished(true);
    setProductModalOpen(true);
  };

  const openEditProductModal = (p: ProductItem) => {
    setEditingProduct(p);
    setPName(p.name);
    setPSlug(p.slug);
    setPSku(p.sku);
    setPCategoryId(p.categoryId);
    setPShortDesc(p.shortDescription);
    setPDesc(p.description || p.shortDescription);
    setPTerms(p.termsAndConditions || '');
    setPDuration(p.durationLabel);
    setPWarrantyDays(String(p.warrantyDays));
    setPRetailPrice(String(p.retailPrice));
    setPPartnerPrice(String(p.partnerPrice));
    setPImageUrl(p.imageUrl);
    setPPublished(p.isPublished !== false);
    setProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);
    const payload = {
      name: pName,
      slug: pSlug || pName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      sku: pSku,
      categoryId: pCategoryId,
      shortDescription: pShortDesc,
      description: pDesc,
      termsAndConditions: pTerms,
      durationLabel: pDuration,
      warrantyDays: Number(pWarrantyDays),
      warrantyTerms: `Garansi resmi ${pWarrantyDays} hari.`,
      imageUrl: pImageUrl,
      retailPrice: Number(pRetailPrice),
      partnerPrice: Number(pPartnerPrice),
      isPublished: pPublished,
    };

    const res = editingProduct
      ? await apiFetch(`/api/admin/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : await apiFetch('/api/admin/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

    setSavingProduct(false);
    if (!res.ok) {
      showToast({
        type: 'error',
        title: 'Gagal Menyimpan Produk',
        message: res.error?.message || 'Periksa kembali data produk.',
      });
      return;
    }

    setProductModalOpen(false);
    showToast({
      type: 'success',
      title: editingProduct ? 'Produk Diperbarui' : 'Produk Baru Ditambahkan',
    });
    void loadTabData();
  };

  const handleAddRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockProduct) return;
    setSavingRestock(true);
    const res = await apiFetch<{ added: number; newStock: number }>(
      `/api/admin/products/${restockProduct.id}/inventory`,
      {
        method: 'POST',
        body: JSON.stringify({
          credentialsList: restockLines,
          batchNote: restockNote || 'Penambahan Stok Brankas Admin',
        }),
      }
    );
    setSavingRestock(false);
    if (!res.ok || !res.data) {
      showToast({
        type: 'error',
        title: 'Gagal Menambah Stok',
        message: res.error?.message || 'Masukkan minimal 1 baris kredensial.',
      });
      return;
    }
    setRestockProduct(null);
    setRestockLines('');
    setRestockNote('');
    showToast({
      type: 'success',
      title: 'Stok Brankas Ditambahkan',
      message: `+${res.data.added} unit ditambahkan. Total tersedia: ${res.data.newStock} unit.`,
    });
    void loadTabData();
  };

  const handleExecuteOrderAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionOrder) return;
    setRunningOrderAction(true);
    const res = await apiFetch(`/api/admin/orders/${actionOrder.id}/action`, {
      method: 'POST',
      body: JSON.stringify({
        action: actionType,
        note: actionAuditNote,
      }),
    });
    setRunningOrderAction(false);
    if (!res.ok) {
      showToast({
        type: 'error',
        title: 'Tindakan Gagal',
        message: res.error?.message || 'Catatan audit wajib diisi.',
      });
      return;
    }
    setActionOrder(null);
    setActionAuditNote('');
    showToast({
      type: 'success',
      title: 'Tindakan Manual Berhasil',
      message: 'Status pesanan dan log audit telah diperbarui.',
    });
    void loadTabData();
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const res = await apiFetch(`/api/admin/customers/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: nextStatus,
        reason: `Perubahan status manual oleh Admin menjadi ${nextStatus}`,
      }),
    });
    if (!res.ok) {
      showToast({
        type: 'error',
        title: 'Gagal Mengubah Status Akun',
        message: res.error?.message,
      });
      return;
    }
    showToast({
      type: 'success',
      title: `Status Akun Diubah ke ${nextStatus}`,
    });
    void loadTabData();
  };

  const handleReviewPartnerApp = async (
    appId: string,
    decision: 'APPROVED' | 'REJECTED'
  ) => {
    const res = await apiFetch(`/api/admin/partner-applications/${appId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        reviewNote: `Ditinjau oleh Admin (${decision})`,
      }),
    });
    if (!res.ok) {
      showToast({ type: 'error', title: 'Gagal Memproses Pengajuan' });
      return;
    }
    showToast({
      type: 'success',
      title: `Pengajuan Partner ${decision}`,
    });
    void loadTabData();
  };

  const handleResolveWarranty = async (
    claimId: string,
    status: 'REPLACED' | 'REFUNDED' | 'REJECTED'
  ) => {
    const res = await apiFetch(`/api/admin/warranty-claims/${claimId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        resolutionNote: `Diselesaikan oleh Admin dengan status ${status}.`,
      }),
    });
    if (!res.ok) {
      showToast({ type: 'error', title: 'Gagal Menyelesaikan Klaim' });
      return;
    }
    showToast({ type: 'success', title: `Klaim Garansi Diperbarui (${status})` });
    void loadTabData();
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({
        title: annTitle,
        content: annContent,
        variant: 'INFO',
        targetAudience: 'ALL',
      }),
    });
    if (!res.ok) {
      showToast({ type: 'error', title: 'Gagal Membuat Pengumuman' });
      return;
    }
    setAnnTitle('');
    setAnnContent('');
    showToast({ type: 'success', title: 'Pengumuman Dipublikasikan' });
    void loadTabData();
  };

  const handleFlushWhatsAppOutbox = async () => {
    setFlushingOutbox(true);
    const res = await apiFetch<{ processed: number; sent: number; failed: number }>(
      '/api/admin/whatsapp-outbox/flush',
      { method: 'POST' }
    );
    setFlushingOutbox(false);
    if (res.ok && res.data) {
      showToast({
        type: 'info',
        title: 'Antrean Outbox WhatsApp Diproses',
        message: `Diproses: ${res.data.processed}, Terkirim: ${res.data.sent}, Tertunda: ${res.data.failed}`,
      });
      void loadTabData();
    }
  };

  const navItems: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Ringkasan & Audit', icon: <Activity className="w-4 h-4" /> },
    { id: 'products', label: 'Produk & Stok Brankas', icon: <Box className="w-4 h-4" /> },
    { id: 'orders', label: 'Pesanan & Fulfillment', icon: <Package className="w-4 h-4" /> },
    { id: 'customers', label: 'Pelanggan & Partner', icon: <Users className="w-4 h-4" /> },
    { id: 'warranty', label: 'Klaim Garansi', icon: <Shield className="w-4 h-4" /> },
    { id: 'settings', label: 'Pengumuman & Sistem', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <StoreHeader />

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
              Administrator Control Plane · RBAC Server-Verified
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
              AdViora Operations & Commerce Console
            </h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadTabData()}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Segarkan Data</span>
          </Button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {navItems.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === t.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <Skeleton className="h-96 w-full rounded-xl" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadTabData()} />
        ) : (
          <>
            {/* TAB 1: OVERVIEW & AUDIT */}
            {activeTab === 'overview' && overview && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                    <span className="text-xs text-slate-500">Total Revenue Terverifikasi</span>
                    <div>
                      <Price amount={overview.metrics.totalRevenue} size="xl" />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Dari {overview.metrics.completedOrders} pesanan lunas
                    </p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                    <span className="text-xs text-slate-500">Total Pesanan Masuk</span>
                    <p className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                      {overview.metrics.totalOrders}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Menunggu QRIS: {overview.metrics.pendingOrders}
                    </p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                    <span className="text-xs text-slate-500">Total Akun Pelanggan</span>
                    <p className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                      {overview.metrics.customerCount}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Mitra Partner B2B: {overview.metrics.partnerCount}
                    </p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                    <span className="text-xs text-slate-500">Status Bot WhatsApp v32</span>
                    <p className="text-sm font-mono font-bold text-slate-900 truncate">
                      {overview.systemStatus.waBotV32.statusText}
                    </p>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      Outbox Terkirim: {overview.systemStatus.waBotV32.queueStats.sent} · Antrean:{' '}
                      {overview.systemStatus.waBotV32.queueStats.pending +
                        overview.systemStatus.waBotV32.queueStats.retryable}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Low Stock Products */}
                  <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold text-slate-900">
                        Peringatan Stok Brankas Menipis (≤ 3 Unit)
                      </h2>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActiveTab('products')}
                      >
                        Kelola Stok
                      </Button>
                    </div>
                    {overview.lowStockProducts.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4">
                        Seluruh produk memiliki ketersediaan stok yang cukup.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-100 text-xs">
                        {overview.lowStockProducts.map((p: any) => (
                          <div
                            key={p.id}
                            className="py-3 flex items-center justify-between gap-4"
                          >
                            <div>
                              <p className="font-semibold text-slate-900">{p.name}</p>
                              <p className="font-mono text-slate-500">{p.sku}</p>
                            </div>
                            <StockStatus stockCount={p.stockCount} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Audit Logs Stream */}
                  <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <h2 className="text-sm font-bold text-slate-900">
                      Jejak Audit Keamanan & Operasional Terbaru
                    </h2>
                    <div className="overflow-x-auto max-h-80">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 pr-3">Waktu</th>
                            <th className="py-2 pr-3">Role</th>
                            <th className="py-2 pr-3">Aksi</th>
                            <th className="py-2 text-right">Entitas</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {overview.recentAuditLogs.map((log: any) => (
                            <tr key={log.id} className="hover:bg-slate-50">
                              <td className="py-2.5 pr-3 text-slate-500 tabular-nums whitespace-nowrap">
                                {formatDateTime(log.createdAt)}
                              </td>
                              <td className="py-2.5 pr-3 font-mono font-semibold text-slate-700">
                                {log.actorRole}
                              </td>
                              <td className="py-2.5 pr-3 font-mono text-emerald-700">
                                {log.action}
                              </td>
                              <td className="py-2.5 text-right font-mono text-slate-500">
                                {log.entityType}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: PRODUCTS & VAULT INVENTORY */}
            {activeTab === 'products' && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Daftar Produk & Manajemen Stok Brankas
                      </h2>
                      <p className="text-xs text-slate-500">
                        Angka stok dihitung langsung dari unit lisensi berstatus AVAILABLE di
                        brankas database.
                      </p>
                    </div>
                    <Button variant="primary" size="sm" onClick={openCreateProductModal}>
                      <Plus className="w-4 h-4" />
                      <span>Tambah Produk Baru</span>
                    </Button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-3 pr-4">Nama Produk & SKU</th>
                          <th className="py-3 pr-4">Kategori</th>
                          <th className="py-3 pr-4 text-right">Harga Ritel</th>
                          <th className="py-3 pr-4 text-right">Harga Partner</th>
                          <th className="py-3 pr-4 text-right">Stok Tersedia</th>
                          <th className="py-3 pr-4">Status</th>
                          <th className="py-3 text-right">Tindakan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {products.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="py-3 pr-4">
                              <p className="font-bold text-slate-900">{p.name}</p>
                              <p className="font-mono text-slate-500">
                                {p.sku} · {p.slug}
                              </p>
                            </td>
                            <td className="py-3 pr-4 text-slate-600">{p.categoryName}</td>
                            <td className="py-3 pr-4 text-right">
                              <Price amount={p.retailPrice} size="sm" />
                            </td>
                            <td className="py-3 pr-4 text-right">
                              <Price amount={p.partnerPrice} size="sm" />
                            </td>
                            <td className="py-3 pr-4 text-right font-mono font-bold tabular-nums">
                              {p.stockCount} unit
                            </td>
                            <td className="py-3 pr-4">
                              <span
                                className={`font-semibold ${
                                  p.isPublished ? 'text-emerald-700' : 'text-slate-400'
                                }`}
                              >
                                {p.isPublished ? 'Dipublikasikan' : 'Draft'}
                              </span>
                            </td>
                            <td className="py-3 text-right space-x-2 whitespace-nowrap">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setRestockProduct(p)}
                              >
                                + Isi Stok Brankas
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditProductModal(p)}
                              >
                                Edit
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Stock Audit Trail */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <h2 className="text-sm font-bold text-slate-900">
                    Audit Perubahan Stok Brankas (Stock Audit Log)
                  </h2>
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2.5 pr-4">Waktu</th>
                          <th className="py-2.5 pr-4">Produk</th>
                          <th className="py-2.5 pr-4">Tipe</th>
                          <th className="py-2.5 pr-4 text-right">Delta</th>
                          <th className="py-2.5 pr-4 text-right">Stok Akhir</th>
                          <th className="py-2.5">Keterangan Audit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {stockAuditLogs.map((sal) => (
                          <tr key={sal.id}>
                            <td className="py-2.5 pr-4 text-slate-500 tabular-nums whitespace-nowrap">
                              {formatDateTime(sal.createdAt)}
                            </td>
                            <td className="py-2.5 pr-4 font-semibold text-slate-900">
                              {sal.productName}
                            </td>
                            <td className="py-2.5 pr-4 font-mono font-semibold text-slate-700">
                              {sal.changeType}
                            </td>
                            <td
                              className={`py-2.5 pr-4 text-right font-mono font-bold tabular-nums ${
                                sal.delta >= 0 ? 'text-emerald-700' : 'text-amber-700'
                              }`}
                            >
                              {sal.delta > 0 ? `+${sal.delta}` : sal.delta}
                            </td>
                            <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                              {sal.newStock}
                            </td>
                            <td className="py-2.5 text-slate-600">{sal.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: ORDERS MANAGEMENT */}
            {activeTab === 'orders' && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2 overflow-x-auto">
                    {[
                      'ALL',
                      'PENDING_PAYMENT',
                      'COMPLETED',
                      'PROCESSING',
                      'EXPIRED',
                      'REFUNDED',
                    ].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setOrderStatusFilter(st)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap ${
                          orderStatusFilter === st
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="search"
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      placeholder="Cari No. Order / Username..."
                      className="min-h-[38px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    />
                    <Button variant="secondary" size="sm" onClick={() => void loadTabData()}>
                      Cari
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-3 pr-4">No. Order</th>
                        <th className="py-3 pr-4">Pembeli & WhatsApp</th>
                        <th className="py-3 pr-4">Produk</th>
                        <th className="py-3 pr-4 text-right">Total</th>
                        <th className="py-3 pr-4">Status Order</th>
                        <th className="py-3 pr-4">Pengiriman WA</th>
                        <th className="py-3 text-right">Tindakan Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {adminOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-slate-50">
                          <td className="py-3 pr-4 font-mono font-bold text-slate-900">
                            {o.orderNumber}
                            <div className="font-sans font-normal text-slate-500">
                              {formatDateTime(o.createdAt)}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <p className="font-semibold text-slate-900">
                              @{o.buyerUsername} ({o.buyerRole})
                            </p>
                            <p className="font-mono text-slate-500">{o.customerWhatsapp}</p>
                          </td>
                          <td className="py-3 pr-4 text-slate-800">
                            {o.productName} ({o.quantity}x)
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <Price amount={o.totalAmount} size="sm" />
                          </td>
                          <td className="py-3 pr-4">
                            <OrderStatusLabel status={o.status} />
                          </td>
                          <td className="py-3 pr-4 font-mono text-slate-600">
                            {o.whatsappDeliveryStatus || '-'}
                          </td>
                          <td className="py-3 text-right space-x-2 whitespace-nowrap">
                            {o.status === 'PENDING_PAYMENT' && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => {
                                  setActionOrder(o);
                                  setActionType('VERIFY_AND_FULFILL');
                                  setActionAuditNote('');
                                }}
                              >
                                Verifikasi & Penuhi
                              </Button>
                            )}
                            {(o.status === 'COMPLETED' || o.status === 'PAID') && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setActionOrder(o);
                                  setActionType('REFUND_ORDER');
                                  setActionAuditNote('');
                                }}
                              >
                                Refund
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 4: CUSTOMERS & PARTNER APPLICATIONS */}
            {activeTab === 'customers' && (
              <div className="space-y-6">
                {/* Partner Applications Queue */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-bold text-slate-900">
                    Antrean Verifikasi Pendaftaran Partner B2B
                  </h2>
                  {partnerApps.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Belum ada pengajuan pendaftaran Partner baru.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2.5 pr-4">Pendaftar & Usaha</th>
                            <th className="py-2.5 pr-4">Kontak</th>
                            <th className="py-2.5 pr-4">Rencana Distribusi</th>
                            <th className="py-2.5 pr-4">Status</th>
                            <th className="py-2.5 text-right">Keputusan Admin</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {partnerApps.map((app) => (
                            <tr key={app.id}>
                              <td className="py-3 pr-4">
                                <p className="font-bold text-slate-900">{app.businessName}</p>
                                <p className="text-slate-500">{app.applicantName}</p>
                              </td>
                              <td className="py-3 pr-4 font-mono text-slate-600">
                                <div>{app.email}</div>
                                <div>{app.whatsapp}</div>
                              </td>
                              <td className="py-3 pr-4 text-slate-600 max-w-xs">
                                <p className="font-semibold text-slate-800">
                                  {app.estimatedMonthlyVolume}
                                </p>
                                <p className="line-clamp-2">{app.useCase}</p>
                              </td>
                              <td className="py-3 pr-4 font-mono font-bold text-slate-800">
                                {app.status}
                              </td>
                              <td className="py-3 text-right space-x-2 whitespace-nowrap">
                                {app.status === 'PENDING_REVIEW' && (
                                  <>
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={() =>
                                        void handleReviewPartnerApp(app.id, 'APPROVED')
                                      }
                                    >
                                      Setujui
                                    </Button>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      onClick={() =>
                                        void handleReviewPartnerApp(app.id, 'REJECTED')
                                      }
                                    >
                                      Tolak
                                    </Button>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Registered Users Table */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-bold text-slate-900">
                    Manajemen Akun Pelanggan & Partner
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2.5 pr-4">Username & Email</th>
                          <th className="py-2.5 pr-4">WhatsApp</th>
                          <th className="py-2.5 pr-4">Role</th>
                          <th className="py-2.5 pr-4 text-right">Order</th>
                          <th className="py-2.5 pr-4 text-right">Total Belanja</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5 text-right">Kontrol</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {customers.map((c) => (
                          <tr key={c.id}>
                            <td className="py-3 pr-4">
                              <p className="font-mono font-bold text-slate-900">@{c.username}</p>
                              <p className="text-slate-500">{c.email}</p>
                            </td>
                            <td className="py-3 pr-4 font-mono text-slate-700">{c.whatsapp}</td>
                            <td className="py-3 pr-4 font-mono font-semibold text-slate-800">
                              {c.role}
                            </td>
                            <td className="py-3 pr-4 text-right font-mono tabular-nums">
                              {c.orderCount}
                            </td>
                            <td className="py-3 pr-4 text-right">
                              <Price amount={c.totalSpent} size="sm" />
                            </td>
                            <td className="py-3 pr-4">
                              <span
                                className={`font-semibold ${
                                  c.status === 'ACTIVE' ? 'text-emerald-700' : 'text-red-600'
                                }`}
                              >
                                {c.status}
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              {c.role !== 'ADMIN' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleToggleUserStatus(c.id, c.status)}
                                >
                                  {c.status === 'ACTIVE' ? 'Suspend Akun' : 'Aktifkan Kembali'}
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: WARRANTY CLAIMS */}
            {activeTab === 'warranty' && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="text-base font-bold text-slate-900">
                  Manajemen Klaim Garansi Pelanggan & Partner
                </h2>
                {warrantyClaims.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">
                    Belum ada klaim garansi yang masuk.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2.5 pr-4">Order & Pelanggan</th>
                          <th className="py-2.5 pr-4">Alasan & Bukti</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5 text-right">Tindakan Resolusi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {warrantyClaims.map((wc) => (
                          <tr key={wc.id}>
                            <td className="py-3 pr-4">
                              <p className="font-mono font-bold text-slate-900">
                                {wc.orderNumber}
                              </p>
                              <p className="text-slate-500">
                                @{wc.username} · {wc.whatsapp}
                              </p>
                            </td>
                            <td className="py-3 pr-4">
                              <p className="font-semibold text-slate-900">{wc.reason}</p>
                              <p className="text-slate-500">{wc.evidenceNote}</p>
                            </td>
                            <td className="py-3 pr-4 font-mono font-bold text-emerald-700">
                              {wc.status}
                            </td>
                            <td className="py-3 text-right space-x-2 whitespace-nowrap">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void handleResolveWarranty(wc.id, 'REPLACED')}
                              >
                                Ganti Unit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleResolveWarranty(wc.id, 'REFUNDED')}
                              >
                                Refund
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => void handleResolveWarranty(wc.id, 'REJECTED')}
                              >
                                Tolak
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 6: ANNOUNCEMENTS, GATEWAY STATUS & WHATSAPP V32 OUTBOX */}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Announcements Manager */}
                  <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                      <Megaphone className="w-4 h-4 text-emerald-600" />
                      <h2>Pengumuman Banner Toko</h2>
                    </div>

                    <form onSubmit={handleCreateAnnouncement} className="space-y-3">
                      <Input
                        label="Judul Pengumuman"
                        value={annTitle}
                        onChange={(e) => setAnnTitle(e.target.value)}
                        placeholder="Contoh: Pemeliharaan Terjadwal Gateway"
                        required
                      />
                      <Input
                        label="Isi Pesan Singkat"
                        value={annContent}
                        onChange={(e) => setAnnContent(e.target.value)}
                        placeholder="Teks informasi yang tampil di bagian atas beranda..."
                        required
                      />
                      <Button type="submit" variant="primary" size="sm">
                        Publikasikan Pengumuman
                      </Button>
                    </form>

                    <div className="divide-y divide-slate-100 pt-2 text-xs">
                      {announcements.map((a) => (
                        <div
                          key={a.id}
                          className="py-3 flex items-center justify-between gap-4"
                        >
                          <div>
                            <p className="font-bold text-slate-900">{a.title}</p>
                            <p className="text-slate-600">{a.content}</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              await apiFetch(`/api/admin/announcements/${a.id}`, {
                                method: 'DELETE',
                              });
                              void loadTabData();
                            }}
                          >
                            Hapus
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sanitized System & Pterodactyl Bot v32 Status */}
                  <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                      <Database className="w-4 h-4 text-emerald-600" />
                      <h2>Status Konfigurasi Pembayaran & Bot v32 (Sanitized)</h2>
                    </div>
                    <p className="text-xs text-slate-500">
                      Demi keamanan produksi, nilai secret/API key hanya dibaca dari environment
                      server dan tidak pernah dikirimkan ke antarmuka browser.
                    </p>

                    {overview?.systemStatus && (
                      <div className="space-y-2.5 text-xs border-y border-slate-100 py-4">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Mode Penyedia QRIS</span>
                          <span className="font-mono font-bold text-slate-900">
                            {overview.systemStatus.qrisProviderMode}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Merchant ID</span>
                          <span className="font-mono text-slate-900">
                            {overview.systemStatus.qrisMerchantId}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Webhook HMAC Secret</span>
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Terkonfigurasi di Server</span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Mode Pemenuhan Stok</span>
                          <span className="font-mono text-slate-900">
                            {overview.systemStatus.fulfillmentMode}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Status Bot Pterodactyl v32</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {overview.systemStatus.waBotV32.statusText}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-slate-600">
                        Proses Ulang Antrean Outbox WhatsApp v32
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={flushingOutbox}
                        onClick={() => void handleFlushWhatsAppOutbox()}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Flush Outbox Sekarang</span>
                      </Button>
                    </div>
                  </div>
                </div>

                {/* WhatsApp Outbox Table */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <h2 className="text-sm font-bold text-slate-900">
                    Antrean Pesan Keluar WhatsApp Bot v32 (Transactional Outbox)
                  </h2>
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2.5 pr-4">Waktu</th>
                          <th className="py-2.5 pr-4">Kanal</th>
                          <th className="py-2.5 pr-4">Tujuan</th>
                          <th className="py-2.5 pr-4">Tipe Event</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5">Keterangan / Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {outboxItems.map((ob) => (
                          <tr key={ob.id}>
                            <td className="py-2.5 pr-4 text-slate-500 tabular-nums whitespace-nowrap">
                              {formatDateTime(ob.createdAt)}
                            </td>
                            <td className="py-2.5 pr-4 font-mono font-semibold text-slate-800">
                              {ob.targetType}
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-slate-700">
                              {ob.recipient}
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-emerald-700">
                              {ob.eventType}
                            </td>
                            <td className="py-2.5 pr-4 font-mono font-bold">
                              {ob.status} ({ob.attempts}/{ob.maxAttempts})
                            </td>
                            <td className="py-2.5 text-slate-500">
                              {ob.lastError || (ob.sentAt ? `Terkirim ${formatDateTime(ob.sentAt)}` : 'Siap dikirim')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create / Edit Product Modal */}
      <Dialog
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title={editingProduct ? `Edit Produk: ${editingProduct.name}` : 'Tambah Produk Baru'}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Nama Produk"
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              required
            />
            <Input
              label="Kode SKU Unik"
              value={pSku}
              onChange={(e) => setPSku(e.target.value)}
              placeholder="ADV-CLD-001"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Slug URL"
              value={pSlug}
              onChange={(e) => setPSlug(e.target.value)}
              placeholder="cloud-workspace-pro"
              required
            />
            <Select
              label="Kategori"
              value={pCategoryId}
              onChange={(e) => setPCategoryId(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Harga Ritel (IDR)"
              type="number"
              value={pRetailPrice}
              onChange={(e) => setPRetailPrice(e.target.value)}
              required
            />
            <Input
              label="Harga Partner B2B (IDR)"
              type="number"
              value={pPartnerPrice}
              onChange={(e) => setPPartnerPrice(e.target.value)}
              required
            />
            <Input
              label="Label Durasi"
              value={pDuration}
              onChange={(e) => setPDuration(e.target.value)}
              required
            />
          </div>

          <Input
            label="Deskripsi Singkat (Tampil di Kartu Katalog)"
            value={pShortDesc}
            onChange={(e) => setPShortDesc(e.target.value)}
            required
          />

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">
              Deskripsi Lengkap
            </label>
            <textarea
              rows={3}
              value={pDesc}
              onChange={(e) => setPDesc(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">
              Syarat & Ketentuan Pembelian
            </label>
            <textarea
              rows={2}
              value={pTerms}
              onChange={(e) => setPTerms(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              required
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={pPublished}
                onChange={(e) => setPPublished(e.target.checked)}
              />
              <span>Publikasikan di Katalog Toko (/shop)</span>
            </label>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setProductModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={savingProduct}>
                Simpan Produk
              </Button>
            </div>
          </div>
        </form>
      </Dialog>

      {/* Restock Vault Inventory Modal */}
      <Dialog
        open={Boolean(restockProduct)}
        onClose={() => setRestockProduct(null)}
        title={`Tambah Stok Brankas: ${restockProduct?.name || ''}`}
        description="Masukkan 1 kode lisensi / kredensial per baris. Stok produk akan otomatis bertambah sesuai jumlah baris."
      >
        <form onSubmit={handleAddRestock} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Daftar Kredensial / Kode Lisensi Baru (1 per baris)
            </label>
            <textarea
              rows={5}
              value={restockLines}
              onChange={(e) => setRestockLines(e.target.value)}
              placeholder={`ADV-KEY-2026-0001\nADV-KEY-2026-0002\nADV-KEY-2026-0003`}
              className="w-full px-3.5 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              required
            />
          </div>
          <Input
            label="Catatan Batch Audit"
            value={restockNote}
            onChange={(e) => setRestockNote(e.target.value)}
            placeholder="Contoh: Batch Resmi Oktober 2026"
          />
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setRestockProduct(null)}>
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={savingRestock}>
              Simpan ke Brankas & Update Stok
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Manual Order Action Audit Dialog */}
      <Dialog
        open={Boolean(actionOrder)}
        onClose={() => setActionOrder(null)}
        title={
          actionType === 'VERIFY_AND_FULFILL'
            ? `Verifikasi Manual & Penuhi Order ${actionOrder?.orderNumber || ''}`
            : `Proses Refund Order ${actionOrder?.orderNumber || ''}`
        }
        description="Tindakan ini akan dicatat secara permanen di Audit Log beserta ID Admin Anda."
      >
        <form onSubmit={handleExecuteOrderAction} className="space-y-4">
          <Input
            label="Catatan Audit Wajib (Minimal 5 Karakter)"
            value={actionAuditNote}
            onChange={(e) => setActionAuditNote(e.target.value)}
            placeholder="Contoh: Mutasi rekening QRIS telah terkonfirmasi di dashboard merchant"
            required
          />
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setActionOrder(null)}>
              Batal
            </Button>
            <Button
              type="submit"
              variant={actionType === 'REFUND_ORDER' ? 'danger' : 'primary'}
              size="sm"
              loading={runningOrderAction}
            >
              Konfirmasi & Jalankan
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};
