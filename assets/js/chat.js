import { readSession, saveSession } from './shared/session.js';
import { SpeechToText } from './speech/speech-to-text.js';

let currentSession = null;
let speechClient = null;
let isListening = false;
let liveTranscript = '';

function appendMessage(role, content) {
  const messages = document.getElementById('messages');
  const item = document.createElement('div');
  item.className = `msg ${role}`;
  item.textContent = content;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function setSpeechStatus(text) {
  document.getElementById('speechStatus').textContent = `Speech status: ${text}`;
}

function updateListenButton() {
  const listenBtn = document.getElementById('listenBtn');
  listenBtn.textContent = isListening ? 'Stop listening' : 'Start listening';
  listenBtn.classList.toggle('primary', isListening);
}

function renderSession(config) {
  if (!config?.prompt) return;

  currentSession = config;
  saveSession(config);

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

  const userFirstName = config.user?.name?.split(' ')[0] || 'there';
  appendMessage('bot', `Hi ${userFirstName}. Prompt "${config.prompt.name}" is active.`);
}

async function resolveSpeechToken() {
  if (currentSession?.speech?.token) {
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

    if (streamEnded) {
      appendMessage('user', text);
      document.getElementById('messageInput').value = text;
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

  setSpeechStatus('ready');
  return speechClient;
}

async function toggleListening() {
  try {
    const client = await ensureSpeechClient();

    if (isListening) {
      client.stopListening();
      isListening = false;
      setSpeechStatus('stopped (socket kept open)');
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
      timestamp: new Date().toISOString(),
    });

    appendMessage('bot', 'Screen capture uploaded.');
    setSpeechStatus('screen capture uploaded');
  } catch (error) {
    setSpeechStatus(`screen capture failed - ${error.message}`);
  } finally {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
}

function wireActions() {
  document.getElementById('listenBtn').addEventListener('click', toggleListening);
  document.getElementById('screenCaptureBtn').addEventListener('click', captureAndUploadScreen);

  document.getElementById('getResponseBtn').addEventListener('click', () => {
    const input = document.getElementById('messageInput');
    const text = input.value.trim() || liveTranscript;
    if (!text) return;

    appendMessage('user', text);
    appendMessage('bot', 'Get response clicked. Wire this to your response API next.');
    input.value = '';
  });
}

function init() {
  const fallbackSession = readSession();
  if (fallbackSession) {
    renderSession(fallbackSession);
  }

  window.electronAPI.onSessionConfig((sessionConfig) => {
    renderSession(sessionConfig);
  });

  updateListenButton();
  wireActions();
}

init();
