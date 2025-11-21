const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection - Railway automatically provides DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database');
    
    // Test query
    const result = await client.query('SELECT version()');
    console.log('📊 PostgreSQL version:', result.rows[0].version);
    
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

// Initialize database tables
async function initializeDatabase() {
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (registration_id) REFERENCES registrations(registration_id)
      )
    `);

    console.log('✅ Database tables initialized successfully');
    
    // Check if we have any data
    const regCount = await pool.query('SELECT COUNT(*) FROM registrations');
    const testCount = await pool.query('SELECT COUNT(*) FROM test_results');
    
    console.log(`📊 Current data: ${regCount.rows[0].count} registrations, ${testCount.rows[0].count} test results`);
    
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// CORS configuration
app.use(cors({
  origin: ['https://makaka119911-oss.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health endpoint with DB check
app.get('/api/health', async (req, res) => {
  console.log('✅ Health check received');
  
  try {
    const dbConnected = await testConnection();
    
    res.json({ 
      status: 'ok', 
      message: 'Server is running!',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'warning',
      message: 'Server running but database issues',
      database: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Registration endpoint - SAVES TO DATABASE
app.post('/api/register', async (req, res) => {
  console.log('📝 Registration request received:', req.body);
  
  try {
    const { lastName, firstName, age, phone, telegram } = req.body;

    // Validation
    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({
        success: false,
        error: 'Все поля обязательны для заполнения'
      });
    }

    const registrationId = 'REG_' + Date.now();
    
    console.log('💾 Saving registration to database...');
    
    // Save to database
    const result = await pool.query(
      `INSERT INTO registrations (registration_id, last_name, first_name, age, phone, telegram) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [registrationId, lastName, firstName, parseInt(age), phone, telegram]
    );

    console.log('✅ Registration saved to database:', registrationId);

    // Send to Telegram
    await sendRegistrationToTelegram({
      lastName,
      firstName, 
      age,
      phone,
      telegram,
      registrationId
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

// Test results endpoint - SAVES TO DATABASE
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

    console.log('💾 Saving test result to database...');

    // Save to database
    const result = await pool.query(
      `INSERT INTO test_results (registration_id, test_type, libido_level, score, test_data) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [registrationId, testData?.test_type || 'regular', level, score || 0, testData]
    );

    console.log('✅ Test result saved to database:', { registrationId, level, score });

    // Send to Telegram
    await sendTestResultToTelegram({
      registrationId,
      level, 
      score,
      testData
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

// Archive endpoint - RETRIEVES REAL DATA FROM DATABASE
app.get('/api/archive', async (req, res) => {
  console.log('📁 Archive access request');
  
  try {
    // Check authorization
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

    // Get real data from database
    const archiveData = await getArchiveData();
    
    console.log(`📊 Sending real archive data: ${archiveData.length} records`);

    res.json({
      success: true,
      records: archiveData,
      count: archiveData.length,
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

// Function to get archive data from database
async function getArchiveData() {
  try {
    console.log('🔄 Fetching archive data from database...');
    
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

    console.log(`📨 Found ${result.rows.length} records in database`);
    
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
    console.error('Error getting archive data:', error);
    return [];
  }
}

// Debug endpoint to see all data
app.get('/api/debug/data', async (req, res) => {
  try {
    console.log('🔍 Debug data request');
    
    const registrations = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC');
    const testResults = await pool.query('SELECT * FROM test_results ORDER BY created_at DESC');
    
    const data = {
      registrations: registrations.rows,
      testResults: testResults.rows,
      counts: {
        registrations: registrations.rows.length,
        testResults: testResults.rows.length
      },
      database: {
        connected: true,
        url: process.env.DATABASE_URL ? 'Set' : 'Not set'
      }
    };
    
    console.log(`📊 Debug data: ${data.counts.registrations} reg, ${data.counts.testResults} tests`);
    
    res.json(data);
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ 
      error: error.message,
      database: {
        connected: false,
        url: process.env.DATABASE_URL ? 'Set' : 'Not set'
      }
    });
  }
});

// Telegram functions
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

// Catch-all for debugging
app.all('*', (req, res) => {
  console.log('📨 Request received:', req.method, req.url);
  
  res.json({ 
    method: req.method,
    path: req.path,
    query: req.query,
    timestamp: new Date().toISOString()
  });
});

// Initialize database and start server
async function startServer() {
  console.log('🚀 Starting Tatiana Server...');
  console.log('📊 Environment:', process.env.NODE_ENV || 'development');
  console.log('🔗 Database URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
  
  // Test database connection
  const dbConnected = await testConnection();
  
  if (dbConnected) {
    // Initialize tables
    await initializeDatabase();
  } else {
    console.log('⚠️  Starting without database connection');
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
  });
}

startServer().catch(console.error);
