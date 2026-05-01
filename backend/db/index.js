// backend/db/index.js
const { Pool } = require('pg');

const pool = new Pool(); 

pool.on('error', (err, client) => {
  console.error('Unexpected database error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};