const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer → Main
  startOAuth: () => ipcRenderer.invoke('start-oauth'),
  loadWelcome: (userData) => ipcRenderer.invoke('load-welcome', userData),
  loadChat: (sessionConfig) => ipcRenderer.invoke('load-chat', sessionConfig),
  signOut: () => ipcRenderer.invoke('sign-out'),
  getSpeechToken: () => ipcRenderer.invoke('get-speech-token'),
  uploadScreenCapture: (payload) => ipcRenderer.invoke('upload-screen-capture', payload),

  // Main → Renderer (event listeners)
  onOAuthSuccess: (callback) => ipcRenderer.on('oauth-success', (_event, data) => callback(data)),
  onOAuthError: (callback) => ipcRenderer.on('oauth-error', (_event, msg) => callback(msg)),
  onUserData: (callback) => ipcRenderer.on('user-data', (_event, data) => callback(data)),
  onSessionConfig: (callback) => ipcRenderer.on('session-config', (_event, data) => callback(data)),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
