const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Create tables if they don't exist
const createTables = async () => {
  try {
    await pool.query(`
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
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_results (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(255) REFERENCES registrations(registration_id) ON DELETE CASCADE,
        test_data JSONB NOT NULL,
        level VARCHAR(255) NOT NULL,
        score INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database tables ready');
  } catch (error) {
    console.error('❌ Database error:', error);
  }
};

createTables();

// Health check
app.get('/', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Tatiana Server is running!' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Tatiana Server',
    database: 'connected'
  });
});

// Register new user
app.post('/api/register', async (req, res) => {
  try {
    const { lastName, firstName, age, phone, telegram, photoBase64 } = req.body;
    
    console.log('📝 Registration attempt:', { lastName, firstName, age, phone, telegram });

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
      `INSERT INTO registrations (registration_id, last_name, first_name, age, phone, telegram, photo_base64)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [registrationId, lastName, firstName, parseInt(age), phone, telegram, photoBase64 || null]
    );

    console.log('✅ Registration saved to DB:', registrationId);

    // Send to Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const telegramMessage = `
🌟 *НОВАЯ РЕГИСТРАЦИЯ* 🌟

👤 *Имя:* ${firstName} ${lastName}
📞 *Телефон:* ${phone}
✈️ *Telegram:* ${telegram}
🎂 *Возраст:* ${age}
🆔 *ID:* ${registrationId}

⏰ *Время:* ${new Date().toLocaleString('ru-RU')}
        `.trim();

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: telegramMessage,
            parse_mode: 'Markdown'
          })
        });

        console.log('✅ Registration sent to Telegram');
      } catch (telegramError) {
        console.error('❌ Telegram error (non-critical):', telegramError.message);
        // Don't fail the request if Telegram fails
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
      error: 'Внутренняя ошибка сервера: ' + error.message 
    });
  }
});

// Save test results
app.post('/api/test-result', async (req, res) => {
  try {
    const { registrationId, testData, level, score } = req.body;
    
    console.log('🧪 Test result attempt:', { registrationId, level, score });

    if (!registrationId || !testData || !level || score === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'Все поля обязательны для сохранения результатов теста' 
      });
    }

    // Check if registration exists
    const registrationCheck = await pool.query(
      'SELECT * FROM registrations WHERE registration_id = $1',
      [registrationId]
    );

    if (registrationCheck.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Регистрация не найдена' 
      });
    }

    // Save test results
    const result = await pool.query(
      `INSERT INTO test_results (registration_id, test_data, level, score)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [registrationId, testData, level, parseInt(score)]
    );

    console.log('✅ Test results saved to DB:', registrationId);

    // Send to Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const telegramMessage = `
📊 *НОВЫЙ РЕЗУЛЬТАТ ТЕСТА* 📊

👤 *ID регистрации:* ${registrationId}
⚡ *Уровень либидо:* ${level}
⭐ *Баллы:* ${score}
📋 *Тип теста:* ${testData.test_type || 'Не указан'}

⏰ *Время:* ${new Date().toLocaleString('ru-RU')}
        `.trim();

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: telegramMessage,
            parse_mode: 'Markdown'
          })
        });

        console.log('✅ Test results sent to Telegram');
      } catch (telegramError) {
        console.error('❌ Telegram error (non-critical):', telegramError.message);
      }
    }

    res.json({ 
      success: true, 
      message: 'Результаты теста успешно сохранены!' 
    });

  } catch (error) {
    console.error('❌ Test result error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера: ' + error.message 
    });
  }
});

// Get archive data (protected)
app.get('/api/archive', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token || token !== process.env.ARCHIVE_TOKEN) {
      return res.status(401).json({ 
        success: false, 
        error: 'Неавторизованный доступ. Проверьте токен.' 
      });
    }

    // Get combined data from both tables
    const result = await pool.query(`
      SELECT 
        r.registration_id,
        r.last_name,
        r.first_name,
        r.age,
        r.phone,
        r.telegram,
        r.photo_base64,
        r.created_at as registration_date,
        t.level,
        t.score,
        t.created_at as test_date
      FROM registrations r
      LEFT JOIN test_results t ON r.registration_id = t.registration_id
      ORDER BY r.created_at DESC
    `);

    const records = result.rows.map(row => ({
      registrationId: row.registration_id,
      fio: `${row.last_name} ${row.first_name}`,
      age: row.age,
      phone: row.phone,
      telegram: row.telegram,
      photoBase64: row.photo_base64,
      level: row.level,
      score: row.score,
      date: row.test_date || row.registration_date
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

// Get user by registration ID
app.get('/api/user/:registrationId', async (req, res) => {
  try {
    const { registrationId } = req.params;

    const result = await pool.query(`
      SELECT 
        r.*,
        t.test_data,
        t.level,
        t.score
      FROM registrations r
      LEFT JOIN test_results t ON r.registration_id = t.registration_id
      WHERE r.registration_id = $1
    `, [registrationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Пользователь не найден' 
      });
    }

    res.json({ 
      success: true, 
      user: result.rows[0] 
    });

  } catch (error) {
    console.error('❌ User fetch error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка загрузки данных пользователя' 
    });
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('🚨 Unhandled error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Внутренняя ошибка сервера' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Маршрут не найден' 
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎉 ===== TATIANA SERVER STARTED =====');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️ Database: ${process.env.DATABASE_URL ? 'Connected' : 'Disconnected'}`);
  console.log(`🤖 Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
  console.log('🎉 =================================\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received - starting graceful shutdown');
  server.close(() => {
    console.log('✅ Express server closed');
    pool.end(() => {
      console.log('✅ Database connections closed');
      process.exit(0);
    });
  });
});

module.exports = app;
