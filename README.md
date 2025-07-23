# nepal-dashboard-backend

A Node.js TypeScript API boilerplate with modern development practices.

## Features

- ✅ TypeScript for type safety
- ✅ Express.js web framework
- ✅ Environment configuration with dotenv
- ✅ CORS enabled
- ✅ Security headers with Helmet
- ✅ Request logging with Morgan
- ✅ Error handling middleware
- ✅ ESLint and Prettier for code quality
- ✅ Jest for testing
- ✅ Nodemon for development
- ✅ Database integration with Prisma ORM
- ✅ JWT Authentication setup
- ✅ Request validation with Zod

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- PostgreSQL database

### Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   cd nepal-dashboard-backend
   npm install
   ```

3. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your configuration

5. Set up the database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

### Development

Start the development server:
```bash
npm run dev
```

The server will start on http://localhost:5000

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the application for production
- `npm start` - Start the production server
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors
- `npm run format` - Format code with Prettier

### API Endpoints

- `GET /health` - Health check endpoint
- `GET /api/v1/health` - API health check with detailed information

### Project Structure

```
nepal-dashboard-backend/
├── src/
│   ├── controllers/     # Route controllers
│   ├── middleware/      # Custom middleware
│   ├── models/          # Database models
│   ├── routes/          # Route definitions
│   ├── services/        # Business logic
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   ├── config/          # Configuration files
│   └── index.ts         # Application entry point
├── tests/               # Test files
├── docs/                # Documentation
├── .env.example         # Environment variables template
└── README.md            # This file
```

### Environment Variables

See `.env.example` for all available environment variables.

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for your changes
5. Run the test suite
6. Submit a pull request

### License

This project is licensed under the MIT License.

---
### Options for labeling

break advertisements, program, song, sponsor advertisements, overlays advertisements, error, channel promo.

---