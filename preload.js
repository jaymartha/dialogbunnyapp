const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer → Main
  startOAuth: () => ipcRenderer.invoke('start-oauth'),
  loadWelcome: (userData) => ipcRenderer.invoke('load-welcome', userData),
  loadChat: (sessionConfig) => ipcRenderer.invoke('load-chat', sessionConfig),
  signOut: () => ipcRenderer.invoke('sign-out'),
  getSpeechToken: () => ipcRenderer.invoke('get-speech-token'),
  getGoogleIdToken: () => ipcRenderer.invoke('get-google-id-token'),
  uploadScreenCapture: (payload) => ipcRenderer.invoke('upload-screen-capture', payload),
  notifyChatReady: () => ipcRenderer.invoke('chat-ready'),
  rendererLog: (payload) => ipcRenderer.invoke('renderer-log', payload),
  conversationInit: (payload) => ipcRenderer.invoke('conversation-init', payload),
  conversationAppendInformation: (payload) => ipcRenderer.invoke('conversation-append-information', payload),
  conversationAppendQuestion: (payload) => ipcRenderer.invoke('conversation-append-question', payload),
  conversationAppendAnswer: (payload) => ipcRenderer.invoke('conversation-append-answer', payload),
  conversationEnd: (payload) => ipcRenderer.invoke('conversation-end', payload),
  setWindowOpacity: (opacity) => ipcRenderer.invoke('set-window-opacity', { opacity }),
  getWindowOpacity: () => ipcRenderer.invoke('get-window-opacity'),

  // Main → Renderer (event listeners)
  onOAuthSuccess: (callback) => ipcRenderer.on('oauth-success', (_event, data) => callback(data)),
  onOAuthError: (callback) => ipcRenderer.on('oauth-error', (_event, msg) => callback(msg)),
  onUserData: (callback) => ipcRenderer.on('user-data', (_event, data) => callback(data)),
  onSessionConfig: (callback) => ipcRenderer.on('session-config', (_event, data) => callback(data)),
  onConversationStatus: (callback) => ipcRenderer.on('conversation-status', (_event, data) => callback(data)),
  onConversationError: (callback) => ipcRenderer.on('conversation-error', (_event, data) => callback(data)),
  onConversationEvent: (callback) => ipcRenderer.on('conversation-event', (_event, data) => callback(data)),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
