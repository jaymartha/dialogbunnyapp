const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const url = require('url');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET';
const REDIRECT_URI = 'http://localhost:3000/app/session/1234';
const OAUTH_SCOPES = 'openid email profile';

let mainWindow;
let callbackServer;

// ─── SCREEN-SHARE PROTECTION ──────────────────────────────────────────────────
// Root cause of "works first launch only":
//   The Swift child-process approach runs in a SEPARATE process, so
//   NSApplication.shared.windows is EMPTY — it has no connection to Electron's
//   NSApplication instance. It only appeared to work the first time due to a
//   lucky race with Electron's own setContentProtection initialisation.
//
// Correct approach:
//   Call setContentProtection(true) — which invokes NSWindowSharingNone inside
//   THIS process via Electron's Objective-C bindings — at every lifecycle point
//   where Electron may silently reset it:
//     1. Before loadFile (before any content renders)
//     2. After ready-to-show (Electron resets during BrowserWindow init)
//     3. After every did-finish-load (each navigation resets native flags)
//     4. After focus (macOS resets on app foreground on some versions)
//
// No Swift binary, no child process, no compile step needed.

function applyScreenProtection() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setContentProtection(true);
  console.log('[screen-protect] applied');
}

// ─── MAIN WINDOW ──────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#0a0a0f',
    show: false,
  });

  // 1. Apply before any content is loaded
  applyScreenProtection();

  mainWindow.loadFile(path.join(__dirname, 'views', 'login.html'));

  mainWindow.once('ready-to-show', () => {
    // 2. Re-apply right before revealing — Electron resets it during init
    applyScreenProtection();
    mainWindow.show();
  });

  // 3. Re-apply after every navigation (login→welcome, sign-out→login)
  mainWindow.webContents.on('did-finish-load', () => {
    applyScreenProtection();
  });

  // 4. Re-apply on focus (macOS resets window flags when app comes to foreground)
  mainWindow.on('focus', () => {
    applyScreenProtection();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopCallbackServer();
  });
}

// ─── OAUTH CALLBACK SERVER ────────────────────────────────────────────────────
function startCallbackServer() {
  if (callbackServer) return;

  callbackServer = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (!parsedUrl.pathname.startsWith('/app/session/')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const { code, error } = parsedUrl.query;

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(buildBrowserPage('Login Failed', `Google returned an error: <strong>${error}</strong>. You can close this tab.`, false));
      if (mainWindow) mainWindow.webContents.send('oauth-error', error);
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(buildBrowserPage('Bad Request', 'No authorization code received.', false));
      return;
    }

    try {
      const tokenData = await exchangeCodeForTokens(code);
      const userInfo = await fetchUserInfo(tokenData.access_token);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(buildBrowserPage(
        'Login Successful!',
        `You're signed in as <strong>${userInfo.email}</strong>. You can close this tab and return to the app.`,
        true,
      ));

      if (mainWindow) {
        mainWindow.webContents.send('oauth-success', {
          name: userInfo.name,
          email: userInfo.email,
          picture: userInfo.picture,
        });
        mainWindow.focus();
      }
    } catch (err) {
      console.error('Token exchange error:', err);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(buildBrowserPage('Login Error', `Something went wrong: ${err.message}`, false));
      if (mainWindow) mainWindow.webContents.send('oauth-error', err.message);
    }
  });

  callbackServer.listen(3000, '127.0.0.1', () => {
    console.log('OAuth callback server listening on http://localhost:3000');
  });
}

function stopCallbackServer() {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
}

// ─── GOOGLE OAUTH HELPERS ─────────────────────────────────────────────────────
async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  return response.json();
}

async function fetchUserInfo(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error('Failed to fetch user info');
  return response.json();
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────
ipcMain.handle('start-oauth', () => {
  startCallbackServer();

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: 'electron_oauth_state',
  });

  shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  return { started: true };
});

ipcMain.handle('sign-out', () => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, 'views', 'login.html'));
  }
});

ipcMain.handle('load-welcome', (event, userData) => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, 'views', 'welcome.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('user-data', userData);
    });
  }
});

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopCallbackServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── BROWSER SUCCESS PAGE ─────────────────────────────────────────────────────
function buildBrowserPage(title, message, success) {
  const color = success ? '#22c55e' : '#ef4444';
  const icon = success ? '✓' : '✗';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f; color: #e5e5e5;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }
    .card {
      text-align: center; padding: 60px 48px;
      background: #111118; border: 1px solid #222230;
      border-radius: 16px; max-width: 480px; width: 90%;
    }
    .icon {
      width: 72px; height: 72px; border-radius: 50%;
      background: ${color}1a; border: 2px solid ${color};
      display: flex; align-items: center; justify-content: center;
      font-size: 32px; margin: 0 auto 28px; color: ${color};
    }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
    p { color: #888; line-height: 1.6; } strong { color: #e5e5e5; }
    .close-hint { margin-top: 24px; font-size: 13px; color: #555; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1><p>${message}</p>
    <p class="close-hint">You may now close this browser tab.</p>
  </div>
</body>
</html>`;
}
