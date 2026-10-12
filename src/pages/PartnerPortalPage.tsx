import React, { useCallback, useEffect, useState } from 'react';
import {
  Briefcase,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wallet,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { StoreHeader } from '../components/layout/StoreHeader.tsx';
import {
  Button,
  ErrorState,
  Price,
  Skeleton,
  formatDateTime,
} from '../components/ui/DesignSystem.tsx';

interface PartnerOverviewData {
  partnerProfile: {
    id: string;
    username: string;
    companyName: string;
    partnerTier: string;
    walletBalance: number;
    apiKeyPrefix: string | null;
  };
  metrics: {
    totalOrders: number;
    totalSpend: number;
  };
  warrantyClaims: Array<{
    id: string;
    orderId: string;
    orderNumber: string;
    reason: string;
    evidenceNote: string;
    status: string;
    adminResolutionNote: string | null;
    createdAt: string;
  }>;
}

export const PartnerPortalPage: React.FC = () => {
  const { navigate, apiFetch, showToast } = useAuth();
  const [data, setData] = useState<PartnerOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<PartnerOverviewData>('/api/partner/overview');
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(
        res.error?.message ||
          'Halaman ini khusus untuk akun Partner B2B yang telah disetujui Administrator.'
      );
      return;
    }
    setData(res.data);
  }, [apiFetch]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const handleRotateKey = async () => {
    setRotatingKey(true);
    const res = await apiFetch<{ rawApiKey: string; apiKeyPrefix: string }>(
      '/api/partner/rotate-api-key',
      { method: 'POST' }
    );
    setRotatingKey(false);
    if (!res.ok || !res.data) {
      showToast({
        type: 'error',
        title: 'Gagal Merotasi API Key',
        message: res.error?.message || 'Coba lagi nanti.',
      });
      return;
    }
    setNewlyGeneratedKey(res.data.rawApiKey);
    void fetchOverview();
    showToast({
      type: 'success',
      title: 'API Key B2B Dirotasi',
      message: 'Salin kunci baru Anda sekarang.',
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      <StoreHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-emerald-700 font-semibold">
              <Briefcase className="w-3.5 h-3.5" />
              <span>PartnerHub B2B Portal · https://partnerhub.dpdns.org</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">
              {data?.partnerProfile.companyName || 'Portal Partner B2B AdViora'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => navigate('/shop')}>
              <span>Beli dengan Harga Partner</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : error || !data ? (
          <ErrorState message={error || 'Data Partner tidak tersedia.'} onRetry={fetchOverview} />
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Saldo Deposit Partner</span>
                  <Wallet className="w-4 h-4 text-emerald-600" />
                </div>
                <Price amount={data.partnerProfile.walletBalance} size="xl" />
                <p className="text-[11px] text-slate-500">
                  Tier: {data.partnerProfile.partnerTier}
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                <span className="text-xs text-slate-500">Total Transaksi Partner</span>
                <p className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {data.metrics.totalOrders}
                </p>
                <p className="text-[11px] text-slate-500">Pesanan melalui akun ini</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                <span className="text-xs text-slate-500">Akumulasi Volume Pembelian</span>
                <Price amount={data.metrics.totalSpend} size="xl" />
                <p className="text-[11px] text-slate-500">Status COMPLETED</p>
              </div>
            </div>

            {/* API Key Management & H2H Documentation */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <KeyRound className="w-4 h-4 text-emerald-600" />
                  <h2>Kredensial Integrasi API H2H</h2>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Kunci API hanya disimpan dalam bentuk hash SHA-256 di database server. Jika
                  Anda merotasi kunci, kunci lama langsung tidak berlaku.
                </p>

                <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-slate-200 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Prefix Kunci Aktif</span>
                  <span className="font-mono font-bold text-slate-900">
                    {data.partnerProfile.apiKeyPrefix
                      ? `${data.partnerProfile.apiKeyPrefix}••••••••••••`
                      : 'Belum dibuat'}
                  </span>
                </div>

                {newlyGeneratedKey && (
                  <div className="p-4 rounded-lg bg-slate-900 text-white space-y-2 text-xs">
                    <p className="text-amber-300 font-semibold">
                      Simpan Kunci API Baru Anda Sekarang (Hanya Ditampilkan Sekali):
                    </p>
                    <div className="flex items-center justify-between gap-2 font-mono bg-slate-800 p-2.5 rounded">
                      <span className="truncate text-emerald-400">{newlyGeneratedKey}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(newlyGeneratedKey);
                          showToast({
                            type: 'success',
                            title: 'API Key Disalin',
                          });
                        }}
                        className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs cursor-pointer shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  loading={rotatingKey}
                  onClick={() => void handleRotateKey()}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Rotasi / Buat Kunci API Baru</span>
                </Button>
              </div>

              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Terminal className="w-4 h-4 text-emerald-600" />
                  <h2>Spesifikasi Endpoint Partner</h2>
                </div>
                <pre className="p-4 rounded-lg bg-slate-900 text-slate-200 text-xs font-mono overflow-x-auto leading-relaxed">
{`GET /api/shop/catalog
POST /api/orders
Header:
  Content-Type: application/json
  X-CSRF-Token: <session_csrf_token>
Body:
  {
    "productId": "prd_cloud_workspace_pro",
    "quantity": 1,
    "idempotencyKey": "partner_ord_2026_001",
    "channel": "PARTNER_PORTAL"
  }`}
                </pre>
              </div>
            </div>

            {/* Partner Warranty Claims History */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h2>Pusat Klaim Garansi SLA</h2>
              </div>

              {data.warrantyClaims.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">
                  Belum ada tiket klaim garansi yang diajukan. Anda dapat mengajukan klaim dari
                  halaman Detail Pesanan yang telah selesai.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 pr-4">Order</th>
                        <th className="py-2.5 pr-4">Kendala</th>
                        <th className="py-2.5 pr-4">Status</th>
                        <th className="py-2.5 pr-4">Resolusi Admin</th>
                        <th className="py-2.5 text-right">Waktu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.warrantyClaims.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="py-3 pr-4 font-mono font-semibold text-slate-900">
                            {c.orderNumber}
                          </td>
                          <td className="py-3 pr-4 text-slate-700">{c.reason}</td>
                          <td className="py-3 pr-4 font-mono font-semibold text-emerald-700">
                            {c.status}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">
                            {c.adminResolutionNote || '-'}
                          </td>
                          <td className="py-3 text-right text-slate-500 tabular-nums">
                            {formatDateTime(c.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
