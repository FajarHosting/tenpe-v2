import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Minus,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { StoreHeader } from '../components/layout/StoreHeader.tsx';
import {
  Button,
  EmptyState,
  ErrorState,
  Pagination,
  Price,
  ProductCard,
  ResilientImage,
  Select,
  Skeleton,
  StockStatus,
  TrustBar,
} from '../components/ui/DesignSystem.tsx';
import type { CategorySummary, OrderDetail, ProductItem } from '../types/commerce.ts';

interface CatalogResponse {
  items: ProductItem[];
  categories: CategorySummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export const ShopCatalogPage: React.FC = () => {
  const { searchParams, navigate, apiFetch } = useAuth();

  const initialQ = searchParams.get('q') || '';
  const initialCategory = searchParams.get('category') || 'all';
  const initialSort = searchParams.get('sort') || 'newest';
  const initialInStock = searchParams.get('inStockOnly') === 'true';
  const initialPage = Math.max(1, Number(searchParams.get('page') || 1));

  const [searchInput, setSearchInput] = useState(initialQ);
  const [query, setQuery] = useState(initialQ);
  const [category, setCategory] = useState(initialCategory);
  const [sort, setSort] = useState(initialSort);
  const [inStockOnly, setInStockOnly] = useState(initialInStock);
  const [page, setPage] = useState(initialPage);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncUrlParams = useCallback(
    (next: {
      q?: string;
      category?: string;
      sort?: string;
      inStockOnly?: boolean;
      page?: number;
    }) => {
      const params = new URLSearchParams();
      const qVal = next.q !== undefined ? next.q : query;
      const catVal = next.category !== undefined ? next.category : category;
      const sortVal = next.sort !== undefined ? next.sort : sort;
      const stockVal = next.inStockOnly !== undefined ? next.inStockOnly : inStockOnly;
      const pageVal = next.page !== undefined ? next.page : page;

      if (qVal) params.set('q', qVal);
      if (catVal && catVal !== 'all') params.set('category', catVal);
      if (sortVal && sortVal !== 'newest') params.set('sort', sortVal);
      if (stockVal) params.set('inStockOnly', 'true');
      if (pageVal > 1) params.set('page', String(pageVal));

      const qs = params.toString();
      window.history.replaceState({}, '', qs ? `/shop?${qs}` : '/shop');
    },
    [query, category, sort, inStockOnly, page]
  );

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (category && category !== 'all') params.set('category', category);
    if (sort) params.set('sort', sort);
    if (inStockOnly) params.set('inStockOnly', 'true');
    params.set('page', String(page));
    params.set('pageSize', '12');

    const res = await apiFetch<CatalogResponse>(`/api/shop/catalog?${params.toString()}`);
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Gagal memuat katalog produk dari server.');
      return;
    }
    setCatalog(res.data);
  }, [apiFetch, query, category, sort, inStockOnly, page]);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchInput.trim();
    setQuery(clean);
    setPage(1);
    syncUrlParams({ q: clean, page: 1 });
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setQuery('');
    setCategory('all');
    setSort('newest');
    setInStockOnly(false);
    setPage(1);
    window.history.replaceState({}, '', '/shop');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <StoreHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Katalog Pelanggan Terautentikasi</span>
              <span aria-hidden="true">·</span>
              <span>Stok Langsung Brankas Server</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Katalog Produk Digital Resmi
            </h1>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-96">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cari lisensi, SKU, atau layanan..."
                aria-label="Cari produk"
                className="w-full min-h-[44px] pl-10 pr-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <Button type="submit" variant="secondary" size="md">
              Cari
            </Button>
          </form>
        </div>

        {/* Interactive Filter Controls Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4">
          {/* Segmented Category Filter Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            <button
              type="button"
              onClick={() => {
                setCategory('all');
                setPage(1);
                syncUrlParams({ category: 'all', page: 1 });
              }}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                category === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua Kategori
            </button>
            {catalog?.categories?.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setCategory(cat.slug);
                  setPage(1);
                  syncUrlParams({ category: cat.slug, page: 1 });
                }}
                className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  category === cat.slug
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none min-h-[38px] px-3 rounded-lg border border-slate-200 bg-[#F8FAFC]">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => {
                  const next = e.target.checked;
                  setInStockOnly(next);
                  setPage(1);
                  syncUrlParams({ inStockOnly: next, page: 1 });
                }}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
              />
              <span>Hanya Stok Tersedia</span>
            </label>

            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
              <select
                aria-label="Urutkan produk"
                value={sort}
                onChange={(e) => {
                  const nextSort = e.target.value;
                  setSort(nextSort);
                  setPage(1);
                  syncUrlParams({ sort: nextSort, page: 1 });
                }}
                className="min-h-[38px] px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-emerald-600"
              >
                <option value="newest">Terbaru</option>
                <option value="price_asc">Harga: Rendah ke Tinggi</option>
                <option value="price_desc">Harga: Tinggi ke Rendah</option>
                <option value="name_asc">Nama: A - Z</option>
              </select>
            </div>
          </div>
        </div>

        {/* Catalog Grid State */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="bg-white border border-slate-200 rounded-xl p-4 space-y-4"
              >
                <Skeleton className="aspect-[4/3] w-full" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void fetchCatalog()} />
        ) : !catalog || catalog.items.length === 0 ? (
          <EmptyState
            title="Produk Tidak Ditemukan"
            description="Tidak ada produk yang cocok dengan kata kunci atau filter kategori yang Anda pilih."
            actionLabel="Reset Semua Filter"
            onAction={handleResetFilters}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {catalog.items.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onSelect={(slug) => navigate(`/product/${slug}`)}
                />
              ))}
            </div>

            <Pagination
              page={catalog.pagination.page}
              totalPages={catalog.pagination.totalPages}
              onPageChange={(nextPage) => {
                setPage(nextPage);
                syncUrlParams({ page: nextPage });
              }}
            />
          </>
        )}

        <TrustBar />
      </main>
    </div>
  );
};

