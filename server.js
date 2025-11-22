const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');
console.log('📊 Environment:', process.env.NODE_ENV);
console.log('🔌 Database URL:', process.env.DATABASE_URL ? 'Present' : 'Missing');

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Database connection with better error handling
let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
  });
  console.log('✅ Database pool created');
} catch (error) {
  console.error('❌ Database pool creation failed:', error);
  process.exit(1);
}

// Test database connection
const testDatabaseConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Create tables if they don't exist
const createTables = async () => {
  try {
    console.log('🗄️ Creating tables if not exist...');
    
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
    return true;
  } catch (error) {
    console.error('❌ Database table creation error:', error);
    return false;
  }
};

// Simple health check - MUST BE FIRST
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Tatiana Server is running!',
    timestamp: new Date().toISOString()
  });
});

// Health check with DB verification
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await testDatabaseConnection();
    
    if (!dbConnected) {
      return res.status(500).json({
        status: 'error',
        database: 'disconnected',
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
      service: 'Tatiana Server'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Register endpoint
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

    // Send to Telegram (non-blocking)
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      setTimeout(async () => {
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
        }
      }, 100);
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

// Test results endpoint
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

    // Send to Telegram (non-blocking)
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      setTimeout(async () => {
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
      }, 100);
    }

    res.json({ 
      success: true, 
      message: 'Результаты теста успешно сохранены!' 
    });

  } catch (error) {
    console.error('❌ Test result error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// Archive endpoint
app.get('/api/archive', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token || token !== process.env.ARCHIVE_TOKEN) {
      return res.status(401).json({ 
        success: false, 
        error: 'Неавторизованный доступ' 
      });
    }

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
      error: 'Ошибка загрузки архива' 
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Маршрут не найден' 
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Unhandled error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Внутренняя ошибка сервера' 
  });
});

// Initialize and start server
const startServer = async () => {
  try {
    // Test database connection first
    console.log('🔌 Testing database connection...');
    const dbConnected = await testDatabaseConnection();
    
    if (!dbConnected) {
      console.error('❌ Cannot start server: Database connection failed');
      process.exit(1);
    }

    // Create tables
    console.log('🗄️ Setting up database tables...');
    const tablesCreated = await createTables();
    
    if (!tablesCreated) {
      console.error('❌ Cannot start server: Table creation failed');
      process.exit(1);
    }

    // Start server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🎉 ===== TATIANA SERVER STARTED =====');
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️ Database: Connected`);
      console.log(`🤖 Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
      console.log('🎉 =================================\n');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 SIGTERM received - starting graceful shutdown');
      server.close(() => {
        console.log('✅ Express server closed');
        if (pool) {
          pool.end(() => {
            console.log('✅ Database connections closed');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      });
    });

    process.on('SIGINT', () => {
      console.log('🛑 SIGINT received - starting graceful shutdown');
      server.close(() => {
        console.log('✅ Express server closed');
        if (pool) {
          pool.end(() => {
            console.log('✅ Database connections closed');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;
