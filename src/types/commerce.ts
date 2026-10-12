export type UserRole = 'CUSTOMER' | 'PARTNER' | 'ADMIN';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  whatsapp: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW';
  companyName: string | null;
  partnerTier: string | null;
  walletBalance: number;
  apiKeyPrefix?: string | null;
  forcePasswordRotation: boolean;
}

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  description?: string;
  productCount?: number;
}

export interface ProductItem {
  id: string;
  slug: string;
  sku: string;
  name: string;
  categoryId: string;
  categoryName: string;
  categorySlug?: string;
  shortDescription: string;
  description?: string;
  termsAndConditions?: string;
  durationLabel: string;
  warrantyDays: number;
  warrantyTerms?: string;
  imageUrl: string;
  price: number;
  retailPrice: number;
  partnerPrice: number;
  stockCount: number;
  reservedCount?: number;
  isPublished?: boolean;
  deliveryType: string;
  paymentGatewayReady?: boolean;
  qrisProviderMode?: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status:
    | 'PENDING_PAYMENT'
    | 'PAID'
    | 'PROCESSING'
    | 'COMPLETED'
    | 'FAILED'
    | 'EXPIRED'
    | 'REFUNDED';
  productName: string;
  productSlug: string;
  quantity: number;
  totalAmount: number;
  currency: string;
  expiresAt: string;
  paidAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  userId: string;
  channel: string;
  status:
    | 'PENDING_PAYMENT'
    | 'PAID'
    | 'PROCESSING'
    | 'COMPLETED'
    | 'FAILED'
    | 'EXPIRED'
    | 'REFUNDED';
  subtotalAmount: number;
  uniqueCode: number;
  totalAmount: number;
  currency: string;
  customerWhatsapp: string;
  customerEmail: string;
  notes: string | null;
  expiresAt: string;
  paidAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sandboxModeAvailable?: boolean;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    productSlug: string;
    unitPrice: number;
    quantity: number;
    totalPrice: number;
    warrantyDays: number;
    terms: string;
  }>;
  payment: {
    id: string;
    provider: string;
    merchantId: string;
    providerReference: string;
    amount: number;
    currency: string;
    qrisPayload: string;
    qrisUrl: string | null;
    status: string;
    expiresAt: string;
    verifiedAt: string | null;
  } | null;
  fulfillment: {
    id: string;
    provider: string;
    status: string;
    attemptCount: number;
    whatsappDeliveryStatus: string;
    errorMessage: string | null;
    completedAt: string | null;
    credentials: string[];
  } | null;
  history: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    note: string;
    createdAt: string;
  }>;
}

export interface NotificationItem {
  id: string;
  scope: 'USER' | 'PUBLIC_STOCK' | 'ADMIN';
  title: string;
  message: string;
  category: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface PublicActivityItem {
  id: string;
  anonymizedBuyer: string;
  productName: string;
  categoryName: string;
  completedAt: string;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  variant: 'INFO' | 'PROMO' | 'MAINTENANCE' | 'WARNING';
  targetAudience?: string;
  isActive?: boolean;
  createdAt: string;
}
