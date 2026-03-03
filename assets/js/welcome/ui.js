import { state } from './state.js';

function renderTopUser(user) {
  const topEmail = document.getElementById('topEmail');
  const heroName = document.getElementById('heroName');
  const topAvatar = document.getElementById('topAvatar');

  const name = user?.name || 'there';
  const firstName = name.split(' ')[0];
  const email = user?.email || 'unknown user';

  topEmail.textContent = email;
  heroName.textContent = firstName;

  if (user?.picture) {
    topAvatar.innerHTML = `<img src="${user.picture}" alt="${name}" />`;
  } else {
    const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    topAvatar.textContent = initials || '?';
  }
}

function renderPermissionStatus() {
  const micStatus = document.getElementById('micStatus');
  const screenStatus = document.getElementById('screenStatus');
  const micBtn = document.getElementById('grantMicBtn');
  const screenBtn = document.getElementById('grantScreenBtn');

  micStatus.textContent = state.micGranted ? 'Microphone: granted' : 'Microphone: not granted';
  micStatus.className = `status ${state.micGranted ? 'status-ready' : 'status-pending'}`;

  screenStatus.textContent = state.screenGranted ? 'Screen: granted' : 'Screen: not granted';
  screenStatus.className = `status ${state.screenGranted ? 'status-ready' : 'status-pending'}`;

  micBtn.disabled = state.micGranted;
  micBtn.textContent = state.micGranted ? 'Granted' : 'Grant access';

  screenBtn.disabled = state.screenGranted;
  screenBtn.textContent = state.screenGranted ? 'Granted' : 'Grant access';
}

function renderPromptOptions() {
  const promptSelect = document.getElementById('promptSelect');
  promptSelect.innerHTML = '<option value="">Select a prompt</option>';

  state.prompts.forEach((prompt) => {
    const option = document.createElement('option');
    option.value = prompt.id;
    option.textContent = prompt.name;
    promptSelect.appendChild(option);
  });

  promptSelect.disabled = false;
}

function renderPromptDetails() {
  const promptMeta = document.getElementById('promptMeta');
  const promptName = document.getElementById('promptName');
  const promptDescription = document.getElementById('promptDescription');
  const documentList = document.getElementById('documentList');

  if (!state.selectedPrompt) {
    promptMeta.classList.add('hidden');
    return;
  }

  promptMeta.classList.remove('hidden');
  promptName.textContent = state.selectedPrompt.name;
  promptDescription.textContent = state.selectedPrompt.description;

  documentList.innerHTML = '';
  if (!state.documents.length) {
    const li = document.createElement('li');
    li.textContent = 'No linked documents for this prompt.';
    documentList.appendChild(li);
    return;
  }

  state.documents.forEach((doc) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="doc-name">${doc.name}</span>
      <span class="doc-meta">Type: ${doc.type}</span>
    `;
    documentList.appendChild(li);
  });
}

function renderPromptError(message) {
  const promptError = document.getElementById('promptError');
  if (!message) {
    promptError.classList.add('hidden');
    promptError.textContent = '';
    return;
  }

  promptError.classList.remove('hidden');
  promptError.textContent = message;
}

function renderLaunchState() {
  const launchBtn = document.getElementById('launchBtn');
  const launchSummary = document.getElementById('launchSummary');

  const ready = state.micGranted && state.screenGranted && !!state.selectedPrompt;
  launchBtn.disabled = !ready;

  if (ready) {
    launchSummary.textContent = `Ready to launch with prompt "${state.selectedPrompt.name}" (${state.documents.length} document(s)).`;
  } else {
    const blockers = [];
    if (!state.micGranted) blockers.push('microphone access');
    if (!state.screenGranted) blockers.push('screen access');
    if (!state.selectedPrompt) blockers.push('prompt selection');
    launchSummary.textContent = `Waiting on: ${blockers.join(', ')}.`;
  }
}

export function renderAll() {
  renderTopUser(state.user);
  renderPermissionStatus();
  renderPromptDetails();
  renderLaunchState();
}

export function showPromptsLoaded() {
  renderPromptOptions();
  renderPromptError('');
}

export function showPromptError(message) {
  renderPromptError(message);
}

export function showPromptLoadingError() {
  const promptSelect = document.getElementById('promptSelect');
  promptSelect.disabled = true;
  promptSelect.innerHTML = '<option value="">Failed to load prompts</option>';
}
