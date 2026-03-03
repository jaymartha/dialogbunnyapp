import { readSession, readUser, saveSession } from './shared/session.js';
import { SpeechToText } from './speech/speech-to-text.js';
import { ConversationClient } from './conversation/client.js';

let currentSession = null;
let speechClient = null;
let conversationClient = null;
let conversationId = null;
let isListening = false;
let liveTranscript = '';
let assistantStreamingNode = null;
let assistantResponseBuffer = '';
let lastInformationalText = '';
let lastInformationalSentAt = 0;
let questionPreviewTimer = null;
let currentFilter = 'all';

function scrollMessagesToBottom() {
  const messages = document.getElementById('messages');
  if (!messages) return;
  messages.scrollTop = messages.scrollHeight;
}

function applyMessageFilter() {
  const messages = document.querySelectorAll('#messages .msg');
  messages.forEach((message) => {
    const kind = message.dataset.kind || 'reply';
    const shouldShow = currentFilter === 'all' || kind === currentFilter;
    message.classList.toggle('msg-hidden', !shouldShow);
  });
  scrollMessagesToBottom();
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
  });
  applyMessageFilter();
}

function updateCompactMode() {
  const compact = window.innerHeight < 760;
  document.body.classList.toggle('compact', compact);
  if (compact && currentFilter === 'all') {
    setFilter('reply');
  }
}

function showQuestionPreview(text) {
  const wrapper = document.getElementById('questionPreview');
  const content = document.getElementById('questionPreviewText');
  if (!wrapper || !content) return;

  wrapper.classList.remove('hidden');
  content.textContent = text;
}

function clearQuestionPreview() {
  const wrapper = document.getElementById('questionPreview');
  const content = document.getElementById('questionPreviewText');
  if (!wrapper || !content) return;

  wrapper.classList.add('hidden');
  content.textContent = '';
}

