# Tatiana-Server

Node.js backend server for Tatiana LibidoTest archive. PostgreSQL database with Express API and Railway deployment.

## Features

- REST API with Express.js
- PostgreSQL database for persistent storage
- CORS support for frontend integration
- Base64 image handling for photo storage
- Advanced search by libido level
- Environment-based configuration
- Railway deployment ready

## Prerequisites

- Node.js v14+
- PostgreSQL v12+
- npm or yarn

## Installation

1. Clone the repository
2. Install dependencies: npm install
3. Create .env file from .env.example
4. Configure environment variables
5. Create PostgreSQL database
6. Start server: npm start

## API Endpoints

### POST /api/archive
Save a new archive entry

### GET /api/archive
Retrieve all entries (optional: ?libidonLevel=high)

### GET /api/archive/:userId
Retrieve specific entry by ID

### DELETE /api/archive/:userId
Delete entry by ID

### GET /api/health
Health check

## Database

Automatically creates archive table with all required fields

## Environment Variables

DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME, PORT, NODE_ENV

## Deployment on Railway

1. Push to GitHub
2. Create project on Railway.app
3. Connect repository
4. Add PostgreSQL
5. Configure environment
6. Deploy

## License

MIT
