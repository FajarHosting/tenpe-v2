import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Lock,
  Package,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { StoreHeader } from '../components/layout/StoreHeader.tsx';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  OrderStatusLabel,
  Price,
  Skeleton,
  formatDateTime,
} from '../components/ui/DesignSystem.tsx';
import type { OrderDetail, OrderSummary } from '../types/commerce.ts';

/**
 * Deterministic visual QR matrix SVG generator from EMVCo QRIS payload string
 * so the QRIS screen never relies on fragile external QR image APIs.
 */
const QrisCodeSvg: React.FC<{ payload: string }> = ({ payload }) => {
  const size = 21;
  const cells: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        cells[r0 + r][c0 + c] = isBorder || isInner;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= size - 8;
      const inBottomLeft = r >= size - 8 && c < 8;
      if (inTopLeft || inTopRight || inBottomLeft) continue;

      const idx = (r * size + c) % Math.max(1, payload.length);
      const code = payload.charCodeAt(idx) + r * 17 + c * 31;
      cells[r][c] = code % 2 === 0;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size + 4} ${size + 4}`}
      className="w-48 h-48 mx-auto bg-white p-2 rounded-lg border border-slate-200"
      role="img"
      aria-label="Kode QRIS Pembayaran"
    >
      <rect width={size + 4} height={size + 4} fill="#FFFFFF" />
      {cells.map((row, rIdx) =>
        row.map((filled, cIdx) =>
          filled ? (
            <rect
              key={`${rIdx}-${cIdx}`}
              x={cIdx + 2}
              y={rIdx + 2}
              width={1}
              height={1}
              fill="#0F172A"
            />
          ) : null
        )
      )}
    </svg>
  );
};

export const OrdersListPage: React.FC = () => {
  const { navigate, apiFetch } = useAuth();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = statusFilter !== 'ALL' ? `?status=${encodeURIComponent(statusFilter)}` : '';
    const res = await apiFetch<OrderSummary[]>(`/api/orders${qs}`);
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Gagal memuat riwayat pesanan.');
      return;
    }
    setOrders(res.data);
  }, [apiFetch, statusFilter]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const filters = [
    { key: 'ALL', label: 'Semua Pesanan' },
    { key: 'PENDING_PAYMENT', label: 'Menunggu Pembayaran' },
    { key: 'COMPLETED', label: 'Selesai & Terkirim' },
    { key: 'EXPIRED', label: 'Kedaluwarsa' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <StoreHeader />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs text-slate-500">Arsip Transaksi Pribadi</p>
            <h1 className="text-2xl font-bold text-slate-900">Riwayat Pesanan Saya</h1>
          </div>
          <Button variant="primary" size="sm" onClick={() => navigate('/shop')}>
            <span>Belanja Produk Baru</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === f.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void fetchOrders()} />
        ) : orders.length === 0 ? (
          <EmptyState
            title="Belum Ada Riwayat Pesanan"
            description="Anda belum memiliki pesanan pada kategori status ini. Mulai jelajahi katalog untuk membuat pesanan baru."
            actionLabel="Jelajahi Katalog Produk"
            onAction={() => navigate('/shop')}
          />
        ) : (
          <div className="space-y-3">
            {orders.map((ord) => (
              <div
                key={ord.id}
                onClick={() => navigate(`/orders/${ord.id}`)}
                className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-bold text-slate-900">{ord.orderNumber}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDateTime(ord.createdAt)}</span>
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    {ord.productName}{' '}
                    <span className="font-mono font-normal text-slate-500">({ord.quantity}x)</span>
                  </h2>
                  <OrderStatusLabel status={ord.status} />
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                  <Price amount={ord.totalAmount} size="md" className="text-slate-900" />
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <span>Detail & Lisensi</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export const OrderDetailPage: React.FC<{ orderId: string }> = ({ orderId }) => {
  const { navigate, apiFetch, showToast } = useAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [simulatingWebhook, setSimulatingWebhook] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofNote, setProofNote] = useState('');
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofSubmitted, setProofSubmitted] = useState(false);

  // Warranty Claim Modal State
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  const [warrantyReason, setWarrantyReason] = useState('');
  const [warrantyEvidence, setWarrantyEvidence] = useState('');
  const [submittingWarranty, setSubmittingWarranty] = useState(false);

  const fetchOrderDetail = useCallback(async () => {
    const res = await apiFetch<OrderDetail>(`/api/orders/${encodeURIComponent(orderId)}`);
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Detail pesanan tidak dapat diakses.');
      return;
    }
    setOrder(res.data);
    setError(null);
  }, [apiFetch, orderId]);

  useEffect(() => {
    setLoading(true);
    void fetchOrderDetail();
  }, [fetchOrderDetail]);

  // Poll every 8s while order is PENDING_PAYMENT or PROCESSING
  useEffect(() => {
    if (!order) return;
    if (order.status === 'PENDING_PAYMENT' || order.status === 'PROCESSING') {
      const interval = setInterval(() => {
        void fetchOrderDetail();
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [order, fetchOrderDetail]);

  const handleCopyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(text);
      showToast({ type: 'success', title: 'Disalin ke Clipboard', message: label });
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      showToast({ type: 'error', title: 'Gagal Menyalin', message: 'Salin secara manual.' });
    }
  };

  const handleSubmitPaymentProof = async () => {
    if (!order || !proofFile) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(proofFile.type)) {
      showToast({ type: 'error', title: 'Format tidak didukung', message: 'Pilih gambar PNG, JPG, atau WebP.' });
      return;
    }
    if (proofFile.size > 5 * 1024 * 1024) {
      showToast({ type: 'error', title: 'File terlalu besar', message: 'Ukuran bukti maksimal 5 MB.' });
      return;
    }
    setProofSubmitting(true);
    try {
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('File tidak terbaca'));
        reader.onerror = () => reject(new Error('Gagal membaca gambar'));
        reader.readAsDataURL(proofFile);
      });
      const res = await apiFetch(`/api/orders/${encodeURIComponent(order.id)}/payment-proof`, {
        method: 'POST', body: JSON.stringify({ imageData, note: proofNote }),
      });
      if (!res.ok) {
        showToast({ type: 'error', title: 'Bukti gagal dikirim', message: res.error?.message || 'Coba kembali.' });
        return;
      }
      setProofSubmitted(true);
      showToast({ type: 'success', title: 'Bukti terkirim', message: 'Bukti masuk ke antrean WhatsApp admin untuk pemeriksaan manual.' });
    } catch (e) {
      showToast({ type: 'error', title: 'Upload gagal', message: e instanceof Error ? e.message : 'Periksa koneksi.' });
    } finally { setProofSubmitting(false); }
  };

  const handleSimulateGatewayWebhook = async () => {
    if (!order) return;
    setSimulatingWebhook(true);
    const res = await apiFetch<OrderDetail>(`/api/orders/${order.id}/sandbox-settle`, {
      method: 'POST',
    });
    setSimulatingWebhook(false);

    if (!res.ok || !res.data) {
      showToast({
        type: 'error',
        title: 'Verifikasi Webhook Gagal',
        message: res.error?.message || 'Gagal memproses callback.',
      });
      return;
    }
    setOrder(res.data);
    showToast({
      type: 'success',
      title: 'Webhook QRIS Terverifikasi',
      message: 'Pembayaran sah & lisensi produk telah diklaim secara atomik.',
    });
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    setCancelling(true);
    const res = await apiFetch<OrderDetail>(`/api/orders/${order.id}/cancel`, {
      method: 'POST',
    });
    setCancelling(false);
    setConfirmCancelOpen(false);
    if (!res.ok || !res.data) {
      showToast({
        type: 'error',
        title: 'Gagal Membatalkan',
        message: res.error?.message || 'Pesanan tidak dapat dibatalkan.',
      });
      return;
    }
    setOrder(res.data);
    showToast({
      type: 'info',
      title: 'Pesanan Dibatalkan',
      message: 'Reservasi stok telah dikembalikan ke brankas.',
    });
  };

  const handleSubmitWarranty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setSubmittingWarranty(true);
    const res = await apiFetch(`/api/orders/${order.id}/warranty-claim`, {
      method: 'POST',
      body: JSON.stringify({
        reason: warrantyReason,
        evidenceNote: warrantyEvidence,
      }),
    });
    setSubmittingWarranty(false);

    if (!res.ok) {
      showToast({
        type: 'error',
        title: 'Gagal Mengajukan Klaim',
        message: res.error?.message || 'Periksa kembali input Anda.',
      });
      return;
    }

    setWarrantyOpen(false);
    setWarrantyReason('');
    setWarrantyEvidence('');
    showToast({
      type: 'success',
      title: 'Klaim Garansi Terkirim',
      message: 'Tim Admin akan memeriksa klaim garansi pesanan Anda.',
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <StoreHeader />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/orders')}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer min-h-[40px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Semua Pesanan Saya</span>
          </button>

          {order && (
            <Button variant="outline" size="sm" onClick={() => void fetchOrderDetail()}>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Muat Ulang Status</span>
            </Button>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-96 w-full rounded-xl" />
        ) : error || !order ? (
          <ErrorState
            message={error || 'Pesanan tidak ditemukan.'}
            onRetry={() => void fetchOrderDetail()}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Order Summary, Delivered Credentials, & Timeline */}
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                  <div>
                    <p className="text-xs text-slate-500">Nomor Referensi Order</p>
                    <h1 className="text-lg font-mono font-bold text-slate-900">
                      {order.orderNumber}
                    </h1>
                  </div>
                  <OrderStatusLabel status={order.status} />
                </div>

                <div className="space-y-3">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-4 py-2 text-sm"
                    >
                      <div>
                        <p className="font-bold text-slate-900">{item.productName}</p>
                        <p className="text-xs text-slate-500">
                          {item.quantity} unit × <Price amount={item.unitPrice} size="sm" /> ·
                          Garansi {item.warrantyDays} Hari
                        </p>
                      </div>
                      <Price amount={item.totalPrice} size="md" className="text-slate-900" />
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-slate-100 space-y-1.5 text-xs">
                  {order.uniqueCode > 0 && (
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Kode Unik Rekonsiliasi</span>
                      <span className="font-mono tabular-nums">+{order.uniqueCode}</span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between text-slate-900 font-bold pt-1">
                    <span className="text-sm">Total Pembayaran</span>
                    <Price amount={order.totalAmount} size="lg" />
                  </div>
                </div>
              </div>

              {/* DELIVERED CREDENTIALS VAULT (Visible ONLY when Order is COMPLETED & PAID) */}
              {order.status === 'COMPLETED' &&
                order.fulfillment &&
                order.fulfillment.credentials.length > 0 && (
                  <div className="bg-white border border-emerald-300 rounded-xl p-6 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                          <KeyRound className="w-4 h-4" />
                          <span>Brankas Lisensi & Kredensial Anda</span>
                        </div>
                        <p className="text-xs text-slate-600">
                          Pembayaran telah diverifikasi sah. Berikut adalah kode lisensi resmi yang
                          diklaim khusus untuk pesanan Anda:
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {order.fulfillment.credentials.map((cred, idx) => (
                        <div
                          key={cred}
                          className="flex items-center justify-between gap-3 p-3.5 rounded-lg bg-slate-900 text-white font-mono text-xs"
                        >
                          <div className="truncate">
                            <span className="text-slate-400 mr-2">#{idx + 1}</span>
                            <span className="text-emerald-400 font-semibold">{cred}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyText(cred, `Kode lisensi #${idx + 1} berhasil disalin.`)
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-100 shrink-0 cursor-pointer"
                          >
                            {copiedKey === cred ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Salin</span>
                              </>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                      <span>
                        Tujuan WhatsApp Privat:{' '}
                        <strong className="font-mono text-slate-700">
                          {order.customerWhatsapp}
                        </strong>{' '}
                        ({order.fulfillment.whatsappDeliveryStatus})
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWarrantyOpen(true)}
                      >
                        Ajukan Klaim Garansi
                      </Button>
                    </div>
                  </div>
                )}

              {/* Order Status Audit Timeline */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-bold text-slate-900">
                  Jejak Audit & Riwayat Status Pesanan
                </h2>
                <div className="space-y-4">
                  {order.history.map((h) => (
                    <div
                      key={h.id}
                      className="flex items-start gap-3 text-xs pb-3 border-b border-slate-100 last:border-b-0 last:pb-0"
                    >
                      <div className="w-2 h-2 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                      <div className="flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-slate-900">
                            {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : h.toStatus}
                          </span>
                          <span className="text-slate-500">{formatDateTime(h.createdAt)}</span>
                        </div>
                        <p className="text-slate-600 leading-relaxed">{h.note}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: QRIS Payment Instructions & Verification Status */}
            <div className="lg:col-span-5 space-y-6">
              {order.status === 'PENDING_PAYMENT' && order.payment ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                  <div className="space-y-1 text-center">
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                      <QrCode className="w-4 h-4" />
                      <span>Instruksi Pembayaran QRIS</span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900">
                      Pindai Kode QRIS untuk Membayar
                    </h2>
                    <p className="text-xs text-slate-500">
                      Batas Waktu Pembayaran:{' '}
                      <strong className="text-slate-800">
                        {formatDateTime(order.expiresAt)}
                      </strong>
                    </p>
                  </div>

                  {order.payment.qrisUrl && (
                    <a href={order.payment.qrisUrl} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition hover:bg-emerald-700">
                      <QrCode className="h-4 w-4" /> Buka Link Pembayaran QRIS <ArrowRight className="h-4 w-4" />
                    </a>
                  )}
                  {!order.payment.qrisUrl && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                      Link QRIS belum dikonfigurasi. Hubungi admin toko; jangan melakukan pembayaran sebelum link resmi tersedia.
                    </div>
                  )}

                  <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-slate-200 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Merchant ID</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {order.payment.merchantId}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Referensi Tagihan</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {order.payment.providerReference}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between pt-2 border-t border-slate-200">
                      <span className="font-semibold text-slate-700">Nominal Harus Dibayar</span>
                      <Price amount={order.totalAmount} size="md" className="text-emerald-700" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Button
                      variant="secondary"
                      size="md"
                      className="w-full"
                      onClick={() => void fetchOrderDetail()}
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Periksa Status Pembayaran</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        void handleCopyText(
                          order.payment!.qrisPayload,
                          'String EMVCo QRIS disalin.'
                        )
                      }
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Salin String Payload QRIS</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-red-600 hover:text-red-700"
                      onClick={() => setConfirmCancelOpen(true)}
                    >
                      Batalkan Pesanan Ini
                    </Button>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                    <strong>Kebijakan Verifikasi Aman:</strong> Status pesanan tidak dapat diubah
                    secara manual dari browser. Sistem hanya memvalidasi pembayaran melalui
                    callback server-to-server ber-signature kriptografis dari penyedia QRIS.
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">Sudah membayar?</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">Kirim screenshot bukti transfer/QRIS. Bot v32 akan meneruskan detail pesanan dan tautan bukti ke nomor admin yang dikonfigurasi di environment. Status tetap menunggu sampai admin memeriksa pembayaran.</p>
                    </div>
                    {proofSubmitted ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">Bukti sudah dikirim untuk pemeriksaan admin. Jangan membayar ulang kecuali diminta admin.</div>
                    ) : (
                      <>
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setProofFile(e.target.files?.[0] || null)} className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-700" aria-label="Pilih screenshot bukti pembayaran" />
                        <textarea value={proofNote} onChange={(e) => setProofNote(e.target.value)} maxLength={500} rows={2} placeholder="Catatan opsional, misalnya nama pengirim..." className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                        <Button variant="primary" size="md" className="w-full" loading={proofSubmitting} disabled={!proofFile} onClick={() => void handleSubmitPaymentProof()}>Kirim Bukti ke Admin via WhatsApp</Button>
                        <p className="text-[10px] leading-relaxed text-slate-500">PNG/JPG/WebP · maksimal 5 MB · bukti hanya untuk verifikasi manual.</p>
                      </>
                    )}
                  </div>

                  {/* Sandbox Webhook Trigger for Local / QA Verification */}
                  {order.sandboxModeAvailable && (
                    <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-emerald-900">
                          Pengujian Integrasi Webhook QRIS (Sandbox Mode)
                        </p>
                        <p className="text-[11px] text-emerald-800 leading-relaxed">
                          Kirim callback webhook ber-signature HMAC-SHA256 yang sah di sisi server
                          untuk menguji alur verifikasi nominal, idempotensi, dan pemenuhan stok
                          atomik.
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={simulatingWebhook}
                        onClick={() => void handleSimulateGatewayWebhook()}
                        className="w-full"
                      >
                        Simulasikan Callback Webhook Lunas (Signed HMAC)
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Ringkasan Status Pembayaran</span>
                  </div>
                  <div className="space-y-2 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>Status Tagihan</span>
                      <span className="font-mono font-bold text-slate-900">
                        {order.payment?.status || order.status}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Waktu Verifikasi</span>
                      <span>{formatDateTime(order.paidAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Waktu Pemenuhan</span>
                      <span>{formatDateTime(order.completedAt)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Confirm Cancel Order Dialog */}
      <Dialog
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        title="Konfirmasi Pembatalan Pesanan"
        description="Apakah Anda yakin ingin membatalkan tagihan QRIS ini?"
      >
        <div className="space-y-4 text-xs text-slate-600">
          <p>
            Membatalkan pesanan akan mengembalikan unit stok yang sedang direservasi ke brankas
            toko dan menandai tagihan QRIS ini sebagai kedaluwarsa.
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmCancelOpen(false)}>
              Kembali
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={cancelling}
              onClick={() => void handleCancelOrder()}
            >
              Ya, Batalkan Pesanan
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Warranty Claim Dialog */}
      <Dialog
        open={warrantyOpen}
        onClose={() => setWarrantyOpen(false)}
        title="Ajukan Klaim Garansi Lisensi"
        description={`Order ${order?.orderNumber || ''}`}
      >
        <form onSubmit={handleSubmitWarranty} className="space-y-4">
          <Input
            label="Kendala / Alasan Klaim Garansi"
            value={warrantyReason}
            onChange={(e) => setWarrantyReason(e.target.value)}
            placeholder="Contoh: Kode aktivasi menampilkan pesan kuota habis"
            required
          />
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Kronologi & Detail Tambahan
            </label>
            <textarea
              rows={3}
              value={warrantyEvidence}
              onChange={(e) => setWarrantyEvidence(e.target.value)}
              placeholder="Sertakan pesan error yang muncul saat aktivasi..."
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-emerald-600"
              required
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setWarrantyOpen(false)}>
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submittingWarranty}>
              Kirim Klaim Garansi
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};

