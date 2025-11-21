// ultra-simple-server.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use(express.json());

// Simple health check
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
app.post('/api/register', (req, res) => {
  console.log('📝 Registration:', req.body);
  
  // Здесь можно добавить отправку в Telegram
  res.json({ 
    success: true, 
    message: 'Received registration data',
    registrationId: 'T' + Date.now()
  });
});

// Archive endpoint
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
    const expectedToken = 'tatiana_archive_2024_LBg_makaka_9f3a7c2e8d1b5a4c6';

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
          registrationId: 'T123',
          firstName: 'Иван',
          lastName: 'Иванов', 
          age: 30,
          phone: '+71234567890',
          telegram: '@ivanov',
          level: 'High libido',
          score: 85,
          date: new Date().toISOString()
        },
        {
          registrationId: 'T124',
          firstName: 'Мария',
          lastName: 'Петрова',
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

app.listen(PORT, () => {
  console.log(`🚀 Ultra-simple server running on port ${PORT}`);
  console.log(`📍 Endpoints available:`);
  console.log(`   GET  /api/health`);
  console.log(`   GET  /api/test`); 
  console.log(`   POST /api/register`);
  console.log(`   GET  /api/archive`);
});
