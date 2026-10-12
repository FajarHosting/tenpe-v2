import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import type { ProductItem } from '../../types/commerce.ts';

export function formatIdr(amount: number): string {
  return `Rp ${Math.round(Number(amount || 0)).toLocaleString('id-ID')}`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export const Price: React.FC<{
  amount: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}> = ({ amount, className = '', size = 'md' }) => {
  const sizeClasses = {
    sm: 'text-sm font-semibold',
    md: 'text-[15px] font-semibold',
    lg: 'text-xl font-bold',
    xl: 'text-2xl font-bold',
  }[size];

  return (
    <span className={`font-mono tabular-nums tracking-tight ${sizeClasses} ${className}`}>
      {formatIdr(amount)}
    </span>
  );
};

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
  }
> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  type = 'button',
  ...rest
}) => {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer';

  const variants = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
    secondary: 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950',
    outline:
      'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 active:bg-slate-100',
    danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
    ghost: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
  }[variant];

  const sizes = {
    sm: 'min-h-[38px] px-3.5 py-1.5 text-xs',
    md: 'min-h-[44px] px-4 py-2.5 text-sm',
    lg: 'min-h-[48px] px-6 py-3 text-sm',
  }[size];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${base} ${variants} ${sizes} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
      {children}
    </button>
  );
};

export const Input: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & {
    label?: string;
    error?: string;
    hint?: string;
  }
> = ({ label, error, hint, id, className = '', ...rest }) => {
  const inputId = id || `inp_${label?.toLowerCase().replace(/\s+/g, '_') || 'field'}`;
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-semibold text-slate-700">
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        className={`w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border rounded-lg text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600/20 ${
          error ? 'border-red-500 focus:border-red-600' : 'border-slate-300 focus:border-emerald-600'
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-red-600 flex items-center gap-1" role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
};

export const Select: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    label?: string;
    error?: string;
  }
> = ({ label, error, id, children, className = '', ...rest }) => {
  const selectId = id || `sel_${label?.toLowerCase().replace(/\s+/g, '_') || 'field'}`;
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label htmlFor={selectId} className="block text-xs font-semibold text-slate-700">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 ${className}`}
        {...rest}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
};

export const StockStatus: React.FC<{ stockCount: number }> = ({ stockCount }) => {
  if (stockCount <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>Stok Habis (0 tersedia)</span>
      </span>
    );
  }
  if (stockCount <= 3) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 tabular-nums">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>Tersisa {stockCount} unit</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 tabular-nums">
      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
      <span>Tersedia · {stockCount} unit</span>
    </span>
  );
};

