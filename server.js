const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Database connection pool
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Create table if not exists
pool.query(`
  CREATE TABLE IF NOT EXISTS archive (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    phone VARCHAR(20),
    email VARCHAR(255),
    telegram VARCHAR(255),
    age INT,
    libido_level VARCHAR(50),
    photo BYTEA,
    test_data JSONB,
    test_result JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Routes

// POST - Save archive data
app.post('/api/archive', async (req, res) => {
  try {
    const { firstName, lastName, phone, email, telegram, age, libidonLevel, photo, testData, testResult } = req.body;
    const userId = Date.now().toString();

    const query = `
      INSERT INTO archive (user_id, first_name, last_name, phone, email, telegram, age, libido_level, photo, test_data, test_result)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId, firstName, lastName, phone, email, telegram, age, libidonLevel, photo, 
      JSON.stringify(testData), JSON.stringify(testResult)
    ]);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ Error saving archive:', error);
    res.status(500).json({ error: 'Failed to save archive' });
  }
});

// GET - Get all archive data
app.get('/api/archive', async (req, res) => {
  try {
    const { libidonLevel } = req.query;
    let query = 'SELECT * FROM archive';
    const params = [];

    if (libidonLevel) {
      query += ' WHERE libido_level = $1';
      params.push(libidonLevel);
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching archive:', error);
    res.status(500).json({ error: 'Failed to fetch archive' });
  }
});

// GET - Get by userId
app.get('/api/archive/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query('SELECT * FROM archive WHERE user_id = $1', [userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch archive' });
  }
});

// DELETE - Delete archive data
app.delete('/api/archive/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    await pool.query('DELETE FROM archive WHERE user_id = $1', [userId]);
    res.json({ success: true, message: '✅ Data deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: '✅ Server is running' });
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
