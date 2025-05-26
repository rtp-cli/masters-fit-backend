# FitTrack API Server

A RESTful API server for the FitTrack fitness tracking application. This server provides endpoints for user authentication, workout management, exercise data, progress tracking, and more.

## Running Modes

This server can be run in two modes:

1. **Integrated Mode**: Used when running with the client application (default)
   - The server is initialized through `server/index.ts`
   - Vite handles serving both API and client from the same port
   - This is the mode used when running the full application with `npm run dev` from the project root

2. **Standalone Mode**: Used when running the server independently
   - The server is initialized through `server/standalone-index.ts`
   - Only the API endpoints are available; no client is served
   - Run with `cd server && npm run dev` or `cd server && npm start`
   - Use this mode when you want to:
     - Run the server with a different client (mobile app, custom frontend)
     - Develop the API separately from the client
     - Deploy the API as a standalone service

## Features

- **Authentication**: Passwordless authentication using email magic links
- **User Management**: User profiles and preferences
- **Workout Management**: Create, update, and track workouts
- **Exercise Database**: Access to a comprehensive exercise database
- **Progress Tracking**: Log workout completions and track fitness metrics
- **Achievement System**: Recognize user milestones and achievements

## Tech Stack

- **Node.js** with **Express**: Fast, unopinionated web framework
- **TypeScript**: Type-safe JavaScript
- **PostgreSQL**: Relational database (via Drizzle ORM)
- **Drizzle ORM**: TypeScript-first ORM with Zod validation
- **Zod**: TypeScript-first schema validation

## Getting Started

### Prerequisites

- Node.js (v16 or later)
- PostgreSQL database
- npm or yarn

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/your-username/fittrack.git
   cd fittrack/server
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```

4. Update the `.env` file with your database connection and other configuration values

### Database Setup

1. Set up your PostgreSQL database and update the `DATABASE_URL` in your `.env` file

2. Run database migrations:
   ```
   npm run db:migrate
   ```

### Running the Server

#### Development mode:
```
npm run dev
```

#### Production mode:
```
npm run build
npm start
```

## API Endpoints

### Authentication

- `POST /api/auth/login`: Send a magic link login email
- `POST /api/auth/verify`: Verify an authentication code

### Onboarding

- `POST /api/onboarding`: Complete user onboarding with profile data

### User Profile

- `GET /api/user/profile`: Get current user's profile
- `PUT /api/user/profile`: Update user's profile

### Exercises

- `GET /api/exercises`: Get all exercises
- `GET /api/exercises/:id`: Get a specific exercise

### Workouts

- `GET /api/workouts`: Get all user workouts
- `GET /api/workouts/:id`: Get a specific workout with its exercises
- `POST /api/workouts`: Create a new workout
- `PUT /api/workouts/:id`: Update an existing workout
- `POST /api/workouts/:id/log`: Log a completed workout

### Progress

- `GET /api/progress`: Get user's progress metrics
- `POST /api/progress`: Add a new progress metric entry

### Achievements

- `GET /api/achievements`: Get user's achievements

## Development

### Project Structure

```
server/
├── .env.example       # Example environment configuration
├── package.json       # Project dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── standalone-index.ts # Entry point for standalone server
├── index.ts           # Original entry point (when used with client)
├── routes.ts          # API route definitions
├── storage.ts         # Data storage and persistence logic
└── vite.ts            # Vite integration (for development with client)
```

### Common Development Tasks

#### Adding a new API endpoint

1. Add the endpoint to `routes.ts`
2. Implement any required storage methods in `storage.ts`
3. Update any related TypeScript types in `shared/schema.ts`

#### Working with the database

- View database schema: `npm run db:studio`
- Push schema changes: `npm run db:migrate`

## Deployment

The server can be deployed to any Node.js hosting platform:

1. Build the TypeScript code:
   ```
   npm run build
   ```

2. Start the production server:
   ```
   npm start
   ```

## Integration with Client Applications

This server is designed to work with:

- Web client (React)
- Mobile client (React Native)

The API uses standard REST endpoints with JSON responses, making it compatible with any client that can make HTTP requests.

## License

[MIT License](../LICENSE)

## Acknowledgements

- Exercise data sourced from various fitness resources
- Built with open source technologies