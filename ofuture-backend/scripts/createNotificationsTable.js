const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ofuture_db',
    waitForConnections: true,
    connectionLimit: 2,
  });

  const sql = `
CREATE TABLE IF NOT EXISTS notifications (
  id              CHAR(36)        NOT NULL,
  user_id         CHAR(36)        NOT NULL,
  type            VARCHAR(50)     NOT NULL,
  title           VARCHAR(255)    NOT NULL,
  message         TEXT            NULL,
  link            VARCHAR(255)    NULL,
  is_read         TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_user_read (user_id, is_read),
  INDEX idx_user_created (user_id, created_at DESC)
);
`;
  try {
    const conn = await pool.getConnection();
    await conn.query(sql);
    console.log('Notifications table ensured.');
    conn.release();
    process.exit(0);
  } catch (err) {
    console.error('Failed to create notifications table:', err);
    process.exit(1);
  }
})();