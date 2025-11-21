const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
app.use(cors({
  origin: ['https://makaka119911-oss.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health endpoint
app.get('/api/health', (req, res) => {
  console.log('✅ Health check received');
  res.json({ 
    status: 'ok', 
    message: 'Server is running!',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  console.log('✅ Test endpoint called');
  res.json({ 
    message: 'Test successful!',
    data: { test: 'works' },
    timestamp: new Date().toISOString()
  });
});

// Registration endpoint
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
    
    console.log('✅ Registration processed:', { registrationId, firstName, lastName });

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

    console.log('✅ Test result processed:', { registrationId, level, score });

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

// Archive endpoint - FIXED PASSWORD
app.get('/api/archive', (req, res) => {
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
    
    // CORRECT PASSWORD - matches archive.js
    const expectedToken = 'tatiana_archive_2024_LBg_makaka_9f3a7c2e8d1b5a4c6';

    console.log('🔐 Token check:', { received: token, expected: expectedToken });

    if (token !== expectedToken) {
      return res.status(401).json({
        success: false,
        error: 'Неверный токен доступа'
      });
    }

    // Mock archive data
    const mockArchiveData = {
      success: true,
      records: [
        {
          fio: 'Иванов Иван',
          age: 30,
          phone: '+71234567890',
          telegram: '@ivanov',
          level: 'High libido',
          score: 85,
          date: new Date().toISOString()
        },
        {
          fio: 'Петрова Мария', 
          age: 28,
          phone: '+71234567891',
          telegram: '@petrova',
          level: 'Medium libido',
          score: 60,
          date: new Date().toISOString()
        }
      ],
      count: 2,
      timestamp: new Date().toISOString()
    };

    console.log('📊 Sending mock archive data');
    res.json(mockArchiveData);

  } catch (error) {
    console.error('❌ Archive error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка доступа к архиву: ' + error.message
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
  console.log('📦 Body:', req.body);
  console.log('🔑 Headers:', req.headers);
  
  res.json({ 
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Endpoints available:`);
  console.log(`   GET  /api/health`);
  console.log(`   GET  /api/test`); 
  console.log(`   POST /api/register`);
  console.log(`   POST /api/test-result`);
  console.log(`   GET  /api/archive`);
  console.log(`🔐 Archive password: tatiana_archive_2024_LBg_makaka_9f3a7c2e8d1b5a4c6`);
});
