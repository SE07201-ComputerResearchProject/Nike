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

-- ============================================================
-- TABLE 3: products
-- Products listed by sellers.
-- stock_quantity = 0 → automatically "out_of_stock".
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  seller_id       CHAR(36)        NOT NULL,
  name            VARCHAR(255)    NOT NULL,
  slug            VARCHAR(300)    NOT NULL,                  -- SEO-friendly URL
  description     TEXT            NULL,
  category        VARCHAR(100)    NOT NULL,
  price           DECIMAL(12, 2)  NOT NULL,
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
  INDEX idx_products_category    (category),
  INDEX idx_products_status      (status),
  INDEX idx_products_price       (price),
  INDEX idx_products_avg_rating  (avg_rating),
  FULLTEXT INDEX ft_products_search (name, description, category),
  CONSTRAINT fk_products_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE 4: orders
-- Each order belongs to one buyer and contains one product.
-- For multi-item carts, create one order per product line
-- or extend with an order_items table in a future phase.
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id              CHAR(36)        NOT NULL DEFAULT (UUID()),
  buyer_id        CHAR(36)        NOT NULL,
  seller_id       CHAR(36)        NOT NULL,
  product_id      CHAR(36)        NOT NULL,
  quantity        INT UNSIGNED    NOT NULL DEFAULT 1,
  unit_price      DECIMAL(12, 2)  NOT NULL,                  -- price snapshot at order time
  total_amount    DECIMAL(12, 2)  NOT NULL,
  status          ENUM(
                    'pending',
                    'paid',
                    'shipped',
                    'completed',
                    'cancelled',
                    'refunded'
                  )               NOT NULL DEFAULT 'pending',
  shipping_address JSON           NULL,                      -- { street, city, country, zip }
  notes           TEXT            NULL,
  cancelled_at    DATETIME        NULL,
  completed_at    DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_orders_buyer_id   (buyer_id),
  INDEX idx_orders_seller_id  (seller_id),
  INDEX idx_orders_product_id (product_id),
  INDEX idx_orders_status     (status),
  INDEX idx_orders_created_at (created_at),
  CONSTRAINT fk_orders_buyer   FOREIGN KEY (buyer_id)
    REFERENCES users    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_seller  FOREIGN KEY (seller_id)
    REFERENCES users    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT
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
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/oM8bGe1Vy',
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

-- View: order summary with buyer and product info
CREATE OR REPLACE VIEW v_order_summary AS
SELECT
  o.id            AS order_id,
  o.status        AS order_status,
  o.quantity,
  o.unit_price,
  o.total_amount,
  o.created_at,
  b.username      AS buyer_username,
  b.email         AS buyer_email,
  s.username      AS seller_username,
  p.name          AS product_name,
  p.id            AS product_id,
  e.status        AS escrow_status,
  e.amount        AS escrow_amount
FROM orders o
JOIN users    b ON b.id = o.buyer_id
JOIN users    s ON s.id = o.seller_id
JOIN products p ON p.id = o.product_id
LEFT JOIN escrow_transactions e ON e.order_id = o.id;

