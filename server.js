const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ IN-MEMORY STORAGE ============
const memoryStorage = {
  registrations: [],
  testResults: []
};

console.log('🔧 Initializing server...');
console.log('📊 DATABASE_URL:', process.env.DATABASE_URL ? 'Present' : 'Missing');

// ============ DATABASE CONNECTION ============
let pool;
let dbConnected = false;

// Test database connection
async function testConnection() {
  try {
    if (process.env.DATABASE_URL) {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      
      const client = await pool.connect();
      console.log('✅ Connected to PostgreSQL database');
      client.release();
      dbConnected = true;
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

// ============ STORAGE FUNCTIONS ============
function saveRegistration(data) {
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

  console.log('💾 Saving registration to memory:', registrationId);
  memoryStorage.registrations.push(registrationData);
  
  return registrationId;
}

function saveTestResult(data) {
  const testResult = {
    registration_id: data.registrationId,
    test_type: data.testData?.test_type || 'regular',
    libido_level: data.level,
    score: data.score || 0,
    test_data: data.testData,
    created_at: new Date()
  };

  console.log('💾 Saving test result to memory:', data.registrationId);
  memoryStorage.testResults.push(testResult);
}

function getArchiveData() {
  console.log('📁 Getting archive data from memory...');
  
  const archiveData = memoryStorage.registrations.map(reg => {
    const testResult = memoryStorage.testResults.find(tr => tr.registration_id === reg.registration_id);
    
    if (!testResult) return null;
    
    return {
      fio: `${reg.last_name} ${reg.first_name}`,
      age: reg.age,
      phone: reg.phone,
      telegram: reg.telegram,
      level: testResult.libido_level,
      score: testResult.score,
      date: testResult.created_at || reg.created_at,
      registrationId: reg.registration_id
    };
  }).filter(item => item !== null);

  console.log(`📊 Found ${archiveData.length} records in memory`);
  return archiveData;
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
app.get('/api/health', (req, res) => {
  console.log('❤️ Health check');
  res.json({ 
    status: 'ok', 
    database: dbConnected ? 'connected' : 'disconnected',
    memory_storage: {
      registrations: memoryStorage.registrations.length,
      testResults: memoryStorage.testResults.length
    },
    timestamp: new Date().toISOString()
  });
});

app.post('/api/register', (req, res) => {
  console.log('📝 REGISTRATION REQUEST:', req.body);
  
  try {
    const { lastName, firstName, age, phone, telegram } = req.body;

    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({
        success: false,
        error: 'Все поля обязательны для заполнения'
      });
    }

    const registrationId = saveRegistration({
      lastName, firstName, age, phone, telegram
    });

    console.log('🎉 Registration completed:', registrationId);

    // Send to Telegram
    sendRegistrationToTelegram({
      lastName, firstName, age, phone, telegram, registrationId
    });

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

app.post('/api/test-result', (req, res) => {
  console.log('📊 TEST RESULT REQUEST:', req.body);
  
  try {
    const { registrationId, level, score, testData } = req.body;

    if (!registrationId || !level) {
      return res.status(400).json({
        success: false,
        error: 'Registration ID и уровень обязательны'
      });
    }

    saveTestResult({
      registrationId, level, score, testData
    });

    console.log('🎉 Test result saved for:', registrationId);

    // Send to Telegram
    sendTestResultToTelegram({
      registrationId, level, score, testData
    });

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

// ============ ARCHIVE ENDPOINT ============
app.get('/api/archive', (req, res) => {
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

    const archiveData = getArchiveData();
    
    console.log(`📦 Sending ${archiveData.length} records to archive`);

    res.json({
      success: true,
      records: archiveData,
      count: archiveData.length,
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

// ============ DEBUG ENDPOINT ============
app.get('/api/debug/data', (req, res) => {
  console.log('🔍 DEBUG DATA REQUEST');
  
  try {
    res.json({
      database: {
        connected: dbConnected,
        registrations: [],
        testResults: []
      },
      memory: {
        registrations: memoryStorage.registrations,
        testResults: memoryStorage.testResults
      },
      counts: {
        database_registrations: 0,
        database_testResults: 0,
        memory_registrations: memoryStorage.registrations.length,
        memory_testResults: memoryStorage.testResults.length
      }
    });
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

// ============ START SERVER ============
async function startServer() {
  console.log('\n🚀 STARTING TATIANA SERVER');
  console.log('========================================');
  console.log('📊 Environment:', process.env.NODE_ENV || 'development');
  console.log('🔗 Database URL:', process.env.DATABASE_URL ? 'Present' : 'Missing');
  console.log('🌐 Port:', PORT);
  console.log('========================================\n');
  
  // Test database connection
  await testConnection();

  app.listen(PORT, () => {
    console.log('\n🎯 SERVER STARTED SUCCESSFULLY');
    console.log('========================================');
    console.log(`📍 Server running on port: ${PORT}`);
    console.log(`🌐 Endpoints:`);
    console.log(`   GET  /api/health`);
    console.log(`   POST /api/register`);
    console.log(`   POST /api/test-result`);
    console.log(`   GET  /api/archive`);
    console.log(`   GET  /api/debug/data`);
    console.log(`🔐 Archive password: tatiana_archive_2024_LBg_makaka_9f3a7c2e8d1b5a4c6`);
    console.log(`💾 Storage: Memory`);
    console.log('========================================\n');
  });
}

startServer().catch(error => {
  console.error('💥 FAILED TO START SERVER:', error);
  process.exit(1);
});
