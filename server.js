const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

// Initialize database
async function initializeDatabase() {
  try {
    console.log('🔄 Checking database tables...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(50) UNIQUE NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        age INTEGER NOT NULL,
        phone VARCHAR(20) NOT NULL,
        telegram VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_results (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(50) NOT NULL,
        test_type VARCHAR(50) NOT NULL,
        libido_level VARCHAR(100) NOT NULL,
        score INTEGER NOT NULL,
        test_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables ready');
  } catch (error) {
    console.error('❌ Database error:', error.message);
  }
}

// Middleware
// ============ CORS CONFIGURATION ============
// В server.js замените блок CORS на этот:
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://makaka119911-oss.github.io',
      'http://localhost:3000',
      'https://makaka119911-oss.github.io/Tatiana'
    ];
    
    // Разрешить запросы без origin (мобильные приложения и т.д.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Блокировано CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

// ============ HEALTHCHECK ENDPOINTS ============
// Root endpoint for Railway healthcheck
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Tatiana Server',
    timestamp: new Date().toISOString()
  });
});

// API healthcheck
app.get('/api/health', async (req, res) => {
  try {
    const dbConnected = await testConnection();
    res.json({ 
      status: 'ok', 
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============ API ROUTES ============
app.post('/api/register', async (req, res) => {
  try {
    const { lastName, firstName, age, phone, telegram } = req.body;
    
    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    const registrationId = 'REG_' + Date.now();
    
    await pool.query(
      `INSERT INTO registrations (registration_id, last_name, first_name, age, phone, telegram) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [registrationId, lastName, firstName, parseInt(age), phone, telegram]
    );

    console.log('✅ Registration saved:', registrationId);

    // Send to Telegram
    await sendToTelegram('registration', {
      lastName, firstName, age, phone, telegram, registrationId
    });

    res.json({ 
      success: true, 
      registrationId,
      message: 'Регистрация успешно завершена!' 
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/test-result', async (req, res) => {
  try {
    const { registrationId, level, score, testData } = req.body;
    
    if (!registrationId || !level) {
      return res.status(400).json({ success: false, error: 'Registration ID и уровень обязательны' });
    }

    await pool.query(
      `INSERT INTO test_results (registration_id, test_type, libido_level, score, test_data) 
       VALUES ($1, $2, $3, $4, $5)`,
      [registrationId, testData?.test_type || 'regular', level, score || 0, testData]
    );

    console.log('✅ Test result saved:', registrationId);

    // Send to Telegram
    await sendToTelegram('test_result', {
      registrationId, level, score, testData
    });

    res.json({ 
      success: true, 
      message: 'Результаты теста сохранены!' 
    });

  } catch (error) {
    console.error('❌ Test result error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/archive', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }

    const token = authHeader.replace('Bearer ', '');
    if (token !== process.env.ARCHIVE_TOKEN) {
      return res.status(401).json({ success: false, error: 'Неверный токен доступа' });
    }

    const result = await pool.query(`
      SELECT 
        r.registration_id,
        r.first_name,
        r.last_name,
        r.age,
        r.phone,
        r.telegram,
        r.created_at as registered_at,
        t.libido_level,
        t.score,
        t.created_at as tested_at
      FROM registrations r
      JOIN test_results t ON r.registration_id = t.registration_id
      ORDER BY r.created_at DESC
    `);

    const records = result.rows.map(row => ({
      fio: `${row.last_name} ${row.first_name}`,
      age: row.age,
      phone: row.phone,
      telegram: row.telegram,
      level: row.libido_level,
      score: row.score,
      date: row.tested_at || row.registered_at,
      registrationId: row.registration_id
    }));

    res.json({ 
      success: true, 
      records, 
      count: records.length 
    });

  } catch (error) {
    console.error('❌ Archive error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/debug/data', async (req, res) => {
  try {
    const registrations = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC');
    const testResults = await pool.query('SELECT * FROM test_results ORDER BY created_at DESC');
    
    res.json({
      registrations: registrations.rows,
      testResults: testResults.rows,
      counts: {
        registrations: registrations.rows.length,
        testResults: testResults.rows.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Telegram function
async function sendToTelegram(type, data) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) {
      console.log('⚠️ Telegram credentials not found');
      return;
    }

    let message = '';
    
    if (type === 'registration') {
      message = `🌟 *НОВАЯ РЕГИСТРАЦИЯ* 🌟\n\n` +
                `👤 *${data.lastName} ${data.firstName}*\n` +
                `📞 ${data.phone} | 👤 ${data.age} лет\n` +
                `📱 ${data.telegram}\n` +
                `🆔 ${data.registrationId}`;
    } else if (type === 'test_result') {
      message = `📊 *РЕЗУЛЬТАТ ТЕСТА* 📊\n\n` +
                `🆔 ${data.registrationId}\n` +
                `📈 Уровень: ${data.level}\n` +
                `⭐ Баллы: ${data.score || 'N/A'}`;
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    if (response.ok) {
      console.log('✅ Message sent to Telegram');
    } else {
      console.error('❌ Telegram error:', await response.text());
    }

  } catch (error) {
    console.error('❌ Telegram error:', error.message);
  }
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Start server
async function startServer() {
  try {
    console.log('🔧 Initializing server...');
    
    // Initialize database
    await initializeDatabase();
    
    // Test connection
    await testConnection();

    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🎯 SERVER STARTED SUCCESSFULLY');
      console.log('========================================');
      console.log(`📍 Server: http://0.0.0.0:${PORT}`);
      console.log(`🌐 Health: http://0.0.0.0:${PORT}/`);
      console.log(`🌐 API Health: http://0.0.0.0:${PORT}/api/health`);
      console.log(`📝 Register: http://0.0.0.0:${PORT}/api/register`);
      console.log(`📊 Test result: http://0.0.0.0:${PORT}/api/test-result`);
      console.log(`📁 Archive: http://0.0.0.0:${PORT}/api/archive`);
      console.log(`🔍 Debug: http://0.0.0.0:${PORT}/api/debug/data`);
      console.log('========================================\n');
    });
  } catch (error) {
    console.error('💥 FAILED TO START SERVER:', error);
    process.exit(1);
  }
}

startServer();
