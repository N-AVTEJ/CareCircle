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
From the root directory:
```bash
# Run migration
npm run prisma:migrate

# Seed database with initial senior + family user
npm run prisma:seed

# Inspect database with Prisma Studio
npm run prisma:studio
```
*(Or run `npx prisma studio` inside the `backend/` directory).*

### 5. Running the Applications
```bash
# Run both frontend and backend concurrently
npm run dev

# Or run individually
npm run dev:backend
npm run dev:frontend
```

### 6. Building the Monorepo
```bash
# Generates Prisma Client and builds the React production bundle
npm run build
```

### 7. Running Tests & Verification
```bash
# Runs full test suite (22 automated tests covering health, users, check-ins, alerts, Socket.io room events, case-insensitivity, and validation)
npm test

# Runs standalone Senior Check-In & Socket.io Room Verification (including real Headless Browser DOM button clicks & PostgreSQL row verification)
npm run verify:checkin
```

## API Endpoints

- `GET /health` - Service health status
- `GET /` - Root route (serves frontend in browser, or API catalog for API clients)
- `GET /api/users` - Get all users (supports `?familyGroupId=` query)
- `GET /api/users/:id` - Get single user with recent check-ins and alerts
- `POST /api/checkin` - Create check-in (`userId`, `type` [PILLS/MEAL/MOOD case-insensitive], `status`), saves to `CheckIn` table and emits `checkin:new` to `familyGroupId`'s Socket.io room
- `GET /api/checkins` - List check-ins (supports `?userId=`, `?familyGroupId=`, `?type=`, `?limit=`)
- `POST /api/checkins` - Create check-in alias
- `GET /api/alerts` - List alerts (supports `?userId=`, `?status=`)
- `POST /api/alerts` - Create alert (`userId`, `type` [NO_CHECKIN/SOS], `status` [ACTIVE/RESOLVED])
- `PATCH /api/alerts/:id` - Update alert status (`status` [ACTIVE/RESOLVED])

## Real-Time Socket.io & Senior View

- **Senior View (`/`)**: Displays 3 big, accessible 1-tap check-in buttons (**Pills**, **Meal**, **Mood**) for Senior user Eleanor Vance (`ffd75d01-03e9-4138-abd1-b095ac5ba212`). Includes double-click debounce prevention, toast auto-dismissal, and filtered activity isolation.
- **Real-Time Sync**: When a check-in is submitted, backend saves a row in the `CheckIn` table and immediately broadcasts a `checkin:new` event to room `fam_group_carecircle_101`. Any connected family members see the live update immediately.
- **Family Dashboard**: Toggle view to inspect family members, active alerts, trigger SOS/missed check-ins, and resolve alerts.

## Verifying Seeded Data in Prisma Studio

1. Run:
   ```bash
   npm run prisma:studio
   ```
2. Navigate to `http://localhost:5555` in your browser.
3. Select the **User** model to view Eleanor Vance (`SENIOR`) and David Vance (`FAMILY`) sharing `familyGroupId: fam_group_carecircle_101`.
4. Select **CheckIn** and **Alert** to view the initial seeded events for Eleanor Vance.


