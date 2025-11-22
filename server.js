const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://makaka119911-oss.github.io'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database table
async function initDatabase() {
  try {
    const client = await pool.connect();
    
    // Create registrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(100) UNIQUE NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        age INTEGER NOT NULL,
        phone VARCHAR(20) NOT NULL,
        telegram VARCHAR(100) NOT NULL,
        photo_data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create test_results table
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_results (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(100) REFERENCES registrations(registration_id),
        test_type VARCHAR(50) NOT NULL,
        level VARCHAR(50) NOT NULL,
        score INTEGER NOT NULL,
        test_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database tables initialized');
    client.release();
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'Tatiana Server',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    database: 'connected',
    timestamp: new Date().toISOString()
  });
});

// Registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    console.log('📝 Registration request received');
    
    const { lastName, firstName, age, phone, telegram, photoData } = req.body;
    
    // Validation
    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({ 
        success: false, 
        error: 'Все поля обязательны для заполнения' 
      });
    }

    const registrationId = 'REG_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Save to database
    const result = await pool.query(
      `INSERT INTO registrations 
       (registration_id, last_name, first_name, age, phone, telegram, photo_data) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING registration_id`,
      [registrationId, lastName, firstName, parseInt(age), phone, telegram, photoData || null]
    );

    console.log('✅ Registration saved to database:', registrationId);

    // Send to Telegram
    try {
      await sendToTelegram({
        type: 'registration',
        data: { lastName, firstName, age, phone, telegram, registrationId }
      });
    } catch (telegramError) {
      console.error('⚠️ Telegram error:', telegramError);
      // Don't fail the request if Telegram fails
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
      error: 'Внутренняя ошибка сервера: ' + error.message 
    });
  }
});

// Test result endpoint
app.post('/api/test-result', async (req, res) => {
  try {
    console.log('🧪 Test result received');
    
    const { registrationId, level, score, testData } = req.body;
    
    if (!registrationId || !level || !score) {
      return res.status(400).json({ 
        success: false, 
        error: 'Отсутствуют обязательные данные' 
      });
    }

    // Verify registration exists
    const regResult = await pool.query(
      'SELECT * FROM registrations WHERE registration_id = $1',
      [registrationId]
    );

    if (regResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Регистрация не найдена' 
      });
    }

    // Save test result
    await pool.query(
      `INSERT INTO test_results 
       (registration_id, test_type, level, score, test_data) 
       VALUES ($1, $2, $3, $4, $5)`,
      [registrationId, testData?.test_type || 'regular', level, parseInt(score), testData || {}]
    );

    console.log('✅ Test result saved for:', registrationId);

    // Send to Telegram
    try {
      const registration = regResult.rows[0];
      await sendToTelegram({
        type: 'test_result',
        data: { 
          registrationId,
          user: `${registration.first_name} ${registration.last_name}`,
          level, 
          score,
          testData 
        }
      });
    } catch (telegramError) {
      console.error('⚠️ Telegram error:', telegramError);
    }

    res.json({ 
      success: true, 
      message: 'Результаты теста сохранены!' 
    });

  } catch (error) {
    console.error('❌ Test result error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сохранения результатов: ' + error.message 
    });
  }
});

// Archive endpoint with authentication
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

    // Get combined data from both tables
    const result = await pool.query(`
      SELECT 
        r.registration_id,
        r.last_name || ' ' || r.first_name as fio,
        r.age,
        r.phone,
        r.telegram,
        r.photo_data,
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
      error: 'Ошибка загрузки архива: ' + error.message 
    });
  }
});

// Search archive by name
app.get('/api/archive/search/:query', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token || token !== process.env.ARCHIVE_TOKEN) {
      return res.status(401).json({ 
        success: false, 
        error: 'Неавторизованный доступ' 
      });
    }

    const query = req.params.query.toLowerCase();
    
    const result = await pool.query(`
      SELECT 
        r.registration_id,
        r.last_name || ' ' || r.first_name as fio,
        r.age,
        r.phone,
        r.telegram,
        r.created_at as date,
        t.level,
        t.score
      FROM registrations r
      LEFT JOIN test_results t ON r.registration_id = t.registration_id
      WHERE (LOWER(r.last_name) LIKE $1 OR LOWER(r.first_name) LIKE $1)
        AND t.registration_id IS NOT NULL
      ORDER BY r.created_at DESC
    `, [`%${query}%`]);

    const records = result.rows.map(row => ({
      registrationId: row.registration_id,
      fio: row.fio,
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
    console.error('❌ Search error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка поиска: ' + error.message 
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
    throw new Error(`Telegram API error: ${response.status}`);
  }

  console.log('✅ Notification sent to Telegram');
}

// Initialize database and start server
async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🎉 ===== TATIANA SERVER STARTED =====');
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
      console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not connected'}`);
      console.log(`🤖 Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
      console.log('🎉 =================================\n');
    });
  } catch (error) {
    console.error('🚨 Failed to start server:', error);
    process.exit(1);
  }
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Start the server
startServer();
