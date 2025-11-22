const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');

// Улучшенная конфигурация PostgreSQL с обработкой ошибок
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5, // Ограничиваем соединения
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Тестирование подключения к БД с повторными попытками
async function testConnection() {
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const client = await pool.connect();
      console.log('✅ Connected to PostgreSQL database');
      client.release();
      return true;
    } catch (error) {
      attempts++;
      console.error(`❌ Database connection attempt ${attempts} failed:`, error.message);
      
      if (attempts < maxAttempts) {
        console.log(`🔄 Retrying in 3 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.error('💥 All database connection attempts failed');
        return false;
      }
    }
  }
}

// Инициализация базы данных
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
    console.error('❌ Database initialization error:', error.message);
    // Не прерываем выполнение - приложение может работать без некоторых таблиц
  }
}

// Улучшенная CORS конфигурация
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
      process.env.ALLOWED_ORIGINS.split(',') : 
      ['https://makaka119911-oss.github.io', 'http://localhost:3000'];
    
    // Разрешить запросы без origin (мобильные приложения, curl и т.д.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('🔒 CORS blocked for origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Обработка OPTIONS запросов для CORS
app.options('*', cors());

// ============ HEALTHCHECK ENDPOINTS ============
// Упрощенный health check для Railway
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Tatiana Server',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Health check endpoint для Railway
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// API health check с проверкой БД
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

    // Отправка в Telegram
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

    // Отправка в Telegram
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
      LEFT JOIN test_results t ON r.registration_id = t.registration_id
      ORDER BY r.created_at DESC
      LIMIT 1000
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
    const registrations = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC LIMIT 10');
    const testResults = await pool.query('SELECT * FROM test_results ORDER BY created_at DESC LIMIT 10');
    
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

// Функция для отправки в Telegram
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
      const errorText = await response.text();
      console.error('❌ Telegram error:', errorText);
    }

  } catch (error) {
    console.error('❌ Telegram error:', error.message);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, starting graceful shutdown');
  await pool.end();
  console.log('✅ Database connections closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, starting graceful shutdown');
  await pool.end();
  console.log('✅ Database connections closed');
  process.exit(0);
});

// Обработка неперехваченных ошибок
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
  process.exit(1);
});

// Запуск сервера
async function startServer() {
  try {
    console.log('🔧 Initializing server...');
    
    // Инициализация базы данных
    await initializeDatabase();
    
    // Тестирование подключения
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
      console.log('⚠️ Starting server without database connection');
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🎯 SERVER STARTED SUCCESSFULLY');
      console.log('========================================');
      console.log(`📍 Server: http://0.0.0.0:${PORT}`);
      console.log(`🌐 Health: http://0.0.0.0:${PORT}/health`);
      console.log(`🌐 API Health: http://0.0.0.0:${PORT}/api/health`);
      console.log(`📝 Register: http://0.0.0.0:${PORT}/api/register`);
      console.log(`📊 Test result: http://0.0.0.0:${PORT}/api/test-result`);
      console.log(`📁 Archive: http://0.0.0.0:${PORT}/api/archive`);
      console.log(`🔍 Debug: http://0.0.0.0:${PORT}/api/debug/data`);
      console.log('========================================\n');
    });

    // Health check для Railway
    server.keepAliveTimeout = 120000;
    server.headersTimeout = 120000;

  } catch (error) {
    console.error('💥 FAILED TO START SERVER:', error);
    process.exit(1);
  }
}

startServer();
