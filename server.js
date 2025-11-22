const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Health endpoints
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    service: 'Tatiana Server',
    timestamp: new Date().toISOString(),
    message: 'Server is running!'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'PostgreSQL is running'
  });
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API is working!',
    timestamp: new Date().toISOString()
  });
});

// Simple register endpoint (without DB for now)
app.post('/api/register', (req, res) => {
  try {
    const { lastName, firstName, age, phone, telegram } = req.body;
    
    console.log('📝 Registration received:', { lastName, firstName, age, phone, telegram });

    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({ 
        success: false, 
        error: 'Все поля обязательны' 
      });
    }

    const registrationId = 'REG_' + Date.now();
    
    console.log('✅ Registration processed:', registrationId);

    res.json({ 
      success: true, 
      registrationId,
      message: 'Регистрация успешно завершена! (тестовый режим)' 
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// Archive endpoint (simple version)
app.get('/api/archive', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token || token !== process.env.ARCHIVE_TOKEN) {
    return res.status(401).json({ 
      success: false, 
      error: 'Неавторизованный доступ' 
    });
  }

  res.json({ 
    success: true, 
    records: [],
    message: 'Архив работает в тестовом режиме',
    count: 0
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Маршрут не найден' 
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('🚨 Server error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Внутренняя ошибка сервера' 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎉 ===== TATIANA SERVER STARTED =====');
  console.log(`📍 Server running on port: ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 Health check: http://0.0.0.0:${PORT}/health`);
  console.log('🚀 Server is ready and stable!');
  console.log('🎉 =================================\n');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received - graceful shutdown');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received - graceful shutdown');
  process.exit(0);
});
