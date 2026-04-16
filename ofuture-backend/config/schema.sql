-- ============================================================
-- O'Future Secure E-Commerce Platform
-- DATABASE SCHEMA — schema.sql
-- MySQL 8.0+
-- ============================================================
-- Run this file once to initialize the database:
--   mysql -u root -p < config/schema.sql
-- ============================================================

-- ── Create & select database ─────────────────────────────────
CREATE DATABASE IF NOT EXISTS ofuture_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ofuture_db;

-- ── Safety: disable FK checks during table creation ──────────
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- TABLE 1: users
-- Stores all accounts (buyer / seller / admin).
-- Passwords are stored as bcrypt hashes — NEVER plaintext.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  email           VARCHAR(255)    NOT NULL,
  username        VARCHAR(80)     NOT NULL,
  password_hash   VARCHAR(255)    NOT NULL,                  -- bcrypt hash
  role            ENUM(
                    'buyer',
                    'seller',
                    'admin'
                  )               NOT NULL DEFAULT 'buyer',
  full_name       VARCHAR(150)    NOT NULL,
  phone           VARCHAR(20)     NULL,
  avatar_url      VARCHAR(500)    NULL,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,        -- 0 = suspended
  is_verified     TINYINT(1)      NOT NULL DEFAULT 0,        -- email verified
  mfa_enabled     TINYINT(1)      NOT NULL DEFAULT 0,
  mfa_secret      VARCHAR(100)    NULL,                      -- TOTP secret (encrypted at app layer)
  mfa_backup_codes TEXT           DEFAULT NULL,              -- backup codes for MFA recovery
  last_login_at   DATETIME        NULL,
  last_login_ip   VARCHAR(45)     NULL,                      -- IPv4 or IPv6
  failed_attempts INT UNSIGNED    NOT NULL DEFAULT 0,        -- brute-force counter
  locked_until    DATETIME        NULL,                      -- account lockout expiry
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email    (email),
  UNIQUE KEY uq_users_username (username),
  INDEX idx_users_role         (role),
  INDEX idx_users_is_active    (is_active),
  INDEX idx_users_created_at   (created_at)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 2: user_profiles
-- Lưu trữ thông tin chi tiết về doanh nghiệp/cá nhân sau bước đăng ký.
-- Liên kết 1-1 với bảng users.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id           CHAR(36)        NOT NULL,
  
  -- Thông tin kinh doanh (Dùng cho cả Seller và Wholesale Buyer)
  store_name        VARCHAR(150)    NULL,      -- Tên cửa hàng/doanh nghiệp
  category          VARCHAR(100)    NULL,      -- Ngành hàng (Thời trang, Điện tử...)
  scale             ENUM('small', 'medium', 'large', 'enterprise') DEFAULT 'small', -- Quy mô
  tax_code          VARCHAR(50)     NULL,      -- Mã số thuế (nếu có)
  
  -- Thông tin địa chỉ chi tiết (Dành cho vận chuyển và pháp lý)
  address           VARCHAR(255)    NULL,      -- Địa chỉ cụ thể
  city              VARCHAR(100)    NULL,      -- Tỉnh/Thành phố
  zip_code          VARCHAR(20)     NULL,      -- Mã bưu điện
  country           VARCHAR(100)    DEFAULT 'Việt Nam',

  -- Thông tin thêm
  bio               TEXT            NULL,      -- Giới thiệu ngắn
  website           VARCHAR(255)    NULL,
  
  PRIMARY KEY (user_id),
  CONSTRAINT fk_profiles_users FOREIGN KEY (user_id) 
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 2: refresh_tokens
-- Stores hashed refresh tokens for JWT rotation.
-- One user may have multiple active sessions (e.g. mobile + desktop).
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)     NOT NULL,
  token_hash  VARCHAR(255) NOT NULL,                         -- SHA-256 hash of token
  device_info VARCHAR(300) NULL,
  ip_address  VARCHAR(45)  NULL,
  expires_at  DATETIME     NOT NULL,
  revoked     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_rt_user_id    (user_id),
  INDEX idx_rt_token_hash (token_hash),
  INDEX idx_rt_expires_at (expires_at),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128) NULL AFTER token_hash,
  ADD COLUMN IF NOT EXISTS last_used_ip       VARCHAR(45)  NULL AFTER ip_address,
  ADD COLUMN IF NOT EXISTS last_used_at       DATETIME     NULL AFTER last_used_ip,
  ADD COLUMN IF NOT EXISTS revoke_reason      VARCHAR(100) NULL AFTER revoked;

