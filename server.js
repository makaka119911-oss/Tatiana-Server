const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server with PostgreSQL...');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test database connection
const testDB = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connected:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Initialize database
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(255) UNIQUE NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        first_name VARCHAR(255) NOT NULL,
        age INTEGER NOT NULL,
        phone VARCHAR(255) NOT NULL,
        telegram VARCHAR(255) NOT NULL,
        photo_base64 TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_results (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(255) REFERENCES registrations(registration_id),
        test_data JSONB,
        level VARCHAR(255),
        score INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables ready');
  } catch (error) {
    console.error('❌ Database init error:', error);
  }
};

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    ['https://makaka119911-oss.github.io', 'http://localhost:3000'];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Health check - SIMPLE TEXT RESPONSE (Railway requirement)
app.get('/', (req, res) => {
  res.status(200).set('Content-Type', 'text/plain').send('OK');
});

app.get('/health', async (req, res) => {
  try {
    const dbConnected = await testDB();
    res.status(200).json({
      status: 'ok',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API is working!',
    timestamp: new Date().toISOString()
  });
});

// Register endpoint with DB
app.post('/api/register', async (req, res) => {
  try {
    const { lastName, firstName, age, phone, telegram, photoBase64 } = req.body;
    
    console.log('📝 Registration received:', { lastName, firstName, age, phone, telegram });

    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({ 
        success: false, 
        error: 'Все поля обязательны' 
      });
    }

    const registrationId = 'REG_' + Date.now();

    // Save to database
    await pool.query(
      `INSERT INTO registrations (registration_id, last_name, first_name, age, phone, telegram, photo_base64)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [registrationId, lastName, firstName, parseInt(age), phone, telegram, photoBase64 || null]
    );

    console.log('✅ Registration saved to DB:', registrationId);

    res.json({ 
      success: true, 
      registrationId,
      message: 'Регистрация успешно завершена!' 
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// Test results endpoint
app.post('/api/test-result', async (req, res) => {
  try {
    const { registrationId, testData, level, score } = req.body;

    if (!registrationId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Registration ID required' 
      });
    }

    await pool.query(
      `INSERT INTO test_results (registration_id, test_data, level, score)
       VALUES ($1, $2, $3, $4)`,
      [registrationId, testData, level, score]
    );

    console.log('✅ Test results saved for:', registrationId);

    res.json({ 
      success: true, 
      message: 'Test results saved!' 
    });

  } catch (error) {
    console.error('❌ Test result error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Archive endpoint
app.get('/api/archive', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token || token !== process.env.ARCHIVE_TOKEN) {
      return res.status(401).json({ 
        success: false, 
        error: 'Неавторизованный доступ' 
      });
    }

    const result = await pool.query(`
      SELECT 
        r.registration_id,
        r.last_name,
        r.first_name,
        r.age,
        r.phone,
        r.telegram,
        t.level,
        t.score,
        r.created_at as date
      FROM registrations r
      LEFT JOIN test_results t ON r.registration_id = t.registration_id
      ORDER BY r.created_at DESC
    `);

    const records = result.rows.map(row => ({
      registrationId: row.registration_id,
      fio: `${row.last_name} ${row.first_name}`,
      age: row.age,
      phone: row.phone,
      telegram: row.telegram,
      level: row.level,
      score: row.score,
      date: row.date
    }));

    res.json({ 
      success: true, 
      records,
      count: records.length 
    });

  } catch (error) {
    console.error('❌ Archive error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка загрузки архива' 
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Маршрут не найден' 
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('🚨 Server error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Внутренняя ошибка сервера' 
  });
});

// Start server with DB initialization
const startServer = async () => {
  try {
    // Test DB connection
    await testDB();
    await initDB();

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🎉 ===== TATIANA SERVER WITH POSTGRESQL STARTED =====');
      console.log(`📍 Server running on port: ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️ Database: Connected`);
      console.log('🚀 Server is ready!');
      console.log('🎉 =================================\n');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 SIGTERM received - starting graceful shutdown');
      server.close(() => {
        console.log('✅ Express server closed');
        pool.end(() => {
          console.log('✅ Database connections closed');
          process.exit(0);
        });
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
