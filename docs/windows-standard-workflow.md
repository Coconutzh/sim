# Windows Standard Workflow

This document explains the recommended long-term workflow for working on this project on Windows without getting confused by multiple local copies.

## 1. What Happened This Time

You had:

- an older local folder: `C:\Users\70704\Desktop\genImg\3dmodels\sim-main`
- a newer local folder: `C:\Users\70704\Desktop\genImg\3dmodels\sim_new\sim-main`

Both folders can run the same app on the same ports:

- app: `http://localhost:3000`
- realtime: `http://localhost:3002`

That means if the old folder is still running, opening `http://localhost:3000` will show the old folder's code, not the folder you are editing now.

In this case, the active dev process on port `3000` was started from:

- `C:\Users\70704\Desktop\genImg\3dmodels\sim-main`

So the page you were seeing was the old local copy, not the current `sim_new\sim-main` folder.

## 2. Most Important Rule

Keep only one canonical working copy for active development.

Recommended:

- use one Git clone as the main working directory
- do not keep switching between multiple extracted zip copies
- do not run two copies of the same project on the same ports

If you use zip downloads, you lose normal Git workflows like:

- `git pull`
- branch switching
- commit history
- easy conflict resolution

## 3. Recommended Setup Going Forward

### Best practice

Use a real Git clone, not a zip extraction.

Example:

```powershell
git clone https://github.com/Coconutzh/sim.git
cd sim
```

Then do local setup inside that single folder.

If you already have a working `.env`, copy it from the old folder into the new Git clone instead of regenerating everything every time.

## 4. First-Time Setup In A New Clone

You only need the full setup when you create a brand-new local clone or move to a new machine.

Standard sequence:

```powershell
bun install
cd packages/db
bun run db:migrate
cd ../..
bun run dev:full
```

Usually you do **not** need to reinstall Bun, PostgreSQL, or pgvector every time. Those are machine-level prerequisites and are typically one-time setup.

## 5. Daily Start Workflow

Before starting development:

1. Make sure old dev servers are not still occupying `3000` and `3002`
2. Open PowerShell in your canonical repo folder
3. Start the app from that folder only

```powershell
bun run dev:full
```

Or use the one-click starter from the repo root:

```powershell
.\start-dev.ps1
```

Or double-click:

- `start-dev.cmd`

Then open:

- `http://localhost:3000`
- `http://localhost:3002/health`

## 6. How To Confirm Which Folder `localhost:3000` Is Using

If you are unsure which local copy is serving the page, inspect the running process command line.

Example:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -in @('node.exe', 'bun.exe') } |
  Select-Object ProcessId, Name, CommandLine
```

Look for the path in the command line.

If you see something like:

```text
C:\Users\70704\Desktop\genImg\3dmodels\sim-main\...
```

then `localhost:3000` is using that folder, not another one.

## 7. Will Code Changes Automatically Appear In The Browser

Yes, if:

- you modify the same folder that is currently running
- the app is started with `bun run dev:full`

Then most frontend changes will appear automatically through hot reload or fast refresh.

Usually these changes update automatically:

- React component UI
- styles
- many API and server code changes in dev mode

Sometimes you should restart the dev server after changes to:

- `.env` files
- package dependencies
- some config files
- database schema or migration-related setup

## 8. How To Update Code Later

If you use a real Git clone, updating is usually simple and does **not** require full reconfiguration.

Standard update workflow:

```powershell
git pull
bun install
cd packages/db
bun run db:migrate
cd ../..
```

Then restart the dev server:

```powershell
bun run dev:full
```

Or use the one-click update flow from the repo root:

```powershell
.\update-and-start.ps1
```

Or double-click:

- `update-and-start.cmd`

Notes:

- `bun install` is important if `package.json` or `bun.lock` changed
- `bun run db:migrate` is important if database migrations were added
- `.env` usually does not need to be recreated unless the project added new required variables
- `update-and-start.ps1` uses `git pull --ff-only` when the tracked working tree is clean
- if tracked local edits exist, `update-and-start.ps1` falls back to `git pull --rebase --autostash`

## 9. When You Need To Touch `.env`

Usually only in these cases:

- first local setup
- the team adds new required environment variables
- you want to change local provider keys or local URLs

Normally you should keep your existing local `.env` files and only add missing keys when needed.

## 10. Best Practice When Your Friend Updates The Repo

If your friend changes code in GitHub, your normal workflow should be:

1. Go to your single Git clone
2. Run `git pull`
3. Run `bun install`
4. Run `bun run db:migrate`
5. Restart `bun run dev:full`
6. Refresh the browser

That is the standard update loop.

It is much easier than downloading a new zip and configuring again.

## 11. What To Avoid

- avoid keeping multiple active local copies of the same project
- avoid running the old copy in the background while editing the new copy
- avoid using zip downloads as your normal update workflow
- avoid recreating `.env` from scratch unless necessary

## 12. Recommended Next Step For This Machine

Choose one folder as the only active development folder.

Recommended:

- keep a single proper Git clone
- stop the old dev process
- start `bun run dev:full` from the folder you actually want to edit

After that, the browser will reflect the code from that folder, and your edits will be much easier to verify.

## 13. One-Click Commands In This Repo

At the repo root:

- `start-dev.ps1`: starts `apps/sim` and `apps/realtime` from this repo
- `start-dev.cmd`: Windows double-click wrapper for `start-dev.ps1`
- `update-and-start.ps1`: runs `git pull --ff-only`, `bun install`, `bun run db:migrate`, then starts the dev services
- `update-and-start.cmd`: Windows double-click wrapper for `update-and-start.ps1`

Recommended usage:

- normal coding day: use `start-dev.cmd`
- after pulling remote updates: use `update-and-start.cmd`
