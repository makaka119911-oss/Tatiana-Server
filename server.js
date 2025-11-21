const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ IN-MEMORY STORAGE (FALLBACK) ============
const memoryStorage = {
  registrations: [],
  testResults: []
};

// ============ DATABASE CONNECTION ============
let pool;
let dbConnected = false;

console.log('🔧 Initializing server...');
console.log('📊 DATABASE_URL:', process.env.DATABASE_URL ? 'Present' : 'Missing');

try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10
    });
    dbConnected = true;
    console.log('✅ PostgreSQL pool created');
  } else {
    console.log('⚠️ DATABASE_URL not found, using memory storage only');
  }
} catch (error) {
  console.error('❌ Database pool creation failed:', error.message);
  dbConnected = false;
}

// ============ DATABASE FUNCTIONS ============
async function testConnection() {
  if (!pool) return false;
  
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database');
    
    // Test query
    const result = await client.query('SELECT version()');
    console.log('📊 PostgreSQL version:', result.rows[0].version.split(',')[0]);
    
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

async function initializeDatabase() {
  if (!dbConnected) {
    console.log('⏩ Skipping database initialization - no connection');
    return;
  }

  try {
    console.log('🔄 Initializing database tables...');
    
    // Create registrations table
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

    // Create test_results table
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

    // Count existing records
    const regResult = await pool.query('SELECT COUNT(*) FROM registrations');
    const testResult = await pool.query('SELECT COUNT(*) FROM test_results');
    
    console.log(`📊 Database has: ${regResult.rows[0].count} registrations, ${testResult.rows[0].count} test results`);

  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
    dbConnected = false;
  }
}

// ============ STORAGE FUNCTIONS ============
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

  console.log('💾 Saving registration:', { 
    id: registrationId, 
    name: `${data.lastName} ${data.firstName}` 
  });

  // Save to memory storage (ALWAYS)
  memoryStorage.registrations.push(registrationData);
  console.log('✅ Registration saved to memory');

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

async function saveTestResult(data) {
  console.log('💾 Saving test result:', { 
    registrationId: data.registrationId,
    level: data.level,
    score: data.score 
  });

  const testResult = {
    registration_id: data.registrationId,
    test_type: data.testData?.test_type || 'regular',
    libido_level: data.level,
    score: data.score || 0,
    test_data: data.testData,
    created_at: new Date()
  };

  // Save to memory storage (ALWAYS)
  memoryStorage.testResults.push(testResult);
  console.log('✅ Test result saved to memory');

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

async function getArchiveData() {
  console.log('📁 Fetching archive data...');
  
  let databaseData = [];
  
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
        JOIN test_results t ON r.registration_id = t.registration_id
        ORDER BY r.created_at DESC
      `);

      databaseData = result.rows.map(row => ({
        fio: `${row.last_name} ${row.first_name}`,
        age: row.age,
        phone: row.phone,
        telegram: row.telegram,
        level: row.libido_level,
        score: row.score,
        date: row.tested_at || row.registered_at,
        registrationId: row.registration_id,
        source: 'database'
      }));

      console.log(`📊 Found ${databaseData.length} records in database`);
    } catch (error) {
      console.error('❌ Error getting data from database:', error.message);
    }
  }

  // Get from memory storage
  const memoryData = memoryStorage.registrations.map(reg => {
    const testResult = memoryStorage.testResults.find(tr => tr.registration_id === reg.registration_id);
    
    if (!testResult) return null; // Skip if no test result
    
    return {
      fio: `${reg.last_name} ${reg.first_name}`,
      age: reg.age,
      phone: reg.phone,
      telegram: reg.telegram,
      level: testResult.libido_level,
      score: testResult.score,
      date: testResult.created_at || reg.created_at,
      registrationId: reg.registration_id,
      source: 'memory'
    };
  }).filter(item => item !== null);

  console.log(`📊 Found ${memoryData.length} records in memory`);

  // Combine data (remove duplicates by registrationId)
  const combinedData = [...databaseData, ...memoryData];
  const uniqueData = combinedData.filter((item, index, self) => 
    index === self.findIndex(t => t.registrationId === item.registrationId)
  );

  console.log(`📦 Total unique records: ${uniqueData.length}`);
  return uniqueData;
}

// ============ EXPRESS SETUP ============
app.use(cors({
  origin: ['https://makaka119911-oss.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============ ROUTES ============
app.get('/api/health', async (req, res) => {
  console.log('❤️ Health check');
  
  const dbStatus = dbConnected ? 'connected' : 'disconnected';
  const memoryCount = memoryStorage.registrations.length;
  const memoryTests = memoryStorage.testResults.length;
  
  res.json({ 
    status: 'ok', 
    database: dbStatus,
    memory_storage: {
      registrations: memoryCount,
      testResults: memoryTests
    },
    timestamp: new Date().toISOString()
  });
});

app.post('/api/register', async (req, res) => {
  console.log('📝 REGISTRATION REQUEST:', req.body);
  
  try {
    const { lastName, firstName, age, phone, telegram } = req.body;

    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({
        success: false,
        error: 'Все поля обязательны для заполнения'
      });
    }

    const registrationId = await saveRegistration({
      lastName, firstName, age, phone, telegram
    });

    console.log('🎉 Registration completed:', registrationId);

    // Send to Telegram
    try {
      await sendRegistrationToTelegram({
        lastName, firstName, age, phone, telegram, registrationId
      });
    } catch (tgError) {
      console.error('Telegram error:', tgError.message);
    }

    res.json({
      success: true,
      registrationId: registrationId,
      message: 'Регистрация успешно завершена!'
    });

  } catch (error) {
    console.error('❌ REGISTRATION ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера: ' + error.message
    });
  }
});

app.post('/api/test-result', async (req, res) => {
  console.log('📊 TEST RESULT REQUEST:', req.body);
  
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

    console.log('🎉 Test result saved for:', registrationId);

    // Send to Telegram
    try {
      await sendTestResultToTelegram({
        registrationId, level, score, testData
      });
    } catch (tgError) {
      console.error('Telegram error:', tgError.message);
    }

    res.json({
      success: true,
      message: 'Результаты теста сохранены!'
    });

  } catch (error) {
    console.error('❌ TEST RESULT ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера: ' + error.message
    });
  }
});

app.get('/api/archive', async (req, res) => {
  console.log('📁 ARCHIVE ACCESS REQUEST');
  
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
    
    console.log(`📦 Sending ${archiveData.length} records to archive`);

    res.json({
      success: true,
      records: archiveData,
      count: archiveData.length,
      storage: dbConnected ? 'database + memory' : 'memory',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ ARCHIVE ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка доступа к архиву: ' + error.message
    });
  }
});

app.get('/api/debug/data', async (req, res) => {
  console.log('🔍 DEBUG DATA REQUEST');
  
  try {
    let dbRegistrations = [];
    let dbTestResults = [];

    if (dbConnected) {
      try {
        dbRegistrations = (await pool.query('SELECT * FROM registrations ORDER BY created_at DESC')).rows;
        dbTestResults = (await pool.query('SELECT * FROM test_results ORDER BY created_at DESC')).rows;
      } catch (error) {
        console.error('Error fetching from database:', error.message);
      }
    }

    const response = {
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
    };

    console.log(`📊 Debug data: ${response.counts.database_registrations} DB reg, ${response.counts.memory_registrations} memory reg`);

    res.json(response);
  } catch (error) {
    console.error('DEBUG ERROR:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ TELEGRAM FUNCTIONS ============
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
    console.error('Error sending to Telegram:', error.message);
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
    console.error('Error sending to Telegram:', error.message);
  }
}

// ============ ERROR HANDLING ============
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// ============ START SERVER ============
async function startServer() {
  console.log('\n🚀 STARTING TATIANA SERVER');
  console.log('========================================');
  console.log('📊 Environment:', process.env.NODE_ENV || 'development');
  console.log('🔗 Database URL:', process.env.DATABASE_URL ? 'Present' : 'Missing');
  console.log('🌐 Port:', PORT);
  console.log('========================================\n');
  
  // Test database connection
  if (process.env.DATABASE_URL) {
    dbConnected = await testConnection();
    if (dbConnected) {
      await initializeDatabase();
    }
  }

  app.listen(PORT, () => {
    console.log('\n🎯 SERVER STARTED SUCCESSFULLY');
    console.log('========================================');
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`🌐 Endpoints:`);
    console.log(`   GET  /api/health`);
    console.log(`   POST /api/register`);
    console.log(`   POST /api/test-result`);
    console.log(`   GET  /api/archive`);
    console.log(`   GET  /api/debug/data`);
    console.log(`🔐 Archive password: tatiana_archive_2024_LBg_makaka_9f3a7c2e8d1b5a4c6`);
    console.log(`💾 Storage: ${dbConnected ? 'Database + Memory' : 'Memory only'}`);
    console.log('========================================\n');
  });
}

startServer().catch(error => {
  console.error('💥 FAILED TO START SERVER:', error);
  process.exit(1);
});