-- ============================================================
-- TABLE: categories
-- Product categories with hierarchy support
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  name            VARCHAR(100)    NOT NULL,
  slug            VARCHAR(100)    NOT NULL,
  description     TEXT            NULL,
  parent_id       CHAR(36)        NULL,                          -- For category hierarchy
  image_url       VARCHAR(500)    NULL,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  display_order   INT             NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  INDEX idx_categories_parent_id (parent_id),
  INDEX idx_categories_is_active (is_active),
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id)
    REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 3: products
-- Products listed by sellers.
-- stock_quantity = 0 → automatically "out_of_stock".
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  seller_id       CHAR(36)        NOT NULL,
  category_id       CHAR(36)        NULL,                        -- NEW: foreign key to categories
  name            VARCHAR(255)    NOT NULL,
  slug            VARCHAR(300)    NOT NULL,                  -- SEO-friendly URL
  description     TEXT            NULL,
  category        VARCHAR(100)    NOT NULL,
  price           DECIMAL(12, 2)  NOT NULL,
  wholesale_price   DECIMAL(12, 2)  NULL,                        -- NEW: bulk pricing (VND)
  minimum_quantity  INT UNSIGNED    NOT NULL DEFAULT 1,          -- NEW: min order qty
  stock_quantity  INT UNSIGNED    NOT NULL DEFAULT 0,
  image_urls      JSON            NULL,                      -- array of image URLs
  status          ENUM(
                    'active',
                    'inactive',
                    'deleted'
                  )               NOT NULL DEFAULT 'active',
  avg_rating      DECIMAL(3, 2)   NOT NULL DEFAULT 0.00,
  review_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug    (slug),
  INDEX idx_products_seller_id   (seller_id),
  INDEX idx_products_category_id (category_id),
  INDEX idx_products_category    (category),
  INDEX idx_products_status      (status),
  INDEX idx_products_price       (price),
  INDEX idx_products_avg_rating  (avg_rating),
  FULLTEXT INDEX ft_products_search (name, description, category),
  CONSTRAINT fk_products_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- TABLE: product_variants
