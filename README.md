# Orbit — Electron Gmail OAuth App

A minimal Electron app with Gmail OAuth2 login flow.

## How it works

```
User clicks "Continue with Google"
    ↓
Electron opens the Google OAuth URL in the system browser
    ↓
Local server starts on http://localhost:3000
    ↓
User completes sign-in on Google
    ↓
Google redirects to http://localhost:3000/app/session/1234
    ↓
Local server exchanges the code for tokens, fetches user info
    ↓
Server sends oauth-success IPC event to Electron renderer
    ↓
Electron loads views/welcome.html (View 2) with user data
```

## Setup

### 1. Google Cloud Console

1. Go to https://console.cloud.google.com
2. Create a new project (or select one)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add to **Authorized redirect URIs**:
   ```
   http://localhost:3000/app/session/1234
   ```
7. Copy your **Client ID** and **Client Secret**

### 2. Configure the app

Open `main.js` and replace:

```js
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET';
```

### 3. Install & run

```bash
npm install
npm start
```

## File structure

```
electron-gmail-app/
├── main.js          # Main process — OAuth logic, callback server, IPC handlers
├── preload.js       # Secure bridge between main ↔ renderer
├── views/
│   ├── login.html   # View 1 — Login screen
│   └── welcome.html # View 2 — Welcome dashboard
└── package.json
```

## Security notes

- The OAuth callback runs on `127.0.0.1` (localhost only), not accessible externally
- `contextIsolation: true` and `nodeIntegration: false` ensure the renderer is sandboxed
- Tokens are held only in memory and not persisted (add a secure store like `keytar` for production)
