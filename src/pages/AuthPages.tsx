import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Lock, ShieldCheck, Briefcase } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { Button, Input } from '../components/ui/DesignSystem.tsx';

export const LoginPage: React.FC = () => {
  const { navigate, searchParams, refreshSession, showToast } = useAuth();
  const returnTo = searchParams.get('returnTo') || '/shop';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError('Masukkan username atau email beserta password Anda.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
          returnTo,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error?.message || 'Gagal masuk. Periksa kembali kredensial Anda.');
        return;
      }

      await refreshSession();
      showToast({
        type: 'success',
        title: 'Autentikasi Berhasil',
        message: `Selamat datang kembali, @${json.user.username}.`,
      });
      navigate(json.redirectTo || '/shop', { replace: true });
    } catch {
      setError('Gagal menghubungi server autentikasi. Periksa koneksi Anda.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between p-4 sm:p-6">
      <div className="max-w-7xl w-full mx-auto flex items-center justify-between py-2">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 hover:text-emerald-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>AdViora</span>
        </a>
        <a
          href="/register"
          onClick={(e) => {
            e.preventDefault();
            navigate(`/register?returnTo=${encodeURIComponent(returnTo)}`);
          }}
          className="text-xs font-semibold text-emerald-700 hover:underline"
        >
          Belum punya akun? Daftar
        </a>
      </div>

      <main className="w-full max-w-md mx-auto my-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium">
            <Lock className="w-3.5 h-3.5" />
            <span>Sesi Terenkripsi HttpOnly</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Masuk ke Akun AdViora</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            Gunakan <strong>Username</strong> atau <strong>Alamat Email</strong> terdaftar
            Anda untuk mengakses katalog produk, checkout QRIS, dan riwayat pesanan.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            label="Username atau Email"
            type="text"
            autoComplete="username"
            placeholder="contoh: pelanggan_demo atau nama@email.com"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />

          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="Masukkan password akun Anda"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full"
          >
            Masuk ke Toko
          </Button>
        </form>

        <div className="pt-4 border-t border-slate-100 space-y-3 text-xs text-slate-600">
          <div className="flex items-center justify-between">
            <span>Pelanggan baru di AdViora?</span>
            <a
              href="/register"
              onClick={(e) => {
                e.preventDefault();
                navigate(`/register?returnTo=${encodeURIComponent(returnTo)}`);
              }}
              className="font-semibold text-emerald-700 hover:underline"
            >
              Buat Akun Pelanggan
            </a>
          </div>
          <div className="flex items-center justify-between">
            <span>Ingin bergabung sebagai Reseller B2B?</span>
            <a
              href="/partner-program"
              onClick={(e) => {
                e.preventDefault();
                navigate('/partner-program');
              }}
              className="font-semibold text-slate-800 hover:underline"
            >
              Program Partner
            </a>
          </div>
        </div>
      </main>

      <footer className="text-center text-[11px] text-slate-500 py-2">
        © {new Date().getFullYear()} AdViora Digital Commerce · Proteksi Brute-Force & Rate Limit Aktif
      </footer>
    </div>
  );
};

export const RegisterPage: React.FC = () => {
  const { navigate, searchParams, refreshSession, showToast } = useAuth();
  const returnTo = searchParams.get('returnTo') || '/shop';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const validateClient = () => {
    const errs: Record<string, string> = {};
    const cleanUname = username.trim().toLowerCase();
    if (cleanUname.length < 3 || !/^[a-z0-9_]+$/.test(cleanUname)) {
      errs.username = 'Username 3–30 karakter (huruf kecil, angka, atau underscore).';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      errs.email = 'Masukkan alamat email aktif yang valid.';
    }
    const cleanPhone = whatsapp.replace(/[\s\-().+]/g, '');
    if (!/^(08|628|8)\d{8,13}$/.test(cleanPhone)) {
      errs.whatsapp = 'Nomor WhatsApp harus aktif (diawali 08xx atau 628xx).';
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      errs.password = 'Password minimal 8 karakter dan wajib kombinasi huruf serta angka.';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (!validateClient()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          whatsapp: whatsapp.trim(),
          password,
          returnTo,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setServerError(json.error?.message || 'Registrasi gagal diproses.');
        return;
      }

      await refreshSession();
      showToast({
        type: 'success',
        title: 'Registrasi Pelanggan Berhasil',
        message: `Akun @${json.user.username} telah aktif.`,
      });
      navigate(json.redirectTo || '/shop', { replace: true });
    } catch {
      setServerError('Gagal menghubungi server. Periksa koneksi jaringan Anda.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between p-4 sm:p-6">
      <div className="max-w-7xl w-full mx-auto flex items-center justify-between py-2">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 hover:text-emerald-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>AdViora</span>
        </a>
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
          }}
          className="text-xs font-semibold text-emerald-700 hover:underline"
        >
          Sudah punya akun? Masuk
        </a>
      </div>

      <main className="w-full max-w-md mx-auto my-6 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Registrasi Akun Pelanggan Ritel</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Buat Akun Pelanggan Baru</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            Pastikan nomor WhatsApp Anda aktif karena detail lisensi pesanan akan dikirimkan
            secara privat ke nomor tersebut setelah pembayaran QRIS terverifikasi.
          </p>
        </div>

        {serverError && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium"
          >
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            label="Username Unik"
            type="text"
            autoComplete="username"
            placeholder="contoh: andi_pratama"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={fieldErrors.username}
            hint="Huruf kecil, angka, dan garis bawah (3–30 karakter)."
            required
          />

          <Input
            label="Alamat Email Aktif"
            type="email"
            autoComplete="email"
            placeholder="nama@domain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            required
          />

          <Input
            label="Nomor WhatsApp Aktif"
            type="tel"
            autoComplete="tel"
            placeholder="081234567890 atau 6281234567890"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            error={fieldErrors.whatsapp}
            hint="Digunakan khusus untuk pengiriman lisensi produk secara privat."
            required
          />

          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="Minimal 8 karakter (huruf & angka)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            required
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full"
          >
            Daftar & Lanjutkan ke Katalog
          </Button>
        </form>

        <div className="pt-4 border-t border-slate-100 text-xs text-slate-600 flex items-center justify-between">
          <span>Sudah memiliki akun pelanggan?</span>
          <a
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
            }}
            className="font-semibold text-emerald-700 hover:underline"
          >
            Masuk di sini
          </a>
        </div>
      </main>

      <footer className="text-center text-[11px] text-slate-500 py-2">
        © {new Date().getFullYear()} AdViora Digital Commerce · Hashing Password Scrypt Server-Side
      </footer>
    </div>
  );
};

