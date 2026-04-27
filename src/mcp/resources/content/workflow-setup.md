# Zond Setup

## Step 1: Check current installation
```bash
which zond 2>/dev/null && zond --version --json 2>/dev/null || echo "NOT_INSTALLED"
```

## Step 2: Act on result

### If NOT_INSTALLED — install binary

Detect OS from the shell environment and run the matching installer:

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh
```

**Windows (PowerShell):**
```powershell
powershell -NoProfile -Command "iwr https://raw.githubusercontent.com/kirrosh/zond/master/install.ps1 | iex"
```

After install, verify: `zond --version`

If install script fails (no curl, corporate firewall), fall back to: `npx -y @kirrosh/zond@latest` as prefix for all zond commands.

### If already installed — check for updates
```bash
zond update --check --json
```

| `action` in response | What to do |
|---|---|
| `"available"` | Run `zond update --json`. If EACCES: `sudo zond update --json` |
| `"none"` | Up to date. Done. |
| `"skip"` (exit code 3) | Not a binary — reinstall as binary using install commands above |

## Step 3: Done
Report the installed version to the user.
