# CareCircle Monorepo

CareCircle is a family & elderly care check-in management system.

## Project Structure

```text
CareCircle/
├── backend/                  # Node.js + Express + Prisma with PostgreSQL
│   ├── prisma/
│   │   ├── migrations/       # Database migrations
│   │   ├── schema.prisma     # Prisma data models (User, CheckIn, Alert)
│   │   └── seed.js           # Seed script (1 Senior + 1 Family member)
│   ├── src/
│   │   └── index.js          # Express REST API endpoints
│   ├── test/
│   │   └── api.test.js       # Integration test suite
│   ├── .env.example          # Environment template
│   └── package.json
├── frontend/                 # React + Vite + Tailwind CSS
│   ├── src/
│   │   ├── App.jsx           # Dashboard UI preview styled with Tailwind CSS
│   │   ├── index.css         # Tailwind CSS directives
│   │   └── main.jsx
│   ├── vite.config.js        # Vite + Tailwind configuration
│   └── package.json
├── .gitignore                # Root gitignore rules
├── package.json              # Monorepo workspaces configuration
└── README.md
```

## Data Models

1. **User**:
   - `id`: Unique identifier (UUID)
   - `name`: Full name
   - `role`: Role enum (`SENIOR`, `FAMILY`)
   - `phone`: Contact phone number
   - `familyGroupId`: Identifier linking family members and senior together
   - `checkIns`: Relation to CheckIn records
   - `alerts`: Relation to Alert records
   - `createdAt`, `updatedAt`: Timestamps

2. **CheckIn**:
   - `id`: Unique identifier (UUID)
   - `userId`: Foreign key to `User`
   - `type`: Check-in type enum (`PILLS`, `MEAL`, `MOOD`)
   - `status`: Status description / outcome
   - `timestamp`: Timestamp of check-in

3. **Alert**:
   - `id`: Unique identifier (UUID)
   - `userId`: Foreign key to `User`
   - `type`: Alert type enum (`NO_CHECKIN`, `SOS`)
   - `status`: Alert status enum (`ACTIVE`, `RESOLVED`)
   - `timestamp`: Timestamp of alert

## Getting Started

### 1. Prerequisites
- Node.js (v18+)
- PostgreSQL running locally on port 5432 (or configured in `backend/.env`)

### 2. Environment Configuration
Copy `backend/.env.example` to `backend/.env` and update the connection string:
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/carecircle?schema=public"
PORT=5000
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Migrations & Seeding
From the `backend` directory:
```bash
# Run migration
npm run prisma:migrate

# Seed database with initial senior + family user
npm run prisma:seed

# Inspect database with Prisma Studio
npm run prisma:studio
```

### 5. Running the Applications
```bash
# Run both frontend and backend concurrently
npm run dev

# Or run individually
npm run dev:backend
npm run dev:frontend
```

### 6. Running Tests
```bash
npm test --workspace=backend
```