export const PartnerProgramPage: React.FC = () => {
  const { navigate, apiFetch, showToast } = useAuth();
  const [applicantName, setApplicantName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [websiteOrChannel, setWebsiteOrChannel] = useState('');
  const [estimatedMonthlyVolume, setEstimatedMonthlyVolume] = useState(
    '25 - 100 Lisensi / Bulan'
  );
  const [useCase, setUseCase] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res = await apiFetch<{ applicationId: string; message: string }>(
      '/api/public/partner-applications',
      {
        method: 'POST',
        body: JSON.stringify({
          applicantName,
          businessName,
          email,
          whatsapp,
          websiteOrChannel,
          estimatedMonthlyVolume,
          useCase,
        }),
      }
    );
    setSubmitting(false);

    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Gagal mengirim permohonan kemitraan.');
      return;
    }

    setSubmittedId(res.data.applicationId);
    showToast({
      type: 'success',
      title: 'Permohonan Partner Terkirim',
      message: 'Tim Admin AdViora akan meninjau pengajuan Anda.',
    });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 hover:text-emerald-700"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Beranda Toko</span>
          </a>
          <Button variant="outline" size="sm" onClick={() => navigate('/login?returnTo=/partner')}>
            Login Portal Partner
          </Button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-10 space-y-6">
          <div className="space-y-2 border-b border-slate-100 pb-6">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <Briefcase className="w-4 h-4" />
              <span>Portal Kemitraan B2B · https://partnerhub.dpdns.org</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Pendaftaran Program Partner Resmi AdViora
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Program Partner dipisahkan secara struktural dari akun pembeli ritel. Setiap
              calon mitra melalui proses verifikasi identitas usaha oleh Administrator sebelum
              mendapatkan akses harga grosir dan kunci integrasi API.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-lg bg-[#F8FAFC] border border-slate-200 space-y-1">
              <p className="font-mono font-bold text-emerald-700">01. Persyaratan Mitra</p>
              <p className="text-slate-600">
                Memiliki kanal distribusi aktif (toko web, komunitas IT, atau layanan managed
                service) dan kontak WhatsApp resmi.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-[#F8FAFC] border border-slate-200 space-y-1">
              <p className="font-mono font-bold text-emerald-700">02. Review Admin</p>
              <p className="text-slate-600">
                Pengajuan ditinjau oleh Admin di /admin untuk memastikan kepatuhan syarat
                distribusi lisensi.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-[#F8FAFC] border border-slate-200 space-y-1">
              <p className="font-mono font-bold text-emerald-700">03. Akses PartnerHub</p>
              <p className="text-slate-600">
                Setelah disetujui, akun Anda mendapatkan role PARTNER beserta akses API H2H
                dan harga tier khusus.
              </p>
            </div>
          </div>

          {submittedId ? (
            <div className="p-6 rounded-xl bg-emerald-50 border border-emerald-200 space-y-3">
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Permohonan Kemitraan Berhasil Diterima</span>
              </div>
              <p className="text-xs text-emerald-900 leading-relaxed">
                Nomor Referensi Pengajuan:{' '}
                <strong className="font-mono">{submittedId}</strong>. Tim Administrator
                AdViora akan meninjau permohonan Anda dan mengirimkan pembaruan status ke
                email serta nomor WhatsApp yang terdaftar.
              </p>
              <Button variant="outline" size="sm" onClick={() => navigate('/')}>
                Kembali ke Halaman Utama
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              {error && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Nama Lengkap Penanggung Jawab"
                  value={applicantName}
                  onChange={(e) => setApplicantName(e.target.value)}
                  placeholder="Nama lengkap sesuai identitas"
                  required
                />
                <Input
                  label="Nama Usaha / Toko Digital"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Contoh: Kreasi Cloud Nusantara"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Email Bisnis"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mitra@perusahaan.com"
                  required
                />
                <Input
                  label="Nomor WhatsApp Operasional"
                  type="tel"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="081234567890"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="URL Website / Kanal Penjualan"
                  value={websiteOrChannel}
                  onChange={(e) => setWebsiteOrChannel(e.target.value)}
                  placeholder="https://tokoanda.id"
                />
                <Input
                  label="Estimasi Volume Bulanan"
                  value={estimatedMonthlyVolume}
                  onChange={(e) => setEstimatedMonthlyVolume(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Rencana Distribusi & Kebutuhan Integrasi (Minimal 15 karakter)
                </label>
                <textarea
                  rows={3}
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  placeholder="Jelaskan profil pelanggan Anda dan apakah Anda memerlukan integrasi API otomatis..."
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-emerald-600"
                  required
                />
              </div>

              <Button type="submit" variant="primary" size="lg" loading={submitting}>
                Kirim Pengajuan Partner B2B
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
