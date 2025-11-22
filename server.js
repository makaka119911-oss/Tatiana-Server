const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для логирования всех запросов
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// КРИТИЧЕСКИ ВАЖНО: Health check ДОЛЖЕН быть первым!
app.get('/', (req, res) => {
  console.log('✅ Health check received - responding with 200 OK');
  res.status(200).set('Content-Type', 'text/plain').send('OK');
});

// Дополнительный health check endpoint
app.get('/health', (req, res) => {
  console.log('✅ /health endpoint called');
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Tatiana Server'
  });
});

// Простой тестовый endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// Запуск сервера с улучшенной обработкой
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 SERVER STARTED SUCCESSFULLY');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Local: http://0.0.0.0:${PORT}/`);
  console.log(`✅ Health: http://0.0.0.0:${PORT}/`);
  console.log(`🏥 Health API: http://0.0.0.0:${PORT}/health`);
  console.log('========================================');
  
  // Дополнительная проверка что сервер действительно слушает
  console.log('📡 Server is listening for requests...');
});

// Улучшенная обработка graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received - starting graceful shutdown');
  console.log('🔍 Last health check was at:', new Date().toISOString());
  
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
  
  // Force close after 5 seconds
  setTimeout(() => {
    console.log('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 5000);
});

// Обработка ошибок
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
  process.exit(1);
});