export const ProductDetailPage: React.FC<{ slug: string }> = ({ slug }) => {
  const { navigate, apiFetch } = useAuth();
  const [product, setProduct] = useState<ProductItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<ProductItem>(`/api/shop/products/${encodeURIComponent(slug)}`);
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Produk tidak ditemukan.');
      return;
    }
    setProduct(res.data);
    setQuantity(1);
  }, [apiFetch, slug]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  const maxOrderable = product ? Math.min(10, Math.max(0, product.stockCount)) : 0;
  const isOutOfStock = !product || product.stockCount <= 0;
  const gatewayDisabled = product?.paymentGatewayReady === false;

  const handleProceedToCheckout = () => {
    if (!product || isOutOfStock || gatewayDisabled) return;
    navigate(`/checkout?product=${encodeURIComponent(product.slug)}&qty=${quantity}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] pb-24 lg:pb-12">
      <StoreHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <button
            type="button"
            onClick={() => navigate('/shop')}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer min-h-[40px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Katalog Toko</span>
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 space-y-4">
              <Skeleton className="aspect-[4/3] w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
            <div className="lg:col-span-5">
              <Skeleton className="h-96 w-full rounded-xl" />
            </div>
          </div>
        ) : error || !product ? (
          <ErrorState
            message={error || 'Detail produk tidak tersedia.'}
            onRetry={() => void fetchDetail()}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Visual & Full Specifications */}
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <ResilientImage
                  src={product.imageUrl}
                  alt={product.name}
                  aspectClass="aspect-[4/3]"
                />
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
                <div className="space-y-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Deskripsi & Spesifikasi Layanan
                  </h2>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                    {product.description}
                  </p>
                </div>

                <div className="pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <p className="text-slate-500">Masa Aktif Lisensi</p>
                    <p className="font-semibold text-slate-900 mt-0.5">{product.durationLabel}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Garansi Resmi</p>
                    <p className="font-semibold text-slate-900 mt-0.5 tabular-nums">
                      {product.warrantyDays} Hari
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Kode SKU</p>
                    <p className="font-mono font-semibold text-slate-900 mt-0.5">{product.sku}</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-100 space-y-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Ketentuan Pembelian & Penggunaan
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                    {product.termsAndConditions}
                  </p>
                </div>

                {product.warrantyTerms && (
                  <div className="pt-6 border-t border-slate-100 space-y-1.5">
                    <h3 className="text-sm font-bold text-slate-900">Ketentuan Garansi</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {product.warrantyTerms}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Contiguous Sticky Purchase Module */}
            <div className="lg:col-span-5 lg:sticky lg:top-24 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="uppercase tracking-wider font-medium">
                    {product.categoryName}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{product.sku}</span>
                </div>

                <h1 className="text-xl font-bold text-slate-900 leading-snug">{product.name}</h1>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {product.shortDescription}
                </p>
              </div>

              <div className="py-4 border-y border-slate-100 flex items-baseline justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500">Harga per Unit</p>
                  <Price amount={product.price} size="xl" className="text-slate-900" />
                </div>
                <StockStatus stockCount={product.stockCount} />
              </div>

              {isOutOfStock ? (
                <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 space-y-1">
                  <p className="font-bold">Stok Produk Habis</p>
                  <p>
                    Seluruh unit di brankas untuk produk ini telah habis terjual atau sedang
                    direservasi. Pembelian dinonaktifkan hingga Admin menambahkan batch stok
                    baru.
                  </p>
                </div>
              ) : gatewayDisabled ? (
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
                  <p className="font-bold">Konfigurasi Pembayaran Belum Siap</p>
                  <p>
                    Gateway QRIS saat ini sedang dinonaktifkan sementara oleh Administrator.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">Jumlah Unit</span>
                    <div className="inline-flex items-center border border-slate-300 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        disabled={quantity <= 1}
                        aria-label="Kurangi jumlah"
                        className="w-10 h-10 flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-12 text-center font-mono text-sm font-semibold tabular-nums">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.min(maxOrderable, q + 1))}
                        disabled={quantity >= maxOrderable}
                        aria-label="Tambah jumlah"
                        className="w-10 h-10 flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between pt-2">
                    <span className="text-xs text-slate-600">Estimasi Subtotal</span>
                    <Price amount={product.price * quantity} size="lg" className="text-slate-900" />
                  </div>
                </div>
              )}

              <Button
                variant="primary"
                size="lg"
                disabled={isOutOfStock || gatewayDisabled}
                onClick={handleProceedToCheckout}
                className="w-full"
              >
                <span>
                  {isOutOfStock
                    ? 'Stok Habis — Pembelian Dinonaktifkan'
                    : 'Lanjut ke Checkout QRIS'}
                </span>
                {!isOutOfStock && <ArrowRight className="w-4 h-4" />}
              </Button>

              <div className="space-y-2 pt-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Stok divalidasi ulang secara atomik saat membuat order</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Pengiriman otomatis ke WhatsApp setelah pembayaran sah</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Sticky Bottom Purchase Bar on Mobile */}
      {product && !loading && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] text-slate-500">Total ({quantity} unit)</p>
            <Price amount={product.price * quantity} size="md" className="text-slate-900" />
          </div>
          <Button
            variant="primary"
            size="md"
            disabled={isOutOfStock || gatewayDisabled}
            onClick={handleProceedToCheckout}
          >
            {isOutOfStock ? 'Stok Habis' : 'Checkout QRIS'}
          </Button>
        </div>
      )}
    </div>
  );
};

export const CheckoutPage: React.FC = () => {
  const { user, searchParams, navigate, apiFetch, showToast } = useAuth();
  const productSlug = searchParams.get('product') || '';
  const initialQty = Math.max(1, Math.min(10, Number(searchParams.get('qty') || 1)));

  const [product, setProduct] = useState<ProductItem | null>(null);
  const [quantity, setQuantity] = useState<number>(initialQty);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unique idempotency key per checkout view/quantity to prevent duplicate order submission
  const idempotencyKey = useMemo(
    () =>
      `idem_${user?.id || 'guest'}_${productSlug}_${quantity}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    [user?.id, productSlug, quantity]
  );

  const fetchProductForCheckout = useCallback(async () => {
    if (!productSlug) {
      setLoading(false);
      setError('Produk belum dipilih. Silakan pilih produk dari katalog terlebih dahulu.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await apiFetch<ProductItem>(
      `/api/shop/products/${encodeURIComponent(productSlug)}`
    );
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Produk tidak ditemukan.');
      return;
    }
    setProduct(res.data);
    if (res.data.stockCount > 0 && quantity > res.data.stockCount) {
      setQuantity(res.data.stockCount);
    }
  }, [apiFetch, productSlug, quantity]);

  useEffect(() => {
    void fetchProductForCheckout();
  }, [fetchProductForCheckout]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || product.stockCount < quantity) return;

    setSubmitting(true);
    setError(null);
    const res = await apiFetch<OrderDetail>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        productId: product.id,
        quantity,
        idempotencyKey,
        notes: notes.trim() || undefined,
      }),
    });
    setSubmitting(false);

    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Gagal membuat pesanan. Silakan coba kembali.');
      void fetchProductForCheckout();
      return;
    }

    showToast({
      type: 'success',
      title: 'Order Berhasil Dibuat',
      message: `Tagihan QRIS ${res.data.orderNumber} siap dibayar.`,
    });
    navigate(`/orders/${res.data.id}`, { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <StoreHeader />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div>
          <button
            type="button"
            onClick={() =>
              productSlug ? navigate(`/product/${productSlug}`) : navigate('/shop')
            }
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer min-h-[40px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali</span>
          </button>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">Checkout & Konfirmasi Pesanan</h1>
          <p className="text-xs text-slate-600">
            Harga dihitung secara otoritatif di server dan stok direservasi secara atomik saat
            tagihan QRIS diterbitkan.
          </p>
        </div>

        {loading ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : error && !product ? (
          <EmptyState
            title="Checkout Tidak Dapat Dilanjutkan"
            description={error}
            actionLabel="Buka Katalog Produk"
            onAction={() => navigate('/shop')}
          />
        ) : product ? (
          <form onSubmit={handleCreateOrder} className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-7 space-y-6">
              {error && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium"
                >
                  {error}
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-bold text-slate-900">1. Detail Produk & Kuantitas</h2>
                <div className="flex items-start gap-4">
                  <div className="w-24 shrink-0 rounded-lg overflow-hidden border border-slate-200">
                    <ResilientImage
                      src={product.imageUrl}
                      alt={product.name}
                      aspectClass="aspect-[4/3]"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-xs text-slate-500">
                      {product.categoryName} · {product.durationLabel}
                    </p>
                    <h3 className="text-sm font-bold text-slate-900">{product.name}</h3>
                    <StockStatus stockCount={product.stockCount} />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Jumlah Pembelian</span>
                  <Select
                    value={String(quantity)}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-32"
                  >
                    {Array.from(
                      { length: Math.min(10, Math.max(1, product.stockCount)) },
                      (_, i) => i + 1
                    ).map((num) => (
                      <option key={num} value={num}>
                        {num} Unit
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-bold text-slate-900">
                  2. Tujuan Pengiriman Lisensi Privat
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-slate-200">
                    <p className="text-slate-500">Nomor WhatsApp Penerima</p>
                    <p className="font-mono font-bold text-slate-900 mt-1">{user?.whatsapp}</p>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-slate-200">
                    <p className="text-slate-500">Alamat Email Akun</p>
                    <p className="font-mono font-bold text-slate-900 mt-1 truncate">
                      {user?.email}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Kredensial produk hanya dikirimkan ke nomor WhatsApp di atas dan halaman Detail
                  Pesanan akun Anda setelah status pembayaran terverifikasi sah.
                </p>

                <div className="space-y-1.5 pt-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Catatan Pesanan (Opsional)
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Catatan tambahan untuk arsip pesanan Anda..."
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>
            </div>

            <div className="md:col-span-5">
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 sticky top-24">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                  <QrCode className="w-4 h-4" />
                  <span>Metode Pembayaran: QRIS Nasional</span>
                </div>

                <div className="space-y-3 text-xs border-y border-slate-100 py-4">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Harga Satuan (Server)</span>
                    <Price amount={product.price} size="sm" />
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Kuantitas</span>
                    <span className="font-mono tabular-nums">{quantity}x</span>
                  </div>
                  <div className="flex items-baseline justify-between pt-2 border-t border-slate-100 text-slate-900 font-bold">
                    <span className="text-sm">Total Tagihan</span>
                    <Price amount={product.price * quantity} size="lg" />
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={submitting}
                  disabled={product.stockCount < quantity || product.paymentGatewayReady === false}
                  className="w-full"
                >
                  <span>Buat Pesanan & Tampilkan QRIS</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>

                <div className="space-y-1.5 text-[11px] text-slate-500">
                  <p className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Idempotency Key aktif mencegah tagihan ganda</span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Masa berlaku pembayaran QRIS 15 menit</span>
                  </p>
                </div>
              </div>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  );
};
