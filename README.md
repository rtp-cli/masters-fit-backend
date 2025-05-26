# MastersFit API Server

A modern, TypeScript-based RESTful API server for the MastersFit fitness tracking application. This server provides a robust backend infrastructure for managing workouts, user data, and fitness tracking functionality.

## Features

- **User Management**: Secure user authentication and profile management
- **Workout Management**: Create, retrieve, and manage workout routines
- **Exercise Database**: Access to a comprehensive exercise library
- **Progress Tracking**: Track workout history and performance metrics
- **Type Safety**: Built with TypeScript for enhanced reliability and developer experience
- **API Documentation**: Auto-generated Swagger/OpenAPI documentation

## Tech Stack

- **Runtime**: Node.js (v16 or later)
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **API Documentation**: TSOA (OpenAPI/Swagger)
- **Validation**: Zod schema validation
- **Development Tools**: ESLint, Jest, Concurrently

## Prerequisites

- Node.js (v16 or later)
- PostgreSQL database
- npm or yarn package manager

## Getting Started

### Installation

1. Clone the repository and navigate to the server directory:
   ```bash
   git clone https://github.com/areejfnaqvi/masters-fit-backend.git
   cd server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the variables defined in `.env.example`

### Database Setup

1. Ensure your PostgreSQL database is running
2. Run database migrations:
   ```bash
   npm run db:migrate
   ```

3. (Optional) Launch Drizzle Studio to view/manage database:
   ```bash
   npm run db:studio
   ```

### Running the Server

#### Development Mode
```bash
npm run dev
```
This will:
- Start the development server with hot-reload
- Generate API routes and specifications
- Watch for file changes

#### Production Mode
```bash
npm run build
npm start
```

## API Documentation

When the server is running, access the Swagger UI documentation at:
- Development: `http://localhost:3000/docs`
- Production: `http://localhost:5000/docs`

## Available Scripts

- `npm run dev`: Start development server
- `npm run build`: Build for production
- `npm start`: Run production server
- `npm run lint`: Run ESLint
- `npm run test`: Run tests
- `npm run db:migrate`: Run database migrations
- `npm run db:studio`: Launch Drizzle Studio
- `npm run tsoa`: Generate API specifications

## Project Structure

```
server/
├── src/
│   ├── controllers/    # API route controllers
│   ├── models/        # Data models and types
│   ├── services/      # Business logic
│   ├── db/           # Database configuration and schemas
│   └── index.ts      # Application entry point
├── dist/             # Compiled JavaScript output
├── generated/        # Auto-generated API routes
├── tsoa.json        # TSOA configuration
├── drizzle.config.ts # Drizzle ORM configuration
└── tsconfig.json    # TypeScript configuration
```

## Development Guidelines

1. **Type Safety**: Always use TypeScript types/interfaces for data structures
2. **API Documentation**: Document API endpoints using TSOA decorators
3. **Database Changes**: Use Drizzle migrations for database schema changes
4. **Testing**: Write tests for new features using Jest

## Error Handling

The API uses standard HTTP status codes:
- 200: Success
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

## Security

- CORS enabled for specified origins
- Request validation using Zod schemas
- TypeScript for type safety
- Environment variables for sensitive data

## Support

For support, please open an issue in the repository or contact the development team.