export const CustomerDashboardPage: React.FC = () => {
  const { user, navigate, apiFetch, showToast } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPwd(true);
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setChangingPwd(false);

    if (!res.ok) {
      showToast({
        type: 'error',
        title: 'Gagal Mengubah Password',
        message: res.error?.message || 'Periksa kembali password Anda.',
      });
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    showToast({
      type: 'success',
      title: 'Password Diperbarui',
      message: 'Sesi perangkat lain telah dicabut secara otomatis demi keamanan.',
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <StoreHeader />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs text-slate-500">Pengaturan Profil & Keamanan Sesi</p>
            <h1 className="text-2xl font-bold text-slate-900">
              Dashboard Akun @{user?.username}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/orders')}>
              <Package className="w-3.5 h-3.5" />
              <span>Riwayat Pesanan</span>
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate('/shop')}>
              <span>Buka Katalog Toko</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {user?.forcePasswordRotation && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 flex items-start gap-3 text-xs text-amber-900">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="font-bold">Rotasi Kredensial Awal Diperlukan</p>
              <p>
                Akun ini menggunakan kredensial bootstrap awal. Harap segera perbarui password
                Anda pada formulir di bawah ini.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <User className="w-4 h-4 text-emerald-600" />
              <h2>Informasi Identitas Akun</h2>
            </div>

            <div className="space-y-3 text-xs border-t border-slate-100 pt-4">
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Username</span>
                <span className="font-mono font-bold text-slate-900">@{user?.username}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Alamat Email</span>
                <span className="font-mono text-slate-900">{user?.email}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Nomor WhatsApp Penerima Lisensi</span>
                <span className="font-mono font-semibold text-emerald-700">{user?.whatsapp}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Role Otorisasi Server</span>
                <span className="font-mono font-semibold text-slate-900">{user?.role}</span>
              </div>
            </div>
          </div>

          <div className="md:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Lock className="w-4 h-4 text-emerald-600" />
              <h2>Perbarui Password & Rotasi Sesi</h2>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-4 pt-2">
              <Input
                label="Password Saat Ini"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              <Input
                label="Password Baru (Min. 8 karakter huruf & angka)"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <Button type="submit" variant="secondary" size="md" loading={changingPwd}>
                Simpan Password Baru
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};
