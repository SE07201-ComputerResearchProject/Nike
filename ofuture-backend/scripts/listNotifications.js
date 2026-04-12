const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ofuture_db',
  });
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT id,user_id,type,title,is_read,created_at FROM notifications ORDER BY created_at DESC LIMIT 5');
    console.log(rows);
  } finally {
    conn.release();
    process.exit(0);
  }
})();