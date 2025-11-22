const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting Tatiana Server...');

// Простое подключение к БД
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware для парсинга JSON
app.use(express.json());

// ============ HEALTH CHECKS ============
// ОСНОВНОЙ HEALTH CHECK - должен быть ПЕРВЫМ
app.get('/', (req, res) => {
  console.log('✅ Root health check - 200 OK');
  res.status(200).set('Content-Type', 'text/plain').send('OK');
});

// Дополнительный health check
app.get('/health', (req, res) => {
  console.log('✅ /health endpoint - 200 OK');
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Tatiana Server'
  });
});

// Health check с проверкой БД
app.get('/health/db', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    client.release();
    
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      current_time: result.rows[0].current_time
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// ============ API ENDPOINTS ============
app.post('/api/register', async (req, res) => {
  try {
    const { lastName, firstName, age, phone, telegram } = req.body;
    
    // Валидация
    if (!lastName || !firstName || !age || !phone || !telegram) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    const registrationId = 'REG_' + Date.now();
    
    // Сохранение в БД
    await pool.query(
      `INSERT INTO registrations (registration_id, last_name, first_name, age, phone, telegram) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [registrationId, lastName, firstName, parseInt(age), phone, telegram]
    );

    console.log('✅ Registration saved:', registrationId);

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

app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// Запуск сервера
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎉 ===== SERVER STARTED SUCCESSFULLY =====');
  console.log(`📍 Server: http://0.0.0.0:${PORT}`);
  console.log(`🌐 Health: http://0.0.0.0:${PORT}/`);
  console.log(`🏥 Health DB: http://0.0.0.0:${PORT}/health/db`);
  console.log(`📝 Register: http://0.0.0.0:${PORT}/api/register`);
  console.log('🎉 ====================================\n');
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

// Обработка ошибок
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});