export const OrderStatusLabel: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<
    string,
    { label: string; colorClass: string; icon: React.ReactNode }
  > = {
    PENDING_PAYMENT: {
      label: 'Menunggu Pembayaran QRIS',
      colorClass: 'text-amber-700',
      icon: <Clock className="w-3.5 h-3.5 shrink-0" />,
    },
    PAID: {
      label: 'Pembayaran Terverifikasi',
      colorClass: 'text-emerald-700',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
    },
    PROCESSING: {
      label: 'Memproses Lisensi',
      colorClass: 'text-blue-700',
      icon: <RefreshCw className="w-3.5 h-3.5 shrink-0" />,
    },
    COMPLETED: {
      label: 'Selesai & Terkirim',
      colorClass: 'text-emerald-700',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
    },
    EXPIRED: {
      label: 'Kedaluwarsa',
      colorClass: 'text-slate-500',
      icon: <XCircle className="w-3.5 h-3.5 shrink-0" />,
    },
    FAILED: {
      label: 'Gagal',
      colorClass: 'text-red-600',
      icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" />,
    },
    REFUNDED: {
      label: 'Dana Dikembalikan (Refund)',
      colorClass: 'text-slate-600',
      icon: <RefreshCw className="w-3.5 h-3.5 shrink-0" />,
    },
  };

  const info = map[status] || {
    label: status,
    colorClass: 'text-slate-700',
    icon: <Package className="w-3.5 h-3.5 shrink-0" />,
  };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${info.colorClass}`}>
      {info.icon}
      <span>{info.label}</span>
    </span>
  );
};

export const ResilientImage: React.FC<{
  src: string;
  alt: string;
  className?: string;
  aspectClass?: string;
}> = ({ src, alt, className = '', aspectClass = 'aspect-[4/3]' }) => {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`relative overflow-hidden bg-slate-100 ${aspectClass} ${className}`}
    >
      {!failed && src ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-slate-100 text-slate-500 text-center">
          <Layers className="w-8 h-8 text-slate-400 mb-2" />
          <span className="text-xs font-medium text-slate-600 line-clamp-2">{alt}</span>
        </div>
      )}
    </div>
  );
};

export const ProductCard: React.FC<{
  product: ProductItem;
  onSelect: (slug: string) => void;
}> = ({ product, onSelect }) => {
  const outOfStock = product.stockCount <= 0;

  return (
    <article
      onClick={() => onSelect(product.slug)}
      className="group bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5 cursor-pointer"
    >
      <div>
        <ResilientImage
          src={product.imageUrl}
          alt={product.name}
          aspectClass="aspect-[4/3]"
        />
        <div className="p-5 space-y-2.5">
          {/* Clean unboxed metadata with typographic separators (Zero-Pill Rule) */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="uppercase tracking-wider font-medium text-slate-500">
              {product.categoryName}
            </span>
            <span aria-hidden="true">·</span>
            <span>{product.durationLabel}</span>
          </div>

          <h3 className="text-base font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-2">
            {product.name}
          </h3>

          <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
            {product.shortDescription}
          </p>
        </div>
      </div>

      <div className="px-5 pb-5 pt-3 border-t border-slate-100 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <Price amount={product.price} size="md" className="text-slate-900" />
          <StockStatus stockCount={product.stockCount} />
        </div>

        <Button
          variant={outOfStock ? 'outline' : 'secondary'}
          size="md"
          className="w-full"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(product.slug);
          }}
        >
          <span>{outOfStock ? 'Lihat Detail (Habis)' : 'Lihat Detail & Beli'}</span>
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </article>
  );
};

export const Skeleton: React.FC<{ className?: string }> = ({ className = 'h-6 w-full' }) => (
  <div className={`animate-pulse bg-slate-200/80 rounded-lg ${className}`} />
);

export const EmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-8 md:p-12 text-center max-w-lg mx-auto my-4">
    <div className="w-11 h-11 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center mx-auto mb-4">
      <Package className="w-5 h-5" />
    </div>
    <h3 className="text-base font-semibold text-slate-900 mb-1.5">{title}</h3>
    <p className="text-sm text-slate-600 leading-relaxed mb-6">{description}</p>
    {actionLabel && onAction && (
      <Button variant="primary" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);

export const ErrorState: React.FC<{
  message: string;
  onRetry?: () => void;
}> = ({ message, onRetry }) => (
  <div className="bg-white border border-red-200 rounded-xl p-6 md:p-8 text-center max-w-lg mx-auto my-4">
    <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-3">
      <AlertCircle className="w-5 h-5" />
    </div>
    <h3 className="text-sm font-semibold text-slate-900 mb-1">Gagal Memuat Data</h3>
    <p className="text-xs text-slate-600 mb-4">{message}</p>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="w-3.5 h-3.5" />
        <span>Coba Lagi</span>
      </Button>
    )}
  </div>
);

export const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}> = ({ open, onClose, title, description, children, maxWidthClass = 'max-w-lg' }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div
        className={`bg-white border border-slate-200 rounded-xl w-full ${maxWidthClass} p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h2 id="dialog-title" className="text-base font-bold text-slate-900">
              {title}
            </h2>
            {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
};

export const Pagination: React.FC<{
  page: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
}> = ({ page, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-4 pt-6 border-t border-slate-200">
      <span className="text-xs text-slate-600 tabular-nums">
        Halaman {page} dari {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Sebelumnya
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
};

export const TrustBar: React.FC = () => (
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 px-5 bg-white border border-slate-200 rounded-xl text-xs text-slate-600">
    <div className="flex items-center gap-2.5">
      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
      <span>Verifikasi QRIS Server-to-Server</span>
    </div>
    <div className="flex items-center gap-2.5">
      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
      <span>Reservasi Stok Brankas Atomik</span>
    </div>
    <div className="flex items-center gap-2.5">
      <Package className="w-4 h-4 text-emerald-600 shrink-0" />
      <span>Pengiriman Privat WhatsApp & Web</span>
    </div>
  </div>
);
