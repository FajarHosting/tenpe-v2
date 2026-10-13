import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Lock,
  ShieldCheck,
  CheckCircle2,
  Briefcase,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  Button,
  ResilientImage,
  formatDateTime,
} from '../components/ui/DesignSystem.tsx';
import type {
  AnnouncementItem,
  CategorySummary,
  PublicActivityItem,
} from '../types/commerce.ts';

interface PublicOverviewResponse {
  storeDomain: string;
  partnerDomain: string;
  announcements: AnnouncementItem[];
  categories: CategorySummary[];
  publicActivityFeed: PublicActivityItem[];
}

export const LandingPage: React.FC = () => {
  const { user, navigate, apiFetch } = useAuth();
  const [overview, setOverview] = useState<PublicOverviewResponse | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch<PublicOverviewResponse>('/api/public/overview');
      if (res.ok && res.data) {
        setOverview(res.data);
      }
    })();
  }, [apiFetch]);

  const handleStartShopping = () => {
    if (user) {
      navigate('/shop');
    } else {
      navigate('/login?returnTo=/shop');
    }
  };

  const faqs = [
    {
      q: 'Mengapa katalog produk AdViora memerlukan autentikasi akun pelanggan?',
      a: 'Kebijakan autentikasi toko memastikan setiap reservasi stok brankas digital, kuota pembelian, dan pengiriman lisensi terikat secara kriptografis ke akun serta nomor WhatsApp aktif Anda.',
    },
    {
      q: 'Bagaimana proses verifikasi pembayaran QRIS bekerja?',
      a: 'Pembeli membuka link QRIS yang dikonfigurasi, lalu mengirim screenshot bukti pembayaran. Bot v32 meneruskan bukti ke WhatsApp admin. Pesanan baru diproses setelah admin memeriksa dan menyetujui pembayaran.',
    },
    {
      q: 'Ke mana kode lisensi atau kredensial produk dikirimkan?',
      a: 'Setelah admin mengonfirmasi pembayaran, sistem memproses pesanan sesuai stok dan konfigurasi pemenuhan, lalu menampilkan detail pesanan di akun Anda.',
    },
    {
      q: 'Apa perbedaan akun Pelanggan (Customer) dan akun Partner B2B?',
      a: 'Akun Pelanggan dirancang untuk pembelian ritel langsung di toko AdViora. Program Partner B2B memiliki portal terpisah dengan harga grosir berjenjang, kuota saldo deposit, dan integrasi API otomatis setelah lulus verifikasi Admin.',
    },
  ];

  const topAnnouncement = overview?.announcements?.[0];

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Slim Dismissible Top Announcement Banner (<= 40px) */}
      {topAnnouncement && (
        <div className="bg-slate-900 text-slate-100 px-4 py-2 text-xs text-center border-b border-slate-800">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 truncate">
            <span className="font-semibold text-emerald-400 shrink-0">
              {topAnnouncement.title}:
            </span>
            <span className="truncate text-slate-300">{topAnnouncement.content}</span>
          </div>
        </div>
      )}

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
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

          {/* Zone 2: 4–5 clean single-line text navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#keunggulan"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Keunggulan
            </a>
            <a
              href="#alur-belanja"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Alur Belanja
            </a>
            <a
              href="#kategori"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Kategori Layanan
            </a>
            <a
              href="#program-partner"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Program Partner
            </a>
            <a
              href="#faq"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Bantuan & FAQ
            </a>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            <Button variant="primary" size="sm" onClick={handleStartShopping}>
              <span>{user ? 'Buka Katalog Toko' : 'Mulai Belanja'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* 1. HERO SECTION */}
        <section className="py-12 md:py-20 border-b border-slate-200 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  <span>Platform Niaga Produk Digital Resmi</span>
                  <span aria-hidden="true">·</span>
                  <span>Pengiriman Otomatis 24/7</span>
                </div>

                <h1
                  className="font-bold tracking-tight text-slate-900 balance-text leading-[1.12]"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)' }}
                >
                  Infrastruktur Lisensi Perangkat Lunak & Produk Digital Terverifikasi.
                </h1>

                <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                  AdViora menyediakan lisensi produktivitas awan, suite kreatif, keamanan
                  jaringan, dan perkakas developer dengan reservasi stok brankas atomik,
                  pembayaran QRIS dengan pengiriman bukti untuk verifikasi admin, serta pengiriman pesanan setelah pembayaran disetujui.
                </p>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                  <Button variant="primary" size="lg" onClick={handleStartShopping}>
                    <span>Mulai Belanja Sekarang</span>
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                  {!user ? (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => navigate('/register')}
                    >
                      Daftar Akun Pelanggan
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => navigate('/orders')}
                    >
                      Riwayat Pesanan Saya
                    </Button>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Stok Real-Time Server-Side
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-emerald-600" />
                    Verifikasi Webhook QRIS HMAC
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Garansi Masa Aktif Tercatat
                  </span>
                </div>
              </div>

              <div className="lg:col-span-6 flex">
                <div className="w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100 flex flex-col justify-between">
                  <ResilientImage
                    src="/src/assets/images/hero_digital_commerce_1791793684386.jpg"
                    alt="Workspace Manajemen Lisensi Perangkat Lunak AdViora"
                    aspectClass="aspect-[16/9] lg:h-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. CAPABILITIES & ARCHITECTURE BENTO SECTION */}
        <section id="keunggulan" className="py-16 md:py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl space-y-3 mb-12">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Standar Keandalan Transaksi
            </p>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 balance-text">
              Dirancang untuk Keamanan Pembayaran dan Kepastian Pemenuhan Stok.
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Setiap pesanan diproses menggunakan transaksi database terisolasi sehingga tidak
              ada risiko kelebihan penjualan (overselling) maupun kebocoran kredensial produk.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-6 md:p-8 flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <span className="text-xs font-mono font-semibold text-emerald-700">
                  01. Verifikasi Pembayaran QRIS Terproteksi
                </span>
                <h3 className="text-xl font-bold text-slate-900">
                  Rekonsiliasi Otomatis Tanpa Konfirmasi Manual
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Nominal pesanan dihitung ulang sepenuhnya di server. Status pesanan hanya
                  berubah menjadi lunas setelah server menerima callback resmi dari penyedia
                  pembayaran yang tervalidasi tanda tangan kriptografisnya, nominalnya, serta
                  bebas dari duplikasi event.
                </p>
              </div>
              <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span>Idempotent Webhook</span>
                <span aria-hidden="true">·</span>
                <span>Anti-Replay Timestamp Window</span>
                <span aria-hidden="true">·</span>
                <span>Snapshot Harga Terkunci</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <span className="text-xs font-mono font-semibold text-emerald-700">
                  02. Brankas Inventaris Atomik
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  Klaim Lisensi Satu-ke-Satu
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Stok yang tampil di katalog mencerminkan unit lisensi nyata di brankas
                  database. Saat checkout dibuat, unit direservasi secara eksklusif hingga
                  batas waktu pembayaran berakhir.
                </p>
              </div>
              <div className="pt-4 border-t border-slate-100 text-xs text-slate-500">
                Audit Trail Stok Lengkap
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <span className="text-xs font-mono font-semibold text-emerald-700">
                  03. Distribusi Kanal Privat
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  Pengiriman WhatsApp & Web Pribadi
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Kredensial lisensi tidak pernah dikirim ke grup publik. Pengiriman menuju
                  WhatsApp pelanggan menggunakan arsitektur Outbox ber-autentikasi ke Bot v32.
                </p>
              </div>
              <div className="pt-4 border-t border-slate-100 text-xs text-slate-500">
                Privasi Data Pelanggan Terjaga
              </div>
            </div>

            <div
              id="alur-belanja"
              className="md:col-span-2 bg-slate-900 text-white rounded-xl p-6 md:p-8 flex flex-col justify-between space-y-6"
            >
              <div className="space-y-2">
                <span className="text-xs font-mono font-semibold text-emerald-400">
                  04. Alur Belanja Pelanggan (4 Langkah)
                </span>
                <h3 className="text-xl font-bold">
                  Dari Pemilihan Produk hingga Aktivasi Lisensi dalam Hitungan Detik
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                <div className="space-y-1">
                  <p className="text-xs font-mono text-emerald-400">Langkah 01</p>
                  <p className="text-sm font-semibold">Masuk / Daftar</p>
                  <p className="text-xs text-slate-300">
                    Gunakan email/username dan nomor WhatsApp aktif untuk menerima lisensi.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-mono text-emerald-400">Langkah 02</p>
                  <p className="text-sm font-semibold">Pilih Produk</p>
                  <p className="text-xs text-slate-300">
                    Jelajahi katalog resmi di /shop dengan ketersediaan stok terverifikasi.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-mono text-emerald-400">Langkah 03</p>
                  <p className="text-sm font-semibold">Bayar via QRIS</p>
                  <p className="text-xs text-slate-300">
                    Pindai kode QRIS resmi menggunakan aplikasi perbankan atau e-wallet.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-mono text-emerald-400">Langkah 04</p>
                  <p className="text-sm font-semibold">Terima Lisensi</p>
                  <p className="text-xs text-slate-300">
                    Lisensi tampil instan di halaman detail order dan dikirim ke WhatsApp Anda.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. LIMITED CATEGORY OVERVIEW & ANONYMIZED LIVE ACTIVITY */}
        <section
          id="kategori"
          className="py-16 bg-white border-y border-slate-200"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="space-y-2 max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Kategori Layanan Tersedia
                </p>
                <h2 className="text-2xl font-bold text-slate-900">
                  Kurasi Lisensi untuk Produktivitas Individu dan Tim.
                </h2>
                <p className="text-sm text-slate-600">
                  Katalog lengkap beserta harga dan stok langsung dapat diakses setelah Anda
                  masuk ke akun pelanggan.
                </p>
              </div>
              <Button variant="secondary" onClick={handleStartShopping}>
                <span>Masuk untuk Membuka Katalog</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>

            {overview?.categories && overview.categories.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {overview.categories.slice(0, 4).map((cat, idx) => (
                  <div
                    key={cat.id}
                    onClick={handleStartShopping}
                    className="p-5 rounded-xl border border-slate-200 bg-[#F8FAFC] hover:border-slate-300 transition-colors cursor-pointer flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                        <span>0{idx + 1}</span>
                        <span className="tabular-nums">{cat.productCount || 0} Produk</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900">{cat.name}</h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {cat.description}
                      </p>
                    </div>
                    <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                      <span>Jelajahi di Toko</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 border border-slate-200 rounded-xl text-xs text-slate-500 text-center">
                Kategori produk sedang dimuat dari server...
              </div>
            )}

            {/* Anonymized Public Activity Feed (Strictly Real Verified Orders, Zero Fake Data) */}
            <div className="pt-6 border-t border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Aktivitas Pemenuhan Pesanan Terverifikasi
                  </h3>
                  <p className="text-xs text-slate-500">
                    Menampilkan transaksi nyata yang telah selesai (identitas pembeli
                    dianonimkan demi privasi).
                  </p>
                </div>
              </div>

              {overview?.publicActivityFeed && overview.publicActivityFeed.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {overview.publicActivityFeed.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-lg border border-slate-200 bg-white text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-mono font-semibold text-slate-700">
                          {item.anonymizedBuyer}
                        </span>
                        <span>{formatDateTime(item.completedAt)}</span>
                      </div>
                      <p className="font-semibold text-slate-900 truncate">
                        {item.productName}
                      </p>
                      <p className="text-[11px] text-slate-500">{item.categoryName}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-5 rounded-xl border border-slate-200 bg-[#F8FAFC] text-xs text-slate-600 flex items-center justify-between gap-4">
                  <span>
                    Belum ada riwayat transaksi publik yang ditampilkan pada periode ini. Kami
                    hanya menampilkan transaksi nyata yang telah selesai diverifikasi.
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 4. JOIN PARTNER PROGRAM (SEPARATED B2B WORKFLOW) */}
        <section id="program-partner" className="py-16 md:py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                <Briefcase className="w-4 h-4" />
                <span>Ekosistem B2B Terpisah · Portal Partner AdViora</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 balance-text">
                Program Kemitraan Reseller & Integrasi API B2B (PartnerHub)
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
                Akun Partner B2B terpisah dari akun pelanggan ritel. Mitra resmi mendapatkan
                harga grosir khusus, akses endpoint API H2H untuk otomatisasi toko, manajemen
                saldo deposit, serta pusat klaim garansi SLA terdedikasi setelah melewati
                proses kurasi dan review tim Admin AdViora.
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500 pt-1">
                <span>1. Pengajuan Profil Bisnis</span>
                <span aria-hidden="true">·</span>
                <span>2. Verifikasi & Kurasi Admin</span>
                <span aria-hidden="true">·</span>
                <span>3. Aktivasi Akses PartnerHub & API Key</span>
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3">
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => navigate('/partner-program')}
              >
                <span>Ajukan Pendaftaran Partner</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="md"
                className="w-full"
                onClick={() =>
                  user?.role === 'PARTNER' || user?.role === 'ADMIN'
                    ? navigate('/partner')
                    : navigate('/login?returnTo=/partner')
                }
              >
                Masuk Portal Partner B2B
              </Button>
            </div>
          </div>
        </section>

        {/* 5. FAQ & HELP SECTION */}
        <section id="faq" className="py-16 bg-white border-t border-slate-200">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                <HelpCircle className="w-4 h-4" />
                <span>Pertanyaan Umum & Kebijakan Layanan</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">
                Informasi Transparansi Pembelian & Pemenuhan Lisensi
              </h2>
            </div>

            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {faqs.map((item, index) => {
                const isOpen = openFaq === index;
                return (
                  <div key={item.q} className="py-4">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : index)}
                      className="w-full min-h-[44px] flex items-center justify-between gap-4 text-left text-sm font-semibold text-slate-900 hover:text-emerald-700 cursor-pointer"
                    >
                      <span>{item.q}</span>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${
                          isOpen ? 'rotate-180 text-emerald-600' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <p className="text-sm text-slate-600 leading-relaxed pt-2 pr-6">
                        {item.a}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-2 md:col-span-2">
            <p className="text-base font-bold text-white tracking-tight">AdViora</p>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
              Premium Digital Commerce Platform. Menyediakan distribusi lisensi perangkat lunak
              resmi dengan pembayaran QRIS terverifikasi dan pengiriman instan.
            </p>
            <p className="text-[11px] text-slate-500 pt-2">
              Domain Toko: {overview?.storeDomain || 'https://adviora.partnerhub.dpdns.org'} ·
              Portal Partner: {overview?.partnerDomain || 'https://partnerhub.dpdns.org'}
            </p>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-white">Navigasi Pelanggan</p>
            <ul className="space-y-1.5">
              <li>
                <a
                  href="/login"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/login');
                  }}
                  className="hover:text-white transition-colors"
                >
                  Masuk Akun (/login)
                </a>
              </li>
              <li>
                <a
                  href="/register"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/register');
                  }}
                  className="hover:text-white transition-colors"
                >
                  Registrasi Pelanggan (/register)
                </a>
              </li>
              <li>
                <a
                  href="/shop"
                  onClick={(e) => {
                    e.preventDefault();
                    handleStartShopping();
                  }}
                  className="hover:text-white transition-colors"
                >
                  Katalog Produk (/shop)
                </a>
              </li>
              <li>
                <a
                  href="/orders"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(user ? '/orders' : '/login?returnTo=/orders');
                  }}
                  className="hover:text-white transition-colors"
                >
                  Lacak Pesanan (/orders)
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-white">Kemitraan & Operasional</p>
            <ul className="space-y-1.5">
              <li>
                <a
                  href="/partner-program"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/partner-program');
                  }}
                  className="hover:text-white transition-colors"
                >
                  Daftar Program Partner B2B
                </a>
              </li>
              <li>
                <a
                  href="/partner"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(user ? '/partner' : '/login?returnTo=/partner');
                  }}
                  className="hover:text-white transition-colors"
                >
                  Portal PartnerHub
                </a>
              </li>
              <li>
                <a
                  href="#faq"
                  className="hover:text-white transition-colors"
                >
                  Syarat, Ketentuan & Garansi
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <span>© {new Date().getFullYear()} AdViora Digital Commerce. Seluruh hak cipta dilindungi.</span>
          <span>Keamanan Sesi HttpOnly · Transaksi QRIS Terenkripsi</span>
        </div>
      </footer>
    </div>
  );
};
