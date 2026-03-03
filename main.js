const { app, BrowserWindow, ipcMain, shell, session, desktopCapturer } = require('electron');
const { io } = require('socket.io-client');
const path = require('path');
const http = require('http');
const url = require('url');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET';
const OAUTH_CALLBACK_PORT = 4000;
const REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/app/callback`;
const OAUTH_SCOPES = 'openid email profile';
const APP_API_BASE_URL = 'http://localhost:3000';
const SPEECH_TOKEN_ENDPOINT = `${APP_API_BASE_URL}/api/speech/token`;
const SCREEN_CAPTURE_ENDPOINT = `${APP_API_BASE_URL}/api/screen/capture`;


let mainWindow;
let callbackServer;
let latestTokenData = null;
let pendingChatConfig = null;
const conversationSockets = new Map();

// ─── SCREEN-SHARE PROTECTION ──────────────────────────────────────────────────
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

    if (!parsedUrl.pathname.startsWith('/app/callback')) {
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
      latestTokenData = tokenData;
      let appUser = null;
      let prompts = [];
      let userDocuments = [];
      let appApiError = null;

      try {
        appUser = await fetchAppUser(userInfo.email, tokenData);
        const normalizedAppUser = normalizeAppUser(appUser);
        appUser = normalizedAppUser;
        const appUserId = normalizedAppUser?._id || normalizedAppUser?.id || normalizedAppUser?.user_id;
        prompts = appUserId ? await fetchPromptsForUser(appUserId, tokenData) : [];
        userDocuments = appUserId ? await fetchDocumentsForUser(appUserId, tokenData) : [];
      } catch (apiErr) {
        appApiError = apiErr.message;
        console.error('App bootstrap API error:', apiErr);
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(buildBrowserPage(
        'Login Successful!',
        `You're signed in as <strong>${userInfo.email}</strong>. You can close this tab and return to the app.`,
        true,
      ));

      if (mainWindow) {
        mainWindow.webContents.send('oauth-success', {
          oauthUser: {
            name: userInfo.name,
            email: userInfo.email,
            picture: userInfo.picture,
          },
          appUser,
          prompts,
          userDocuments,
          appApiError,
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

  callbackServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
    console.log(`OAuth callback server listening on http://localhost:${OAUTH_CALLBACK_PORT}`);
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

function buildAuthHeaders(tokenData) {
  const idToken = tokenData?.id_token || '';

  return {
    Authorization: `Bearer ${idToken}`
  };
}

function normalizeAppUser(appUser) {
  if (!appUser || typeof appUser !== 'object') return appUser;
  if (appUser.user && typeof appUser.user === 'object') return appUser.user;
  if (appUser.data && typeof appUser.data === 'object') return appUser.data;
  return appUser;
}

async function fetchAppUser(email, tokenData) {
  const response = await fetch(`${APP_API_BASE_URL}/api/user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(tokenData),
    },
    body: JSON.stringify({
      email,
      user_type: 'google',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch app user (${response.status}): ${text}`);
  }

  return response.json();
}

async function fetchPromptsForUser(userId, tokenData) {
  const response = await fetch(`${APP_API_BASE_URL}/api/prompt/all/${encodeURIComponent(String(userId))}`, {
    headers: buildAuthHeaders(tokenData),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch prompts (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.prompts)) return data.prompts;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

async function fetchDocumentsForUser(userId, tokenData) {
  const response = await fetch(`${APP_API_BASE_URL}/api/document/all/${encodeURIComponent(String(userId))}`, {
    headers: buildAuthHeaders(tokenData),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch documents (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.documents)) return data.documents;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

async function fetchSpeechToken(tokenData) {
  const response = await fetch(SPEECH_TOKEN_ENDPOINT, {
    headers: buildAuthHeaders(tokenData),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch speech token (${response.status}): ${text}`);
  }

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
  latestTokenData = null;
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

ipcMain.handle('load-chat', async (event, sessionConfig) => {
  if (mainWindow) {
    console.log('[chat] load-chat invoked');
    const enrichedSessionConfig = { ...sessionConfig };
    enrichedSessionConfig.googleIdToken = latestTokenData?.id_token || null;
    console.log('[chat] id token available:', Boolean(enrichedSessionConfig.googleIdToken));
    if (latestTokenData) {
      try {
        enrichedSessionConfig.speech = await fetchSpeechToken(latestTokenData);
        console.log('[chat] speech token fetched');
      } catch (error) {
        enrichedSessionConfig.speechTokenError = error.message;
        console.error('[chat] speech token fetch failed:', error.message);
      }
    } else {
      enrichedSessionConfig.speechTokenError = 'No active auth token. Please sign in again.';
      console.error('[chat] no latestTokenData available');
    }

    pendingChatConfig = enrichedSessionConfig;
    mainWindow.loadFile(path.join(__dirname, 'views', 'chat.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[chat] did-finish-load, waiting for chat-ready handshake');
    });
  }
});

ipcMain.handle('chat-ready', () => {
  console.log('[chat] renderer reported chat-ready');
  if (mainWindow && pendingChatConfig) {
    mainWindow.webContents.send('session-config', pendingChatConfig);
    console.log('[chat] session-config sent after chat-ready');
    pendingChatConfig = null;
  }
});

ipcMain.handle('renderer-log', (_event, payload) => {
  const level = payload?.level || 'log';
  const message = payload?.message || '';
  if (level === 'error') {
    console.error(`[renderer] ${message}`);
  } else {
    console.log(`[renderer] ${message}`);
  }
});

ipcMain.handle('get-speech-token', async () => {
  if (!latestTokenData) {
    throw new Error('No active auth token. Please sign in again.');
  }

  return fetchSpeechToken(latestTokenData);
});

ipcMain.handle('get-google-id-token', () => {
  return latestTokenData?.id_token || null;
});

ipcMain.handle('upload-screen-capture', async (_event, payload) => {
  if (!latestTokenData) {
    throw new Error('No active auth token. Please sign in again.');
  }

  const response = await fetch(SCREEN_CAPTURE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(latestTokenData),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload screen capture (${response.status}): ${text}`);
  }

  return response.json();
});

function sendConversationChannel(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

ipcMain.handle('conversation-init', async (_event, payload) => {
  const { sessionId, token, topic, initialPrompt, files } = payload || {};
  if (!sessionId || !token || !topic) {
    throw new Error('conversation-init missing required fields');
  }

  const existing = conversationSockets.get(sessionId);
  if (existing) {
    existing.disconnect();
    conversationSockets.delete(sessionId);
  }

  const socket = io('ws://localhost:3000', {
    transports: ['websocket', 'polling'],
    extraHeaders: {
      Authorization: `Bearer ${token}`,
    },
    auth: {
      token,
    },
    query: {
      token,
    },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  conversationSockets.set(sessionId, socket);
  sendConversationChannel('conversation-status', { sessionId, status: 'connecting' });

  socket.on('connect', () => {
    sendConversationChannel('conversation-status', { sessionId, status: 'connected' });
    const message = {
      session_id: sessionId,
      token,
      type: 'session.create',
      response: {
        instructions: initialPrompt || 'Conversation initiated.',
      },
    };
    if (Array.isArray(files) && files.length) {
      message.response.files = files;
    }
    socket.emit(topic, message);
  });

  socket.on(topic, (event) => {
    sendConversationChannel('conversation-event', { sessionId, event });
  });

  socket.on('disconnect', () => {
    sendConversationChannel('conversation-status', { sessionId, status: 'disconnected' });
  });

  socket.on('connect_error', (error) => {
    sendConversationChannel('conversation-error', { sessionId, message: error?.message || String(error) });
  });

  socket.on('error', (error) => {
    sendConversationChannel('conversation-error', { sessionId, message: error?.message || String(error) });
  });

  return { ok: true };
});

ipcMain.handle('conversation-append-information', (_event, payload) => {
  const { sessionId, topic, token, text } = payload || {};
  const socket = conversationSockets.get(sessionId);
  if (!socket) throw new Error('conversation socket not initialized');
  socket.emit(topic, {
    session_id: sessionId,
    token,
    type: 'session.information_only',
    response: { instructions: text },
  });
  return { ok: true };
});

ipcMain.handle('conversation-append-question', (_event, payload) => {
  const { sessionId, topic, token, text } = payload || {};
  const socket = conversationSockets.get(sessionId);
  if (!socket) throw new Error('conversation socket not initialized');
  socket.emit(topic, {
    session_id: sessionId,
    token,
    type: 'response.create',
    response: { instructions: text },
  });
  return { ok: true };
});

ipcMain.handle('conversation-append-answer', (_event, payload) => {
  const { sessionId, topic, token, text } = payload || {};
  const socket = conversationSockets.get(sessionId);
  if (!socket) throw new Error('conversation socket not initialized');
  socket.emit(topic, {
    session_id: sessionId,
    token,
    type: 'response.received',
    response: { instructions: text },
  });
  return { ok: true };
});

ipcMain.handle('conversation-end', (_event, payload) => {
  const sessionId = payload?.sessionId;
  const socket = conversationSockets.get(sessionId);
  if (socket) {
    socket.disconnect();
    conversationSockets.delete(sessionId);
  }
  return { ok: true };
});

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Allow media permission requests from our renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
      return;
    }

    callback(false);
  });

  // Wire display-media capture for navigator.mediaDevices.getDisplayMedia.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        callback({ video: sources[0] });
      } catch (error) {
        console.error('display capture source error:', error);
        callback({});
      }
    },
    { useSystemPicker: true },
  );

  createWindow();
});

app.on('window-all-closed', () => {
  conversationSockets.forEach((socket) => socket.disconnect());
  conversationSockets.clear();
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
