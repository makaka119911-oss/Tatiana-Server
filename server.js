const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    ['https://makaka119911-oss.github.io', 'http://localhost:3000'];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Health check endpoint - ДОЛЖЕН БЫТЬ ПЕРВЫМ
app.get('/', (req, res) => {
  console.log('✅ Health check received');
  res.status(200).set('Content-Type', 'text/plain').send('OK');
});

// Additional health endpoint
app.get('/health', (req, res) => {
  console.log('✅ Health endpoint called');
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Tatiana Server',
    uptime: process.uptime()
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

// Simple register endpoint
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

// Archive endpoint
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
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎉 ===== TATIANA SERVER STARTED =====');
  console.log(`📍 Server running on port: ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 Health check: http://0.0.0.0:${PORT}/`);
  console.log(`🏥 Health endpoint: http://0.0.0.0:${PORT}/health`);
  console.log('🚀 Server is ready and stable!');
  console.log('🎉 =================================\n');
});

// Server error handling
server.on('error', (error) => {
  console.error('🚨 Server error:', error);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received - starting graceful shutdown');
  server.close(() => {
    console.log('✅ Express server closed');
    process.exit(0);
  });
  
  // Force close after 5 seconds
  setTimeout(() => {
    console.log('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 5000);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received - starting graceful shutdown');
  server.close(() => {
    console.log('✅ Express server closed');
    process.exit(0);
  });
});

// Uncaught exception handling
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
  process.exit(1);
});
