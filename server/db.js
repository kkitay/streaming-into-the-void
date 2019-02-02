const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'dev' ? false : true,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
}
