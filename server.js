const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Health check endpoints
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Tatiana Server is running!',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    client.release();
    
    res.json({
      status: 'ok',
      database: 'connected',
      current_time: result.rows[0].current_time,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Initialize database tables
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
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database tables initialized');
    client.release();
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Registration endpoint
app.post('/api/register', async (req, res) => {
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
    
    // Save to database
    await pool.query(
      `INSERT INTO registrations 
       (registration_id, last_name, first_name, age, phone, telegram) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [registrationId, lastName, firstName, parseInt(age), phone, telegram]
    );

    console.log('✅ Registration saved:', registrationId);

    // Send to Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const message = `🌟 *НОВАЯ РЕГИСТРАЦИЯ* 🌟\n\n` +
          `👤 *ФИО:* ${lastName} ${firstName}\n` +
          `📅 *Возраст:* ${age}\n` +
          `📞 *Телефон:* ${phone}\n` +
          `✈️ *Telegram:* ${telegram}\n` +
          `🆔 *ID:* ${registrationId}\n` +
          `\n⏰ *Дата:* ${new Date().toLocaleString('ru-RU')}`;

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
          })
        });
        
        console.log('✅ Telegram notification sent');
      } catch (telegramError) {
        console.error('⚠️ Telegram error:', telegramError);
      }
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
      error: 'Ошибка сервера: ' + error.message 
    });
  }
});

// Test result endpoint
app.post('/api/test-result', async (req, res) => {
  try {
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
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const registration = regResult.rows[0];
        const message = `📊 *НОВЫЙ РЕЗУЛЬТАТ ТЕСТА* 📊\n\n` +
          `👤 *Пользователь:* ${registration.first_name} ${registration.last_name}\n` +
          `📱 *Telegram:* ${registration.telegram}\n` +
          `📈 *Уровень либидо:* ${level}\n` +
          `⭐ *Баллы:* ${score}\n` +
          `🆔 *ID:* ${registrationId}\n` +
          `\n⏰ *Дата теста:* ${new Date().toLocaleString('ru-RU')}`;

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
          })
        });
        
        console.log('✅ Telegram notification sent');
      } catch (telegramError) {
        console.error('⚠️ Telegram error:', telegramError);
      }
    }

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
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token || token !== process.env.ARCHIVE_TOKEN) {
      return res.status(401).json({ 
        success: false, 
        error: 'Неавторизованный доступ' 
      });
    }

    // Get combined data
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
      date: row.date
    }));

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

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API is working!',
    timestamp: new Date().toISOString()
  });
});

// Initialize and start server
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
