const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');
console.log('📊 Environment:', process.env.NODE_ENV);
console.log('🔗 Database URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [
    'https://makaka119911-oss.github.io',
    'http://localhost:3000'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// PostgreSQL connection with better error handling
let pool;

const initializePool = () => {
  try {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      console.error('❌ DATABASE_URL is not defined');
      return null;
    }

    const poolConfig = {
      connectionString: connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { 
        rejectUnauthorized: false 
      } : false,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10
    };

    console.log('🔧 Creating PostgreSQL pool...');
    pool = new Pool(poolConfig);
    
    // Test connection
    pool.on('connect', () => {
      console.log('✅ PostgreSQL client connected');
    });

    pool.on('error', (err) => {
      console.error('❌ PostgreSQL pool error:', err);
    });

    return pool;
  } catch (error) {
    console.error('❌ Failed to create PostgreSQL pool:', error);
    return null;
  }
};

// Initialize database tables
const initDatabase = async () => {
  if (!pool) {
    console.error('❌ Database pool not initialized');
    return false;
  }

  try {
    const client = await pool.connect();
    console.log('📊 Initializing database tables...');

    // Create registrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(100) UNIQUE NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        age INTEGER NOT NULL,
        phone VARCHAR(50) NOT NULL,
        telegram VARCHAR(100) NOT NULL,
        photo_data TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create test_results table
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_results (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(100) NOT NULL,
        test_type VARCHAR(50) NOT NULL,
        level VARCHAR(50) NOT NULL,
        score INTEGER NOT NULL,
        test_data JSONB,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (registration_id) REFERENCES registrations(registration_id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Database tables initialized successfully');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return false;
  }
};

// Health check endpoints
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'Tatiana Server API',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/health', async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        status: 'error',
        database: 'not_connected',
        message: 'Database pool not initialized'
      });
    }

    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    client.release();

    res.status(200).json({
      status: 'ok',
      database: 'connected',
      current_time: result.rows[0].current_time,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Tatiana Server API is working!',
    timestamp: new Date().toISOString()
  });
});

// Registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    console.log('📝 Registration request received');
    
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Database not available'
      });
    }

    const { lastName, firstName, age, phone, telegram, photoData } = req.body;
    
    // Validation
    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({ 
        success: false, 
        error: 'Все поля обязательны для заполнения' 
      });
    }

    const registrationId = 'REG_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    console.log('💾 Saving registration to database...');
    
    // Save to database
    const result = await pool.query(
      `INSERT INTO registrations 
       (registration_id, last_name, first_name, age, phone, telegram, photo_data) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING registration_id`,
      [registrationId, lastName, firstName, parseInt(age), phone, telegram, photoData || null]
    );

    console.log('✅ Registration saved to database:', registrationId);

    // Send to Telegram (non-blocking)
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      sendToTelegram({
        type: 'registration',
        data: { lastName, firstName, age, phone, telegram, registrationId }
      }).catch(error => {
        console.error('⚠️ Telegram notification failed:', error);
      });
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

