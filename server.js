const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage as fallback
const memoryStorage = {
  registrations: [],
  testResults: []
};

// PostgreSQL connection
let pool;
let dbConnected = false;

try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    dbConnected = true;
    console.log('✅ PostgreSQL pool created');
  } else {
    console.log('❌ DATABASE_URL not found, using memory storage');
  }
} catch (error) {
  console.error('❌ Database connection failed:', error.message);
  dbConnected = false;
}

// Test database connection
async function testConnection() {
  if (!pool) return false;
  
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

// Initialize database tables
async function initializeDatabase() {
  if (!dbConnected) return;

  try {
    console.log('🔄 Initializing database tables...');
    
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

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    dbConnected = false;
  }
}

// Save registration (with fallback)
async function saveRegistration(data) {
  const registrationId = 'REG_' + Date.now();
  const registrationData = {
    registration_id: registrationId,
    last_name: data.lastName,
    first_name: data.firstName,
    age: parseInt(data.age),
    phone: data.phone,
    telegram: data.telegram,
    created_at: new Date()
  };

  // Save to memory storage
  memoryStorage.registrations.push(registrationData);

  // Try to save to database
  if (dbConnected) {
    try {
      await pool.query(
        `INSERT INTO registrations (registration_id, last_name, first_name, age, phone, telegram) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [registrationId, data.lastName, data.firstName, parseInt(data.age), data.phone, data.telegram]
      );
      console.log('✅ Registration saved to database');
    } catch (error) {
      console.error('❌ Failed to save registration to database:', error.message);
    }
  }

  return registrationId;
}

// Save test result (with fallback)
async function saveTestResult(data) {
  const testResult = {
    registration_id: data.registrationId,
    test_type: data.testData?.test_type || 'regular',
    libido_level: data.level,
    score: data.score || 0,
    test_data: data.testData,
    created_at: new Date()
  };

  // Save to memory storage
  memoryStorage.testResults.push(testResult);

  // Try to save to database
  if (dbConnected) {
    try {
      await pool.query(
        `INSERT INTO test_results (registration_id, test_type, libido_level, score, test_data) 
         VALUES ($1, $2, $3, $4, $5)`,
        [data.registrationId, data.testData?.test_type || 'regular', data.level, data.score || 0, data.testData]
      );
      console.log('✅ Test result saved to database');
    } catch (error) {
      console.error('❌ Failed to save test result to database:', error.message);
    }
  }
}

// Get archive data (with fallback)
async function getArchiveData() {
  // Try to get from database first
  if (dbConnected) {
    try {
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
        WHERE t.libido_level IS NOT NULL
        ORDER BY r.created_at DESC
      `);

      console.log(`📊 Found ${result.rows.length} records in database`);
      return result.rows.map(row => ({
        fio: `${row.last_name} ${row.first_name}`,
        age: row.age,
        phone: row.phone,
        telegram: row.telegram,
        level: row.libido_level,
        score: row.score,
        date: row.tested_at || row.registered_at,
        registrationId: row.registration_id
      }));
    } catch (error) {
      console.error('❌ Error getting data from database:', error.message);
    }
  }

  // Fallback to memory storage
  console.log(`📊 Using memory storage: ${memoryStorage.registrations.length} registrations`);
  
  const archiveData = memoryStorage.registrations.map(reg => {
    const testResult = memoryStorage.testResults.find(tr => tr.registration_id === reg.registration_id);
    return {
      fio: `${reg.last_name} ${reg.first_name}`,
      age: reg.age,
      phone: reg.phone,
      telegram: reg.telegram,
      level: testResult?.libido_level || 'Тест не пройден',
      score: testResult?.score || 0,
      date: testResult?.created_at || reg.created_at,
      registrationId: reg.registration_id
    };
  }).filter(item => item.level !== 'Тест не пройден');

  return archiveData;
}

// CORS configuration
app.use(cors({
  origin: ['https://makaka119911-oss.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Health endpoint
app.get('/api/health', async (req, res) => {
  const dbStatus = dbConnected ? 'connected' : 'disconnected';
  const memoryCount = memoryStorage.registrations.length;
  
  res.json({ 
    status: 'ok', 
    database: dbStatus,
    memory_storage: {
      registrations: memoryCount,
      testResults: memoryStorage.testResults.length
    },
    timestamp: new Date().toISOString()
  });
});

// Registration endpoint
app.post('/api/register', async (req, res) => {
  console.log('📝 Registration request:', req.body);
  
  try {
    const { lastName, firstName, age, phone, telegram } = req.body;

    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({
        success: false,
        error: 'Все поля обязательны'
      });
    }

    const registrationId = await saveRegistration({
      lastName, firstName, age, phone, telegram
    });

    // Send to Telegram
    await sendRegistrationToTelegram({
      lastName, firstName, age, phone, telegram, registrationId
    });

    res.json({
      success: true,
      registrationId: registrationId,
      message: 'Регистрация успешно завершена!'
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера: ' + error.message
    });
  }
});

// Test results endpoint
app.post('/api/test-result', async (req, res) => {
  console.log('📊 Test result received:', req.body);
  
  try {
    const { registrationId, level, score, testData } = req.body;

    if (!registrationId || !level) {
      return res.status(400).json({
        success: false,
        error: 'Registration ID и уровень обязательны'
      });
    }

    await saveTestResult({
      registrationId, level, score, testData
    });

    // Send to Telegram
    await sendTestResultToTelegram({
      registrationId, level, score, testData
    });

    res.json({
      success: true,
      message: 'Результаты теста сохранены!'
    });

  } catch (error) {
    console.error('❌ Test result error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера: ' + error.message
    });
  }
});

// Archive endpoint
app.get('/api/archive', async (req, res) => {
  console.log('📁 Archive access request');
  
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Требуется авторизация'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const expectedToken = 'tatiana_archive_2024_LBg_makaka_9f3a7c2e8d1b5a4c6';

    if (token !== expectedToken) {
      return res.status(401).json({
        success: false,
        error: 'Неверный токен доступа'
      });
    }

    const archiveData = await getArchiveData();
    
    console.log(`📊 Sending archive data: ${archiveData.length} records`);

    res.json({
      success: true,
      records: archiveData,
      count: archiveData.length,
      storage: dbConnected ? 'database' : 'memory',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Archive error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка доступа к архиву: ' + error.message
    });
  }
});

// Debug endpoint
app.get('/api/debug/data', async (req, res) => {
  try {
    let dbRegistrations = [];
    let dbTestResults = [];

    if (dbConnected) {
      try {
        dbRegistrations = (await pool.query('SELECT * FROM registrations ORDER BY created_at DESC')).rows;
        dbTestResults = (await pool.query('SELECT * FROM test_results ORDER BY created_at DESC')).rows;
      } catch (error) {
        console.error('Error fetching from database:', error);
      }
    }

    res.json({
      database: {
        connected: dbConnected,
        registrations: dbRegistrations,
        testResults: dbTestResults
      },
      memory: {
        registrations: memoryStorage.registrations,
        testResults: memoryStorage.testResults
      },
      counts: {
        database_registrations: dbRegistrations.length,
        database_testResults: dbTestResults.length,
        memory_registrations: memoryStorage.registrations.length,
        memory_testResults: memoryStorage.testResults.length
      }
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Telegram functions (оставить как было)
async function sendRegistrationToTelegram(data) {
  try {
    const TELEGRAM_BOT_TOKEN = '8402206062:AAEJim1GkriKqY_o1mOo0YWSWQDdw5Qy2h0';
    const TELEGRAM_CHAT_ID = '-1002313355102';

    let message = `🌟 *НОВАЯ РЕГИСТРАЦИЯ* 🌟\n\n`;
    message += `👤 *Контактная информация:*\n`;
    message += `   └ *Фамилия:* ${data.lastName}\n`;
    message += `   └ *Имя:* ${data.firstName}\n`;
    message += `   └ *Возраст:* ${data.age}\n`;
    message += `   └ *Телефон:* ${data.phone}\n`;
    message += `   └ *Telegram:* ${data.telegram}\n`;
    message += `   └ *ID регистрации:* ${data.registrationId}\n`;
    message += `\n⏰ *Дата регистрации:* ${new Date().toLocaleString('ru-RU')}`;

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();
    
    if (!response.ok || !result.ok) {
      console.error('Telegram API error:', result);
    } else {
      console.log('✅ Registration sent to Telegram');
    }

  } catch (error) {
    console.error('Error sending to Telegram:', error);
  }
}

async function sendTestResultToTelegram(data) {
  try {
    const TELEGRAM_BOT_TOKEN = '8402206062:AAEJim1GkriKqY_o1mOo0YWSWQDdw5Qy2h0';
    const TELEGRAM_CHAT_ID = '-1002313355102';

    let message = `📊 *НОВЫЙ РЕЗУЛЬТАТ ТЕСТА* 📊\n\n`;
    message += `🆔 *ID регистрации:* ${data.registrationId}\n`;
    message += `📈 *Уровень либидо:* ${data.level}\n`;
    message += `⭐ *Баллы:* ${data.score || 'N/A'}\n`;
    message += `\n⏰ *Дата теста:* ${new Date().toLocaleString('ru-RU')}`;

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();
    
    if (!response.ok || !result.ok) {
      console.error('Telegram API error:', result);
    } else {
      console.log('✅ Test result sent to Telegram');
    }

  } catch (error) {
    console.error('Error sending to Telegram:', error);
  }
}

// Start server
async function startServer() {
  console.log('🚀 Starting Tatiana Server...');
  console.log('📊 Environment:', process.env.NODE_ENV || 'development');
  console.log('🔗 Database URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
  
  if (process.env.DATABASE_URL) {
    dbConnected = await testConnection();
    if (dbConnected) {
      await initializeDatabase();
    }
  }

  app.listen(PORT, () => {
    console.log(`🎯 Server running on port ${PORT}`);
    console.log(`📍 Endpoints available:`);
    console.log(`   GET  /api/health`);
    console.log(`   POST /api/register`);
    console.log(`   POST /api/test-result`);
    console.log(`   GET  /api/archive`);
    console.log(`   GET  /api/debug/data`);
    console.log(`🔐 Archive password: tatiana_archive_2024_LBg_makaka_9f3a7c2e8d1b5a4c6`);
    console.log(`💾 Storage: ${dbConnected ? 'Database + Memory' : 'Memory only'}`);
  });
}

startServer().catch(console.error);
