const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Create table if not exists
pool.query(`
  CREATE TABLE IF NOT EXISTS archive (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    phone VARCHAR(255),
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
    const values = [userId, firstName, lastName, phone, email, telegram, age, libidonLevel, photo, JSON.stringify(testData), JSON.stringify(testResult)];
    
    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Get archive by user ID
app.get('/api/archive/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const query = 'SELECT * FROM archive WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Search archive by libido level
app.get('/api/archive/filter/:libidonLevel', async (req, res) => {
  try {
    const { libidonLevel } = req.params;
    const query = 'SELECT * FROM archive WHERE libido_level = $1';
    const result = await pool.query(query, [libidonLevel]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GET - Get ALL archive data (with password protection)
app.get('/api/archive', async (req, res) => {
  try {
    // Check password from Authorization header or query params
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    const queryPassword = req.query.password;
    const bodyPassword = req.body?.password;
    
    const ARCHIVE_PASSWORD = 'admin19191';
    
    if (token !== ARCHIVE_PASSWORD && queryPassword !== ARCHIVE_PASSWORD && bodyPassword !== ARCHIVE_PASSWORD) {
      return res.status(401).json({ success: false, error: 'Unauthorized - invalid password' });
    }
    
    const query = 'SELECT id, user_id, first_name, last_name, phone, email, telegram, age, libido_level, test_result, created_at FROM archive ORDER BY created_at DESC';
    const result = await pool.query(query);
    
    // Format response for archive table
    const formattedData = result.rows.map(row => ({
      fio: `${row.first_name} ${row.last_name}`,
      date: row.created_at,
      testResult: row.libido_level,
      phone: row.phone,
      email: row.email,
      telegram: row.telegram,
      age: row.age
    }));
    
    res.json(formattedData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE - Delete archive record
app.delete('/api/archive/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const query = 'DELETE FROM archive WHERE user_id = $1 RETURNING *';
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    res.json({ success: true, message: 'Record deleted', data: result.rows[0] });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


app.listen(port, () => {
  console.log(`Tatiana-Server app listening on port ${port}`);
});
