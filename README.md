# Masters Fit API Server

A modern, TypeScript-based RESTful API server for the MastersFit fitness tracking application. This server provides a robust backend infrastructure for managing workouts, user data, and fitness tracking functionality.

## Features

- **User Management**: Secure user authentication and profile management
- **Workout Management**: Create, retrieve, and manage workout routines
- **Exercise Database**: Access to a comprehensive exercise library
- **Progress Tracking**: Track workout history and performance metrics
- **Dashboard Analytics**: Weight progression, workout consistency, and fitness metrics
- **Type Safety**: Built with TypeScript for enhanced reliability and developer experience
- **API Documentation**: Auto-generated Swagger/OpenAPI documentation

## Tech Stack

- **Runtime**: Node.js (v16 or later)
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **API Documentation**: TSOA (OpenAPI/Swagger)
- **Validation**: Zod schema validation
- **Development Tools**: ESLint, Jest, Concurrently
- **AI Integration**: Anthropic Claude API for workout generation

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v16 or later) - [Download here](https://nodejs.org/)
- **PostgreSQL** (v12 or later) - [Download here](https://www.postgresql.org/download/)
- **npm** or **yarn** package manager
- **Git** for cloning the repository

## Getting Started

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/areejfnaqvi/masters-fit-backend.git
cd masters-fit-backend

# Install dependencies
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Database Configuration
DATABASE_URL=your_database_url

# Server Configuration
PORT=5000
NODE_ENV=development

# API Keys
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# CORS Configuration (for frontend)
ALLOWED_ORIGINS=http://192.168.30.243:8081,http://localhost:8081,exp://192.168.30.243:8081
```

**Important Notes:**

- Ask the development team for the database URL
- Get your Anthropic API key from [Anthropic Console](https://console.anthropic.com/) or ask the development team for their API key
- Update `ALLOWED_ORIGINS` with your development machine's IP address

### 3. Database Setup

```bash
# Ensure PostgreSQL is running
# Create the database (if it doesn't exist)
createdb mastersfit

# Run database migrations
npm run db:migrate

# (Optional) Launch Drizzle Studio to view/manage database
npm run db:studio
```

### 4. Running the Server

#### Development Mode (Recommended for development)

```bash
npm run dev
```

This will:

- Start the development server with hot-reload on port 5000
- Generate API routes and specifications automatically
- Watch for file changes and restart the server
- Enable detailed logging

#### Production Mode

```bash
npm run build
npm start
```

### 5. Verify Installation

Once the server is running, you should see:

```
🚀 Server running on port 5000
📚 API documentation available at http://localhost:5000/docs
💾 Database connected successfully
```

Visit the API documentation at: `http://localhost:5000/docs`

## Available Scripts

| Script               | Description                                   |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Start development server with hot-reload      |
| `npm run build`      | Build TypeScript to JavaScript for production |
| `npm start`          | Run production server                         |
| `npm run lint`       | Run ESLint for code quality                   |
| `npm run test`       | Run Jest test suite                           |
| `npm run db:push`    | Push schema changes to database               |
| `npm run db:migrate` | Run database migrations                       |
| `npm run db:studio`  | Launch Drizzle Studio (database GUI)          |
| `npm run tsoa`       | Generate API specifications                   |
| `npm run tsc`        | Type check without emitting files             |

## API Documentation

When the server is running, access the interactive Swagger UI documentation at:

- **Development**: `http://localhost:5000/docs`
- **Production**: `http://localhost:5000/docs`

The API provides endpoints for:

- User authentication and management
- Workout creation and tracking
- Exercise database and search
- Dashboard analytics and metrics
- Progress tracking and reporting

## Project Structure

```
backend/
├── src/
│   ├── controllers/       # API route controllers
│   │   ├── auth.controller.ts
│   │   ├── dashboard.controller.ts
│   │   ├── user.controller.ts
│   │   └── workout.controller.ts
│   ├── services/          # Business logic layer
│   │   ├── auth.service.ts
│   │   ├── dashboard.service.ts
│   │   ├── user.service.ts
│   │   └── workout.service.ts
│   ├── routes/            # Route definitions
│   ├── db/                # Database configuration
│   │   ├── schema.ts      # Database schema
│   │   └── index.ts       # Database connection
│   ├── types/             # TypeScript type definitions
│   └── index.ts           # Application entry point
├── dist/                  # Compiled JavaScript output
├── generated/             # Auto-generated API routes (TSOA)
├── migrations/            # Database migration files
├── tsoa.json             # TSOA configuration
├── drizzle.config.ts     # Drizzle ORM configuration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies and scripts
```

## Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow ESLint configuration for consistent formatting
- Use meaningful variable and function names
- Document API endpoints with TSOA decorators

### Database Changes

```bash
# 1. Modify schema in src/db/schema.ts
# 2. Generate and run migration
npm run db:migrate

# 3. (Optional) View changes in Drizzle Studio
npm run db:studio
```

### API Development

```bash
# 1. Add controller methods with TSOA decorators
# 2. Regenerate API routes
npm run tsoa

# 3. Test endpoints in Swagger UI
# http://localhost:5000/docs
```

## Troubleshooting

### Common Issues

**1. Database Connection Failed**

```bash
# Check if PostgreSQL is running
brew services list | grep postgresql
# or
sudo systemctl status postgresql

# Test connection
psql -h localhost -U username -d mastersfit
```

**2. Port Already in Use**

```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>
```

**3. TypeScript Compilation Errors**

```bash
# Run type checking
npm run tsc

# Check for missing dependencies
npm install
```

**4. Missing Environment Variables**

- Ensure `.env` file exists and contains all required variables
- Check that `ANTHROPIC_API_KEY` is valid
- Verify `DATABASE_URL` format is correct

**5. CORS Issues**

- Update `ALLOWED_ORIGINS` in `.env` with your development machine's IP
- Use `ipconfig` (Windows) or `ifconfig` (Mac/Linux) to find your IP address

### Getting Help

1. Check the [API documentation](http://localhost:5000/docs) for endpoint details
2. Review logs in the terminal for specific error messages
3. Use Drizzle Studio (`npm run db:studio`) to inspect database state
4. Run `npm run lint` to check for code quality issues

## Security

- CORS enabled for specified origins only
- Request validation using Zod schemas
- TypeScript for compile-time type safety
- Environment variables for sensitive configuration
- Input sanitization and validation on all endpoints

## Performance

- Database queries optimized with Drizzle ORM
- Response caching for static data
- Efficient data aggregation for dashboard metrics
- Connection pooling for database connections

## Deployment

For production deployment:

1. Set `NODE_ENV=production` in environment
2. Use a production PostgreSQL database
3. Configure proper CORS origins
4. Set up SSL/TLS termination
5. Use a process manager like PM2
6. Monitor logs and performance

## Support

For support, please:

1. Check this README and troubleshooting section
2. Review the API documentation
3. Open an issue in the repository
4. Contact the development team

---

## License

This project is proprietary software. All rights reserved.
