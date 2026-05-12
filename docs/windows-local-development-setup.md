# Windows Local Development Setup

This guide is for developers who want to run the monorepo from source on Windows PowerShell.

It covers:

- `apps/sim` main Next.js app
- `apps/realtime` Bun + Socket.IO realtime service
- `packages/db` migrations

## 1. Prerequisites

Install these first:

- Git
- Node.js 20+
- Bun
- PostgreSQL
- pgvector

Optional but useful:

- Docker Desktop
- Visual Studio Build Tools with `Desktop development with C++`

## 2. Clone And Install Dependencies

```powershell
git clone https://github.com/simstudioai/sim.git
cd sim
bun install
```

If `bun run dev` later reports `bun: command not found: next`, it usually means dependencies were not installed from the repo root. Run `bun install` again at the root.

## 3. Install Bun And Add It To PATH

Check whether Bun is already available:

```powershell
bun --version
```

If PowerShell says `bun` is not recognized, first confirm the binary exists:

```powershell
Test-Path "$HOME\.bun\bin\bun.exe"
& "$HOME\.bun\bin\bun.exe" --version
```

If that works, add Bun to your current shell:

```powershell
$env:PATH += ";$HOME\.bun\bin"
bun --version
```

To add it permanently for your user account:

```powershell
$bunBin = Join-Path $HOME ".bun\bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")

if (($userPath -split ';') -notcontains $bunBin) {
  [Environment]::SetEnvironmentVariable(
    "Path",
    ($userPath.TrimEnd(';') + ";" + $bunBin),
    "User"
  )
}
```

Then close and reopen PowerShell.

## 4. Install PostgreSQL And Add `psql` To PATH

After installing PostgreSQL, verify:

```powershell
psql -U postgres
```

If `psql` is not recognized, add the PostgreSQL `bin` directory to PATH. Example:

```powershell
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$env:PATH += ";$pgBin"
psql --version
```

To persist it:

```powershell
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")

if (($userPath -split ';') -notcontains $pgBin) {
  [Environment]::SetEnvironmentVariable(
    "Path",
    ($userPath.TrimEnd(';') + ";" + $pgBin),
    "User"
  )
}
```

Replace the path if your PostgreSQL version is different.

## 5. Install pgvector

`packages/db` migrations require `CREATE EXTENSION vector;`. PostgreSQL alone is not enough.

### Recommended: use a Postgres image that already includes pgvector

If you are fine using Docker for the database, this is the fastest path:

```powershell
docker run --name simstudio-db `
  -e POSTGRES_PASSWORD=your_password `
  -e POSTGRES_DB=simstudio `
  -p 5432:5432 `
  -d pgvector/pgvector:pg17
```

### Native Windows PostgreSQL

If you use a native Windows PostgreSQL installation, make sure pgvector is installed for that PostgreSQL version before running migrations.

Important check:

```powershell
psql -U postgres -d simstudio -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

If you get this error:

```text
extension "vector" is not available
```

then pgvector is not installed on the system yet, and `bun run db:migrate` will fail until you fix that.

For native Windows installs, this is the point where developers usually need:

- Visual Studio Build Tools
- `Desktop development with C++`
- a pgvector build/install path compatible with their PostgreSQL version

If your team wants the least friction on Windows, prefer the Docker database path above.

## 6. Create The Three `.env` Files

Create these files from the examples:

```powershell
Copy-Item packages/db/.env.example packages/db/.env
Copy-Item apps/sim/.env.example apps/sim/.env
Copy-Item apps/realtime/.env.example apps/realtime/.env
```

## 7. Generate Secrets In PowerShell

Use this PowerShell-safe snippet to generate a 32-byte hex secret:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
```

Run it three times and use the outputs for:

- `BETTER_AUTH_SECRET`
- `ENCRYPTION_KEY`
- `INTERNAL_API_SECRET`
- `API_ENCRYPTION_KEY`

