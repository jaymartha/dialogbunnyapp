import { readSession } from './shared/session.js';

function appendMessage(role, content) {
  const messages = document.getElementById('messages');
  const item = document.createElement('div');
  item.className = `msg ${role}`;
  item.textContent = content;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function renderSession(config) {
  if (!config?.prompt) return;

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
    li.innerHTML = `<strong>${doc.name}</strong><br/><span>${doc.type}</span>`;
    docList.appendChild(li);
  });

  const userFirstName = config.user?.name?.split(' ')[0] || 'there';
  appendMessage('bot', `Hi ${userFirstName}. Prompt \"${config.prompt.name}\" is active.`);
}

function wireComposer() {
  const input = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');

  const send = () => {
    const value = input.value.trim();
    if (!value) return;
    appendMessage('user', value);
    input.value = '';
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });
}

function init() {
  const fallbackSession = readSession();
  if (fallbackSession) renderSession(fallbackSession);

  window.electronAPI.onSessionConfig((sessionConfig) => {
    renderSession(sessionConfig);
  });

  wireComposer();
}

init();