-- Support for product variants (size, color, SKU, stock)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_variants (
  id                CHAR(36)        NOT NULL DEFAULT (UUID()),
  product_id        CHAR(36)        NOT NULL,
  attribute_name    VARCHAR(50)     NOT NULL,                    -- e.g., 'size', 'color', 'model'
  attribute_value   VARCHAR(100)    NOT NULL,                    -- e.g., 'M', 'Red', 'Plus'
  sku               VARCHAR(100)    NOT NULL,                    -- Unique SKU for this variant
  stock_quantity    INT UNSIGNED    NOT NULL DEFAULT 0,          -- Stock for this specific variant
  price_adjustment  DECIMAL(12, 2)  NOT NULL DEFAULT 0.00,       -- Price modifier (VND)
  is_active         TINYINT(1)      NOT NULL DEFAULT 1,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_pv_sku (sku),
  INDEX idx_pv_product_id (product_id),
  INDEX idx_pv_attribute (attribute_name, attribute_value),
  INDEX idx_pv_stock (stock_quantity),
  CONSTRAINT fk_pv_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 4: orders
-- Each order belongs to one buyer and contains one product.
-- For multi-item carts, create one order per product line
-- or extend with an order_items table in a future phase.
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                 CHAR(36)        NOT NULL DEFAULT (UUID()),
  buyer_id           CHAR(36)        NOT NULL,
  seller_id          CHAR(36)        NOT NULL,
  total_amount       DECIMAL(12, 2)  NOT NULL,                    -- Tổng cộng tiền hàng (Sum of order_items subtotals)
  shipping_fee       DECIMAL(12, 2)  NOT NULL DEFAULT 0.00,       -- Phí vận chuyển (VND)
  discount_amount    DECIMAL(12, 2)  NOT NULL DEFAULT 0.00,       -- Giảm giá/Voucher (VND)
  final_total_amount DECIMAL(12, 2)  NOT NULL,                    -- total_amount + shipping_fee - discount_amount
  status             ENUM(
                       'pending',
                       'paid',
                       'shipped',
                       'completed',
                       'cancelled',
                       'refunded'
                     )               NOT NULL DEFAULT 'pending',
  shipping_address   JSON            NULL,                      -- { street, city, country, zip }
  carrier            VARCHAR(100)    NULL,
  tracking_number    VARCHAR(100)    NULL,
  notes              TEXT            NULL,
  cancelled_at       DATETIME        NULL,
  completed_at       DATETIME        NULL,
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_orders_buyer_id   (buyer_id),
  INDEX idx_orders_seller_id  (seller_id),
  INDEX idx_orders_status     (status),
  INDEX idx_orders_created_at (created_at),
  CONSTRAINT fk_orders_buyer  FOREIGN KEY (buyer_id)  REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_seller FOREIGN KEY (seller_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: order_items
-- Support for multi-item orders
-- Each row represents one product in an order
-- ============================================================
CREATE TABLE IF NOT EXISTS order_items (
  id            CHAR(36)        NOT NULL DEFAULT (UUID()),
  order_id      CHAR(36)        NOT NULL,
  product_id    CHAR(36)        NOT NULL,
  quantity      INT UNSIGNED    NOT NULL DEFAULT 1,
  unit_price    DECIMAL(12, 2)  NOT NULL,
  subtotal      DECIMAL(12, 2)  NOT NULL,                      -- quantity * unit_price
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_order_items_order_id (order_id),
  INDEX idx_order_items_product_id (product_id),
  CONSTRAINT fk_order_items_order   FOREIGN KEY (order_id)   REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: order_histories
-- Audit trail for order status changes
-- Track state transitions: pending → paid → shipped → completed
-- ============================================================
CREATE TABLE IF NOT EXISTS order_histories (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  order_id        CHAR(36)        NOT NULL,
  status          ENUM(
                    'pending',
                    'paid',
                    'shipped',
                    'completed',
                    'cancelled',
                    'refunded'
                  )               NOT NULL,
  reason          VARCHAR(255)    NULL,                      -- Why status changed
  created_by      CHAR(36)        NULL,                      -- Which user made change (buyer, seller, admin, or system)
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_oh_order_id (order_id),
  INDEX idx_oh_status (status),
  INDEX idx_oh_created_at (created_at),
  CONSTRAINT fk_oh_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_oh_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 5: escrow_transactions
-- One escrow record per order.
-- Tracks the full lifecycle of held funds:
--   pending → held → released | refunded
-- ============================================================
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  order_id        CHAR(36)        NOT NULL,
  buyer_id        CHAR(36)        NOT NULL,
  seller_id       CHAR(36)        NOT NULL,
  amount          DECIMAL(12, 2)  NOT NULL,
  platform_fee    DECIMAL(12, 2)  NOT NULL DEFAULT 0.00,     -- e.g. 2.5% of amount
  net_amount      DECIMAL(12, 2)  NOT NULL,                  -- amount − platform_fee
  charge_id       VARCHAR(64)     NULL,                      -- external charge identifier
  transfer_id     VARCHAR(64)     NULL,                      -- external transfer/payout id
  refund_id       VARCHAR(64)     NULL,                      -- external refund id
  gateway         VARCHAR(50)     NULL,                      -- payment gateway identifier
  status          ENUM(
                    'pending',
                    'processing',
                    'held',
                    'releasing',
                    'refunding',
                    'released',
                    'refunded',
                    'disputed'
                  )               NOT NULL DEFAULT 'pending',
  held_at         DATETIME        NULL,                      -- money entered escrow
  released_at     DATETIME        NULL,                      -- money sent to seller
  refunded_at     DATETIME        NULL,                      -- money returned to buyer
  release_reason  VARCHAR(255)    NULL,
  refund_reason   VARCHAR(255)    NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_escrow_order_id  (order_id),                 -- 1 escrow per order
  INDEX idx_escrow_buyer_id      (buyer_id),
  INDEX idx_escrow_seller_id     (seller_id),
  INDEX idx_escrow_status        (status),

  CONSTRAINT fk_escrow_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_escrow_buyer FOREIGN KEY (buyer_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_escrow_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE RESTRICT

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 6: reviews
-- Buyers can review a product only after a completed order.
-- One review per buyer per product (enforced by unique key).
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id          CHAR(36)        NOT NULL DEFAULT (UUID()),
  product_id  CHAR(36)        NOT NULL,
  buyer_id    CHAR(36)        NOT NULL,
  order_id    CHAR(36)        NOT NULL,                      -- must be a completed order
  rating      TINYINT UNSIGNED NOT NULL,                     -- 1–5
  title       VARCHAR(150)    NULL,
  body        TEXT            NULL,
  is_verified TINYINT(1)      NOT NULL DEFAULT 1,            -- verified purchase
  is_hidden   TINYINT(1)      NOT NULL DEFAULT 0,            -- admin can hide
  seller_reply_text TEXT       NULL,                          -- NEW: Seller response to review
  seller_reply_at   DATETIME   NULL,                          -- NEW: When seller replied
  is_reply_hidden   TINYINT(1) NOT NULL DEFAULT 0,            -- NEW: Admin can hide reply
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_review_buyer_product (buyer_id, product_id), -- one review per purchase
  INDEX idx_reviews_product_id (product_id),
  INDEX idx_reviews_buyer_id   (buyer_id),
  INDEX idx_reviews_rating     (rating),
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_buyer   FOREIGN KEY (buyer_id)
    REFERENCES users    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reviews_order   FOREIGN KEY (order_id)
    REFERENCES orders   (id) ON DELETE RESTRICT,
  CONSTRAINT chk_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 7: logs
-- Immutable audit trail for all security-sensitive events.
-- Never UPDATE or DELETE rows — only INSERT.
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     CHAR(36)        NULL,                          -- NULL for unauthenticated events
  event_type  VARCHAR(80)     NOT NULL,                      -- e.g. LOGIN_SUCCESS, ORDER_CREATED
  severity    ENUM(
                'info',
                'warn',
                'error',
                'critical'
              )               NOT NULL DEFAULT 'info',
  ip_address  VARCHAR(45)     NULL,
  user_agent  VARCHAR(300)    NULL,
  endpoint    VARCHAR(200)    NULL,
  method      VARCHAR(10)     NULL,
  status_code SMALLINT        NULL,
  payload     JSON            NULL,                          -- sanitized request context
  message     TEXT            NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_logs_user_id    (user_id),
  INDEX idx_logs_event_type (event_type),
  INDEX idx_logs_severity   (severity),
  INDEX idx_logs_created_at (created_at),
  INDEX idx_logs_ip_address (ip_address),
  CONSTRAINT fk_logs_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 8: otp_codes
-- Short-lived OTP codes for MFA and email verification.
-- Codes are bcrypt-hashed before storage.
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_codes (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)     NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,                         -- bcrypt hash of 6-digit code
  purpose     ENUM(
                'email_verify',
                'mfa_login',
                'password_reset'
              )            NOT NULL,
  expires_at  DATETIME     NOT NULL,
  used        TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_otp_user_id   (user_id),
  INDEX idx_otp_purpose   (purpose),
  INDEX idx_otp_expires   (expires_at),
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ============================================================
-- TABLE 9: trusted_devices
-- Stores per-user remembered devices for "remember this device" MFA feature.
-- ============================================================
CREATE TABLE IF NOT EXISTS trusted_devices (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id            CHAR(36)     NOT NULL,
  device_fingerprint VARCHAR(128) NOT NULL, -- SHA-256 hex
  device_name        VARCHAR(150) NULL,
  ip_address         VARCHAR(45)  NULL,
  remembered_until   DATETIME     NULL,
  last_used_at       DATETIME     NULL,
  revoked            TINYINT(1)   NOT NULL DEFAULT 0,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_td_user_id (user_id),
  INDEX idx_td_fingerprint (device_fingerprint),
  CONSTRAINT fk_td_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outbox_events (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSON NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_by VARCHAR(100) NULL,
  locked_at DATETIME NULL,
  status ENUM('pending','in_progress','succeeded','failed') NOT NULL DEFAULT 'pending',
  result JSON NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_outbox_status_next (status, next_run_at),
  INDEX idx_outbox_aggregate (aggregate_type, aggregate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================
-- PHASE 12: AI CUSTOMER SUPPORT (CHAT SYSTEM)
-- ==========================================================

-- 1. Table to store chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    user_id CHAR(36) NOT NULL,
    status ENUM('active', 'resolved', 'handoff_to_admin') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_chat_session_user (user_id),
    CONSTRAINT fk_chat_session_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Table to store individual messages within a session
CREATE TABLE IF NOT EXISTS chat_messages (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    session_id CHAR(36) NOT NULL,
    sender_type ENUM('user', 'ai', 'admin') NOT NULL,
    message_text TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_chat_message_session (session_id),
    CONSTRAINT fk_chat_message_session FOREIGN KEY (session_id)
        REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: sample_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS sample_requests (
  id             CHAR(36)        NOT NULL DEFAULT (UUID()),
  product_id     CHAR(36)        NOT NULL,
  buyer_id       CHAR(36)        NOT NULL,
  seller_id      CHAR(36)        NOT NULL,
  deposit_amount DECIMAL(12, 2)  NOT NULL,
  notes          TEXT            NULL,
  status         ENUM(
                   'requested',
                   'approved',
                   'shipped',
                   'returned',
                   'cancelled',
                   'converted_to_order'
                 )               NOT NULL DEFAULT 'requested',
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_sr_buyer_id  (buyer_id),
  INDEX idx_sr_seller_id (seller_id),
  INDEX idx_sr_product_id(product_id),
  CONSTRAINT fk_sr_buyer   FOREIGN KEY (buyer_id)   REFERENCES users    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sr_seller  FOREIGN KEY (seller_id)  REFERENCES users    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sr_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: disputes
-- ============================================================
CREATE TABLE IF NOT EXISTS disputes (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  order_id        CHAR(36)        NOT NULL,
  complainant_id  CHAR(36)        NOT NULL,
  reason          TEXT            NOT NULL,
  evidence_urls   JSON            NULL,                          -- NEW: JSON array of URLs
  status          ENUM(
                    'pending',
                    'resolved_refunded',
                    'resolved_released',
                    'rejected'
                  )               NOT NULL DEFAULT 'pending',
  resolved_at     DATETIME        NULL,
  resolved_by     CHAR(36)        NULL,                          -- NEW: Admin who resolved
  resolution_note TEXT            NULL,                          -- NEW: Admin notes
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_disputes_order_id       (order_id),
  INDEX idx_disputes_complainant_id (complainant_id),
  INDEX idx_disputes_status         (status),
  CONSTRAINT fk_disputes_order      FOREIGN KEY (order_id)       REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_disputes_complainant FOREIGN KEY (complainant_id) REFERENCES users  (id) ON DELETE RESTRICT,
  CONSTRAINT fk_disputes_resolved_by FOREIGN KEY (resolved_by)    REFERENCES users  (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: dispute_chats
-- NEW: Chat messages for dispute negotiation between buyer/seller
-- ============================================================
CREATE TABLE IF NOT EXISTS dispute_chats (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  dispute_id      CHAR(36)        NOT NULL,
  sender_id       CHAR(36)        NOT NULL,                      -- buyer or seller
  message         TEXT            NOT NULL,
  attachments     JSON            NULL,                          -- URLs for images/files
  is_read         TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_dc_dispute_id   (dispute_id),
  INDEX idx_dc_sender_id    (sender_id),
  INDEX idx_dc_created_at   (created_at),
  CONSTRAINT fk_dc_dispute  FOREIGN KEY (dispute_id) REFERENCES disputes  (id) ON DELETE CASCADE,
  CONSTRAINT fk_dc_sender   FOREIGN KEY (sender_id)  REFERENCES users     (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. (Optional) Table to store platform policies for RAG context
CREATE TABLE IF NOT EXISTS knowledge_base (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    topic VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_kb_topic (topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default knowledge base
INSERT IGNORE INTO knowledge_base (id, topic, content) VALUES 
(UUID(), 'platform_fee', 'O''Future charges a 2.5% platform fee on all successful transactions.'),
(UUID(), 'escrow_policy', 'Funds are held in Escrow until the buyer confirms delivery. If no dispute is filed within 3 days of delivery, funds are automatically released to the seller.'),
(UUID(), 'dispute_process', 'If a buyer receives damaged goods, they can open a dispute. Admin will review evidence before refunding.');

CREATE TABLE payments (
  id VARCHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  order_id VARCHAR(36) NOT NULL,
  method ENUM('cod', 'momo', 'qr') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'success', 'failed', 'expired') DEFAULT 'pending',
  transaction_id VARCHAR(100),
  payment_data JSON,
  expires_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX(order_id),
  INDEX(status)
)ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: wallets
-- Stores virtual wallet balance for buyers and sellers.
-- ============================================================
CREATE TABLE IF NOT EXISTS wallets (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  user_id         CHAR(36)        NOT NULL,
  balance         DECIMAL(12, 2)  NOT NULL DEFAULT 0.00,  -- in VND
  currency        VARCHAR(3)      NOT NULL DEFAULT 'VND',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_wallet_user_id (user_id),
  INDEX idx_wallet_user_id (user_id),
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: wallet_transactions
-- Tracks all wallet transactions (deposits, withdrawals, transfers).
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                CHAR(36)        NOT NULL DEFAULT (UUID()),
  wallet_id         CHAR(36)        NOT NULL,
  user_id           CHAR(36)        NOT NULL,
  type              ENUM(
                      'deposit',          -- funds added (MoMo, QR, refund)
                      'withdrawal',       -- funds removed (seller withdrawal)
                      'transfer_in',      -- received from escrow release
                      'transfer_out',     -- funds sent (order payment, etc)
                      'platform_fee',     -- platform deduction
                      'adjustment'        -- admin adjustment
                    )               NOT NULL,
  amount            DECIMAL(12, 2)  NOT NULL,
  description       VARCHAR(255)    NULL,
  reference_id      VARCHAR(100)    NULL,  -- order_id, escrow_id, payment_id, etc
  reference_type    VARCHAR(50)     NULL,  -- 'order', 'escrow', 'momo_payment', etc
  status            ENUM(
                      'completed',
                      'pending',
                      'failed'
                    )               NOT NULL DEFAULT 'completed',
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_wt_wallet_id (wallet_id),
  INDEX idx_wt_user_id (user_id),
  INDEX idx_wt_type (type),
  INDEX idx_wt_status (status),
  INDEX idx_wt_reference (reference_type, reference_id),
  INDEX idx_wt_created_at (created_at),
  CONSTRAINT fk_wt_wallet FOREIGN KEY (wallet_id)
    REFERENCES wallets (id) ON DELETE CASCADE,
  CONSTRAINT fk_wt_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 12: notifications
-- Stores user notifications for orders, escrow, chats, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  user_id         CHAR(36)        NOT NULL,
  type            VARCHAR(50)     NOT NULL,                     -- 'order', 'escrow', 'chat', 'review', 'alert'
  title           VARCHAR(255)    NOT NULL,
  message         TEXT            NULL,
  link            VARCHAR(255)    NULL,                         -- URL to relevant page
  is_read         TINYINT(1)      NOT NULL DEFAULT 0,           -- 0 = unread, 1 = read
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_user_read (user_id, is_read),
  INDEX idx_user_created (user_id, created_at DESC),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: seller_profile_change_requests
-- Seller profile changes must be approved by admin.
-- ============================================================
CREATE TABLE IF NOT EXISTS seller_profile_change_requests (
  id                CHAR(36)        NOT NULL DEFAULT (UUID()),
  seller_id         CHAR(36)        NOT NULL,
  requested_changes JSON            NOT NULL,
  status            ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  admin_note        TEXT            NULL,
  reviewed_by       CHAR(36)        NULL,
  reviewed_at       DATETIME        NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_spcr_seller (seller_id),
  INDEX idx_spcr_status (status),
  CONSTRAINT fk_spcr_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_spcr_admin FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Re-enable foreign key checks
-- ============================================================
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- SEED: Default admin account
-- Password: Admin@OFuture2024!  (change immediately after setup)
-- Hash generated with bcrypt rounds=12
-- ============================================================
INSERT IGNORE INTO users (
  id, email, username, password_hash, role, full_name, is_active, is_verified
) VALUES (
  UUID(),
  'admin@ofuture.com',
  'admin',
  '$2b$12$jwjgOAebdQ5n6xyFXnotbu72QNsVUAKSMwfy9bX2UiqGKhZ/h5cX6',
  'admin',
  'System Administrator',
  1,
  1
);

-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- View: product summary with seller info
CREATE OR REPLACE VIEW v_product_listing AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.category,
  p.price,
  p.stock_quantity,
  p.status,
  p.avg_rating,
  p.review_count,
  p.image_urls,
  p.created_at,
  u.username    AS seller_username,
  u.full_name   AS seller_name
FROM products p
JOIN users u ON u.id = p.seller_id
WHERE p.status = 'active';

-- View: order summary with buyer and product info (Hỗ trợ giỏ hàng nhiều sản phẩm)
CREATE OR REPLACE VIEW v_order_summary AS
SELECT
  o.id            AS order_id,
  o.status        AS order_status,
  
  (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS quantity,
  (SELECT unit_price FROM order_items WHERE order_id = o.id LIMIT 1) AS unit_price,
  
  o.final_total_amount AS total_amount, 
  o.created_at,
  b.username      AS buyer_username,
  b.email         AS buyer_email,
  s.username      AS seller_username,
  
  (SELECT p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id ORDER BY oi.created_at ASC LIMIT 1) AS product_name,
  (SELECT product_id FROM order_items WHERE order_id = o.id ORDER BY created_at ASC LIMIT 1) AS product_id,
  
  e.status        AS escrow_status,
  e.amount        AS escrow_amount

FROM orders o
JOIN users    b ON b.id = o.buyer_id
JOIN users    s ON s.id = o.seller_id
LEFT JOIN escrow_transactions e ON e.order_id = o.id;

