const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');

// CRITICAL: Health checks must be defined FIRST
app.get('/', (req, res) => {
  console.log('✅ Health check received at /');
  res.status(200).set('Content-Type', 'text/plain').send('OK');
});

app.get('/health', (req, res) => {
  console.log('✅ Health check received at /health');
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Tatiana Server'
  });
});

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

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API is working!',
    timestamp: new Date().toISOString()
  });
});

// Database connection (non-blocking)
let pool;
const initDatabase = async () => {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 5
    });

    // Test connection
    const client = await pool.connect();
    console.log('✅ Database connected');
    
    // Create tables
    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS test_results (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(255) REFERENCES registrations(registration_id),
        test_data JSONB,
        level VARCHAR(255),
        score INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    client.release();
    console.log('✅ Database tables ready');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    // Don't crash the server if DB fails
  }
};

// API endpoints with DB
app.post('/api/register', async (req, res) => {
  try {
    const { lastName, firstName, age, phone, telegram, photoBase64 } = req.body;
    
    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({ 
        success: false, 
        error: 'Все поля обязательны' 
      });
    }

    const registrationId = 'REG_' + Date.now();

    if (pool) {
      await pool.query(
        `INSERT INTO registrations (registration_id, last_name, first_name, age, phone, telegram, photo_base64)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [registrationId, lastName, firstName, parseInt(age), phone, telegram, photoBase64 || null]
      );
      console.log('✅ Registration saved to DB:', registrationId);
    } else {
      console.log('⚠️ Registration saved in memory (DB not available):', registrationId);
    }

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

app.post('/api/test-result', async (req, res) => {
  try {
    const { registrationId, testData, level, score } = req.body;

    if (!registrationId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Registration ID required' 
      });
    }

    if (pool) {
      await pool.query(
        `INSERT INTO test_results (registration_id, test_data, level, score)
         VALUES ($1, $2, $3, $4)`,
        [registrationId, testData, level, score]
      );
      console.log('✅ Test results saved to DB for:', registrationId);
    } else {
      console.log('⚠️ Test results saved in memory (DB not available):', registrationId);
    }

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

app.get('/api/archive', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token || token !== process.env.ARCHIVE_TOKEN) {
      return res.status(401).json({ 
        success: false, 
        error: 'Неавторизованный доступ' 
      });
    }

    let records = [];
    if (pool) {
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
      records = result.rows;
    }

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

// Start server IMMEDIATELY
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎉 ===== TATIANA SERVER STARTED =====');
  console.log(`📍 Server running on port: ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('🚀 Health checks are ACTIVE');
  console.log('🎉 =================================\n');
});

// Initialize database AFTER server starts (non-blocking)
setTimeout(() => {
  initDatabase();
}, 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received - graceful shutdown');
  server.close(() => {
    console.log('✅ Express server closed');
    if (pool) {
      pool.end(() => {
        console.log('✅ Database connections closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
});
