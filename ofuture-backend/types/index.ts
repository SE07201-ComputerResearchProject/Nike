// types/index.ts
// ─────────────────────────────────────────────
// Core TypeScript Interfaces matching MySQL schema
// ─────────────────────────────────────────────

export type UserRole = 'buyer' | 'seller' | 'admin';
export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled' | 'refunded';

export interface IUser {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  role: UserRole;
  full_name: string;
  phone?: string | null;
  avatar_url?: string | null;
  is_active: number;       // MySQL TINYINT(1) maps to number (0 or 1)
  is_verified: number;     // MySQL TINYINT(1)
  mfa_enabled: number;     // MySQL TINYINT(1)
  mfa_secret?: string | null;
  last_login_at?: Date | null;
  last_login_ip?: string | null;
  failed_attempts: number;
  locked_until?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IShippingAddress {
  fullName?: string;
  phone?: string;
  address?: string;
  city?: string;
  district?: string;
  ward?: string;
  [key: string]: any;
}

export interface IOrder {
  id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  quantity: number;
  unit_price: number | string;  // MySQL DECIMAL often returns as string to prevent precision loss
  total_amount: number | string;
  status: OrderStatus;
  shipping_address?: IShippingAddress | null;
  notes?: string | null;
  cancelled_at?: Date | null;
  completed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}