// Test result endpoint
app.post('/api/test-result', async (req, res) => {
  try {
    console.log('🧪 Test result received');
    
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Database not available'
      });
    }

    const { registrationId, level, score, testData } = req.body;
    
    if (!registrationId || !level || score === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'Отсутствуют обязательные данные' 
      });
    }

    console.log('💾 Saving test result for:', registrationId);

    // Save test result
    await pool.query(
      `INSERT INTO test_results 
       (registration_id, test_type, level, score, test_data) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        registrationId, 
        testData?.test_type || 'regular', 
        level, 
        parseInt(score), 
        JSON.stringify(testData || {})
      ]
    );

    console.log('✅ Test result saved for:', registrationId);

    // Get user info for Telegram
    try {
      const userResult = await pool.query(
        'SELECT first_name, last_name FROM registrations WHERE registration_id = $1',
        [registrationId]
      );

      if (userResult.rows.length > 0 && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        const user = userResult.rows[0];
        sendToTelegram({
          type: 'test_result',
          data: { 
            registrationId,
            user: `${user.first_name} ${user.last_name}`,
            level, 
            score,
            testData 
          }
        }).catch(error => {
          console.error('⚠️ Telegram notification failed:', error);
        });
      }
    } catch (telegramError) {
      console.error('⚠️ User lookup for Telegram failed:', telegramError);
    }

    res.json({ 
      success: true, 
      message: 'Результаты теста сохранены!' 
    });

  } catch (error) {
    console.error('❌ Test result error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сохранения результатов' 
    });
  }
});

// Archive endpoint
app.get('/api/archive', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token || token !== process.env.ARCHIVE_TOKEN) {
      return res.status(401).json({ 
        success: false, 
        error: 'Неавторизованный доступ' 
      });
    }

    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Database not available'
      });
    }

    console.log('📊 Fetching archive data...');

    // Get combined data from both tables
    const result = await pool.query(`
      SELECT 
        r.registration_id,
        r.last_name || ' ' || r.first_name as fio,
        r.age,
        r.phone,
        r.telegram,
        r.created_at as date,
        t.level,
        t.score,
        t.test_data
      FROM registrations r
      LEFT JOIN test_results t ON r.registration_id = t.registration_id
      WHERE t.registration_id IS NOT NULL
      ORDER BY r.created_at DESC
    `);

    const records = result.rows.map(row => ({
      registrationId: row.registration_id,
      fio: row.fio,
      age: row.age,
      phone: row.phone,
      telegram: row.telegram,
      level: row.level,
      score: row.score,
      date: row.date,
      testData: row.test_data
    }));

    console.log('📊 Archive data sent:', records.length, 'records');

    res.json({
      success: true,
      records,
      count: records.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Archive error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка загрузки архива' 
    });
  }
});

// Telegram notification function
async function sendToTelegram({ type, data }) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram credentials not set');
    return;
  }

  let message = '';

  if (type === 'registration') {
    message = `🌟 *НОВАЯ РЕГИСТРАЦИЯ* 🌟\n\n` +
      `👤 *Контактная информация:*\n` +
      `   └ *Фамилия:* ${data.lastName}\n` +
      `   └ *Имя:* ${data.firstName}\n` +
      `   └ *Возраст:* ${data.age}\n` +
      `   └ *Телефон:* ${data.phone}\n` +
      `   └ *Telegram:* ${data.telegram}\n` +
      `   └ *ID:* ${data.registrationId}\n` +
      `\n⏰ *Дата регистрации:* ${new Date().toLocaleString('ru-RU')}`;
  } else if (type === 'test_result') {
    message = `📊 *НОВЫЙ РЕЗУЛЬТАТ ТЕСТА* 📊\n\n` +
      `👤 *Пользователь:* ${data.user}\n` +
      `📱 *ID:* ${data.registrationId}\n` +
      `📈 *Уровень либидо:* ${data.level}\n` +
      `⭐ *Баллы:* ${data.score}\n` +
      `\n⏰ *Дата теста:* ${new Date().toLocaleString('ru-RU')}`;
  }

  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
    }

    console.log('✅ Notification sent to Telegram');
  } catch (error) {
    console.error('❌ Telegram send error:', error);
    throw error;
  }
}

// Initialize and start server
async function startServer() {
  try {
    console.log('🔧 Initializing server...');
    
    // Initialize database pool
    const poolInitialized = initializePool();
    if (!poolInitialized) {
      throw new Error('Failed to initialize database pool');
    }

    // Wait a bit for pool to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Initialize database tables
    const dbInitialized = await initDatabase();
    if (!dbInitialized) {
      console.warn('⚠️ Database initialization failed, but continuing...');
    }

    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🎉 ===== TATIANA SERVER STARTED SUCCESSFULLY =====');
      console.log(`📍 Server URL: http://0.0.0.0:${PORT}`);
      console.log(`🌐 Health Check: http://0.0.0.0:${PORT}/health`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
      console.log(`🤖 Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
      console.log(`🔐 Archive Token: ${process.env.ARCHIVE_TOKEN ? 'Set' : 'Not set'}`);
      console.log('🎉 ===============================================\n');
    });

  } catch (error) {
    console.error('🚨 Failed to start server:', error);
    console.log('⚠️ Server will start without database connection');
    
    // Start server anyway for health checks
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚨 Server started in degraded mode on port ${PORT}`);
      console.log('❌ Database connection failed, but API will respond with errors');
    });
  }
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received - starting graceful shutdown');
  if (pool) {
    await pool.end();
    console.log('✅ Database pool closed');
  }
  process.exit(0);
});

// Start the server
startServer();