`BETTER_AUTH_SECRET` and `INTERNAL_API_SECRET` must match between `apps/sim/.env` and `apps/realtime/.env`.

## 8. Fill `packages/db/.env`

Example:

```env
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/simstudio"
```

This file is used by migration and DB scripts.

## 9. Fill `apps/sim/.env`

Minimum local setup:

```env
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/simstudio"

BETTER_AUTH_SECRET=your_generated_secret
BETTER_AUTH_URL=http://localhost:3000

NEXT_PUBLIC_APP_URL=http://localhost:3000

ENCRYPTION_KEY=your_generated_secret
INTERNAL_API_SECRET=your_generated_secret
API_ENCRYPTION_KEY=your_generated_secret
```

Optional:

- `DISABLE_AUTH=true` for isolated private-network bring-up
- provider keys such as OpenAI, Anthropic, Ollama, vLLM, Cohere, Resend
- TapNow pruning flags if you are working on the simplified product surface

See `apps/sim/.env.example` for the full list.

## 10. Fill `apps/realtime/.env`

Minimum local setup:

```env
NODE_ENV=development
PORT=3002

DATABASE_URL=postgresql://postgres:your_password@localhost:5432/simstudio

BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=your_generated_secret
INTERNAL_API_SECRET=your_generated_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

The realtime service must point at the same database and share auth secrets with `apps/sim`.

## 11. Create Database And Enable `vector`

Create the database:

```powershell
psql -U postgres -c "CREATE DATABASE simstudio;"
```

Then enable pgvector:

```powershell
psql -U postgres -d simstudio -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

If the extension command fails, stop here and fix pgvector first.

## 12. Run Migrations

```powershell
cd packages/db
bun run db:migrate
cd ../..
```

## 13. Start The Local Services

Start the main app and realtime service together:

```powershell
bun run dev:full
```

Local URLs:

- App: `http://localhost:3000`
- Realtime health: `http://localhost:3002/health`

If you also want the docs app:

```powershell
cd apps/docs
bun run dev
```

Docs default to `http://localhost:3001`.

## 14. Quick Verification Checklist

After startup, verify:

- `http://localhost:3000` opens
- `http://localhost:3002/health` returns success
- login page or workspace page renders without a 500
- `bun run db:migrate` completed successfully

## 15. Common Problems

### `bun` is not recognized

Cause:

- Bun is installed but not on PATH

Fix:

- add `$HOME\.bun\bin` to PATH
- reopen PowerShell

### `psql` is not recognized

Cause:

- PostgreSQL `bin` directory is not on PATH

Fix:

- add `C:\Program Files\PostgreSQL\<version>\bin` to PATH

### `bun: command not found: next`

Cause:

- dependencies were not installed correctly

Fix:

```powershell
bun install
```

Run it at the repo root.

### `extension "vector" is not available`

Cause:

- pgvector is missing from the PostgreSQL installation

Fix:

- install pgvector for your PostgreSQL version
- confirm this succeeds before retrying migrations:

```powershell
psql -U postgres -d simstudio -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`

Cause:

- an old Next/Turbopack cache or old dev process is still serving stale font artifacts

Fix:

```powershell
Remove-Item -Recurse -Force apps/sim/.next
bun run dev:full
```

If port `3000` is still occupied, stop the old Node process first and then restart.

### `listen EADDRINUSE: address already in use :::3000`

Cause:

- another local app or old Next dev process is already using port `3000`

Fix:

- stop the existing process
- restart `bun run dev:full`

## 16. Notes For New Developers

- Do not commit local `.env` files
- `apps/sim/.env`, `apps/realtime/.env`, and `packages/db/.env` must stay aligned on database URL
- `apps/sim/.env` and `apps/realtime/.env` must share the same auth and internal secret values
- if Windows native pgvector becomes a recurring setup tax, standardize on the Docker database path for onboarding
