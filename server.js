const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');

// Простой пул соединений
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Упрощенная CORS конфигурация
app.use(cors({
  origin: ['https://makaka119911-oss.github.io', 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());

// ============ CRITICAL HEALTH CHECKS ============
// Простейший health check для Railway (ДОЛЖЕН БЫТЬ ПЕРВЫМ!)
app.get('/', (req, res) => {
  console.log('✅ Health check received');
  res.status(200).json({ 
    status: 'ok', 
    service: 'Tatiana Server',
    timestamp: new Date().toISOString()
  });
});

// Альтернативный health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Быстрый health check без БД
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    database: 'checking',
    timestamp: new Date().toISOString()
  });
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
      console.error('❌ Telegram error:', await response.text());
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

// Запуск сервера
function startServer() {
  try {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🎯 SERVER STARTED SUCCESSFULLY');
      console.log('========================================');
      console.log(`📍 Server: http://0.0.0.0:${PORT}`);
      console.log(`🌐 Health: http://0.0.0.0:${PORT}/`);
      console.log(`🌐 API Health: http://0.0.0.0:${PORT}/api/health`);
      console.log('========================================\n');
    });

    return server;
  } catch (error) {
    console.error('💥 FAILED TO START SERVER:', error);
    process.exit(1);
  }
}

// Немедленный запуск сервера
console.log('🔧 Starting server immediately...');
const server = startServer();