function log(message, level = 'log') {
  console[level === 'error' ? 'error' : 'log'](message);
  if (window.electronAPI?.rendererLog) {
    window.electronAPI.rendererLog({ level, message });
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineAndNewlines(text) {
  const escaped = escapeHtml(text);
  const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return bolded.replace(/\n/g, '<br>');
}

function formatSocketText(text) {
  const source = String(text || '');
  let html = '';
  let cursor = 0;
  const codeFenceRegex = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let match;

  while ((match = codeFenceRegex.exec(source)) !== null) {
    const start = match.index;
    const end = codeFenceRegex.lastIndex;
    const language = match[1] ? match[1].trim() : '';
    const code = match[2] || '';

    if (start > cursor) {
      html += formatInlineAndNewlines(source.slice(cursor, start));
    }

    const langClass = language ? ` class="language-${escapeHtml(language)}"` : '';
    html += `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
    cursor = end;
  }

  if (cursor < source.length) {
    html += formatInlineAndNewlines(source.slice(cursor));
  }

  return html || '&nbsp;';
}

function appendMessage(role, content, options = {}) {
  const messages = document.getElementById('messages');
  const item = document.createElement('div');
  item.className = `msg ${role}`;
  item.dataset.kind = options.kind || (role === 'user' ? 'question' : 'reply');
  if (options.rich) {
    item.innerHTML = formatSocketText(content);
  } else {
    item.textContent = content;
  }
  messages.appendChild(item);
  applyMessageFilter();
  scrollMessagesToBottom();
  return item;
}

function setSpeechStatus(text) {
  document.getElementById('speechStatus').textContent = `Speech status: ${text}`;
}

function updateListenButton() {
  const listenBtn = document.getElementById('listenBtn');
  listenBtn.textContent = isListening ? 'Stop listening' : 'Start listening';
  listenBtn.classList.toggle('primary', isListening);
}

function createConversationId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `conv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function renderSession(config) {
  if (!config?.prompt) return;
  log('[chat] renderSession called');

  currentSession = config;
  saveSession(config);
  log(`[chat] session saved. has idToken: ${Boolean(config.googleIdToken)}`);

  document.getElementById('promptTitle').textContent = config.prompt.name;
  document.getElementById('promptDescription').textContent = config.prompt.description;

  const permissionsReady = config.permissions?.microphone && config.permissions?.screen;
  document.getElementById('permissionsPill').textContent = permissionsReady
    ? 'Mic and screen ready'
    : 'Missing permissions';

  const docList = document.getElementById('docList');
  docList.innerHTML = '';
  (config.documents || []).forEach((doc) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${doc.name || doc.title || 'Document'}</strong><br/><span>${doc.type || 'unknown'}</span>`;
    docList.appendChild(li);
  });

  if (config.speechTokenError) {
    setSpeechStatus(`token error - ${config.speechTokenError}`);
  }

  // Intentionally do not push system intro messages into chat stream.
}

async function resolveSpeechToken() {
  if (currentSession?.speech?.token || currentSession?.speech?.authToken || currentSession?.speech?.speech_token) {
    return currentSession.speech;
  }

  const fresh = await window.electronAPI.getSpeechToken();
  currentSession.speech = fresh;
  saveSession(currentSession);
  return fresh;
}

function readTokenPayload(payload) {
  return {
    token: payload?.token || payload?.authToken || payload?.speech_token || '',
    region: payload?.region || 'eastus',
    endpoint: payload?.endpoint || 'https://eastus.api.cognitive.microsoft.com/',
  };
}

function readDocumentReferences(config) {
  const docs = config?.documents || [];
  if (docs.length) {
    return docs.map((doc) => doc._id || doc.id).filter(Boolean);
  }

  return config?.prompt?.documentIds || [];
}

async function resolveConversationToken() {
  if (currentSession?.googleIdToken) return currentSession.googleIdToken;
  log('[chat] googleIdToken missing in session payload, requesting via IPC');
  const token = await window.electronAPI.getGoogleIdToken();
  currentSession.googleIdToken = token || null;
  saveSession(currentSession);
  log(`[chat] IPC token resolved: ${Boolean(token)}`);
  return token;
}

async function ensureConversationClient() {
  if (conversationClient && conversationId) return;
  log('[chat] ensureConversationClient start');

  const idToken = await resolveConversationToken();
  if (!idToken) throw new Error('Google id token missing for conversation socket.');
  log('[chat] conversation token ready');

  conversationId = createConversationId();
  log(`[chat] generated conversationId: ${conversationId}`);
  conversationClient = new ConversationClient(idToken);

  conversationClient.onStatus((status) => {
    setSpeechStatus(`conversation socket ${status}`);
  });

  conversationClient.onDelta((delta) => {
    if (!assistantStreamingNode) {
      assistantStreamingNode = appendMessage('bot', '', { rich: true });
      assistantResponseBuffer = '';
    }
    assistantResponseBuffer += delta;
    assistantStreamingNode.innerHTML = formatSocketText(assistantResponseBuffer);
    scrollMessagesToBottom();
  });

  conversationClient.onComplete(() => {
    if (assistantResponseBuffer && conversationClient && conversationId) {
      conversationClient.appendAnswer(conversationId, assistantResponseBuffer).catch((err) => {
        setSpeechStatus(`answer send failed - ${err.message}`);
      });
    }
    assistantStreamingNode = null;
    assistantResponseBuffer = '';
    clearQuestionPreview();
  });

  conversationClient.onError((error) => {
    setSpeechStatus(`conversation socket error - ${error?.message || String(error)}`);
  });

  const initialPrompt = currentSession?.prompt?.promptText || currentSession?.prompt?.description || '';
  const documentReferred = readDocumentReferences(currentSession);
  log(`[chat] initiating conversation socket hasInitialPrompt=${Boolean(initialPrompt)} documentCount=${documentReferred.length}`);
  await conversationClient.initiate(conversationId, initialPrompt, documentReferred);
}

async function ensureSpeechClient() {
  if (speechClient) return speechClient;

  const tokenPayload = await resolveSpeechToken();
  const { token, region, endpoint } = readTokenPayload(tokenPayload);
  if (!token) throw new Error('Speech token missing in API response.');

  speechClient = new SpeechToText();
  await speechClient.initializeWithToken(token, region, endpoint);

  speechClient.onStream(({ text, streamEnded }) => {
    if (!text) return;
    liveTranscript = text;
    document.getElementById('liveTranscriptText').textContent = text;
    showQuestionPreview(text);

    // Send information-only context only for finalized recognized speech.
    if (conversationClient && conversationId && streamEnded) {
      const normalized = text.trim().replace(/\s+/g, ' ');
      const now = Date.now();
      const isDuplicateInformational = normalized === lastInformationalText && (now - lastInformationalSentAt) < 1500;
      if (!isDuplicateInformational) {
        conversationClient.appendInformationalContext(conversationId, text).catch((err) => {
          setSpeechStatus(`info send failed - ${err.message}`);
        });
        lastInformationalText = normalized;
        lastInformationalSentAt = now;
      }
    }

    if (streamEnded) {
      document.getElementById('messageInput').value = text;
      if (questionPreviewTimer) {
        clearTimeout(questionPreviewTimer);
      }
      questionPreviewTimer = window.setTimeout(() => {
        clearQuestionPreview();
      }, 1200);
    }
  });

  speechClient.startTokenRefresh(async () => {
    const fresh = await window.electronAPI.getSpeechToken();
    const parsed = readTokenPayload(fresh);
    if (parsed.token) {
      speechClient.updateToken(parsed.token);
      currentSession.speech = fresh;
      saveSession(currentSession);
    }
  });

  setSpeechStatus('speech ready');
  return speechClient;
}

async function toggleListening() {
  try {
    await ensureConversationClient();
    const client = await ensureSpeechClient();

    if (isListening) {
      client.stopListening();
      isListening = false;
      setSpeechStatus('stopped (socket kept open)');
      clearQuestionPreview();
      updateListenButton();
      return;
    }

    client.startSpeechListening();
    isListening = true;
    setSpeechStatus('listening');
    updateListenButton();
  } catch (error) {
    setSpeechStatus(`error - ${error.message}`);
  }
}

async function captureAndUploadScreen() {
  let stream;
  try {
    setSpeechStatus('capturing screen...');
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    await window.electronAPI.uploadScreenCapture({
      image: dataUrl,
      promptId: currentSession?.prompt?.id || null,
      sessionId: conversationId,
      timestamp: new Date().toISOString(),
    });

    setSpeechStatus('screen capture uploaded');
  } catch (error) {
    setSpeechStatus(`screen capture failed - ${error.message}`);
  } finally {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
}

async function askQuestionFromInput() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim() || liveTranscript;
  if (!text) return;

  try {
    await ensureConversationClient();
    appendMessage('user', text, { kind: 'question' });
    await conversationClient.appendQuestion(conversationId, text);
    input.value = '';
    clearQuestionPreview();
  } catch (error) {
    setSpeechStatus(`question send failed - ${error.message}`);
  }
}

async function endSession() {
  if (speechClient) {
    speechClient.closeCurrentSession();
    speechClient = null;
  }

  if (conversationClient) {
    await conversationClient.close();
    conversationClient = null;
  }

  conversationId = null;
  isListening = false;
  assistantStreamingNode = null;
  assistantResponseBuffer = '';
  lastInformationalText = '';
  lastInformationalSentAt = 0;
  updateListenButton();
  setSpeechStatus('session ended');

  const lastUserData = readUser();
  await window.electronAPI.loadWelcome(lastUserData || null);
}

function wireActions() {
  document.getElementById('listenBtn').addEventListener('click', toggleListening);
  document.getElementById('screenCaptureBtn').addEventListener('click', captureAndUploadScreen);
  document.getElementById('getResponseBtn').addEventListener('click', askQuestionFromInput);
  document.getElementById('endSessionBtn').addEventListener('click', endSession);

  document.getElementById('messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      askQuestionFromInput();
    }
  });

  document.addEventListener('keydown', (event) => {
    const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'enter';
    if (!isShortcut) return;
    event.preventDefault();
    askQuestionFromInput();
  });

  document.querySelectorAll('.filter-btn').forEach((button) => {
    button.addEventListener('click', () => {
      setFilter(button.dataset.filter || 'all');
    });
  });

  const opacityRange = document.getElementById('opacityRange');
  opacityRange.addEventListener('input', async (event) => {
    const value = Number(event.target.value);
    const normalized = value / 100;
    try {
      await window.electronAPI.setWindowOpacity(normalized);
    } catch (error) {
      log(`[chat] setWindowOpacity failed: ${error.message}`, 'error');
    }
  });

  window.addEventListener('resize', updateCompactMode);
}

async function init() {
  log('[chat] init started');
  window.electronAPI.onSessionConfig(async (sessionConfig) => {
    log('[chat] session-config event received');
    renderSession(sessionConfig);
    try {
      await ensureConversationClient();
    } catch (error) {
      setSpeechStatus(`conversation socket error - ${error.message}`);
      log(`[chat] ensureConversationClient failed: ${error.message}`, 'error');
    }
  });

  const fallbackSession = readSession();
  if (fallbackSession) {
    log('[chat] fallback session found');
    renderSession(fallbackSession);
  }

  await window.electronAPI.notifyChatReady();
  log('[chat] chat-ready handshake sent');

  updateListenButton();
  wireActions();
  setFilter('all');
  updateCompactMode();
  scrollMessagesToBottom();

  try {
    const data = await window.electronAPI.getWindowOpacity();
    const initialPercent = Math.round((data.opacity || 1) * 100);
    const opacityRange = document.getElementById('opacityRange');
    opacityRange.value = String(initialPercent);
  } catch (error) {
    log(`[chat] getWindowOpacity failed: ${error.message}`, 'error');
  }
}

init();
