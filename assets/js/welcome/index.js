import { fetchDocumentById, fetchPrompts } from './api.js';
import { requestMicrophoneAccess, requestScreenAccess } from './permissions.js';
import { state, setState } from './state.js';
import { renderAll, showPromptError, showPromptLoadingError, showPromptsLoaded } from './ui.js';
import { readUser, saveSession, saveUser } from '../shared/session.js';

function bindUserData() {
  const fallbackUser = readUser();
  if (fallbackUser) {
    setState({ user: fallbackUser });
    renderAll();
  }

  window.electronAPI.onUserData((userData) => {
    setState({ user: userData });
    saveUser(userData);
    renderAll();
  });
}

async function loadPrompts() {
  try {
    const prompts = await fetchPrompts();
    setState({ prompts });
    showPromptsLoaded();
  } catch (error) {
    showPromptLoadingError();
    showPromptError(error.message);
  }
}

async function handlePromptSelection(promptId) {
  const selectedPrompt = state.prompts.find((prompt) => prompt.id === promptId) || null;
  setState({ selectedPrompt, documents: [] });
  renderAll();

  if (!selectedPrompt) return;

  if (!selectedPrompt.documentIds.length) {
    showPromptError('');
    return;
  }

  try {
    const documents = await Promise.all(selectedPrompt.documentIds.map((id) => fetchDocumentById(id)));
    setState({ documents });
    showPromptError('');
    renderAll();
  } catch (error) {
    showPromptError(`Failed to load document details: ${error.message}`);
  }
}

function wireActions() {
  document.getElementById('grantMicBtn').addEventListener('click', async () => {
    try {
      await requestMicrophoneAccess();
      setState({ micGranted: true });
      renderAll();
    } catch (error) {
      showPromptError(`Microphone access failed: ${error?.name || 'unknown error'}.`);
    }
  });

  document.getElementById('grantScreenBtn').addEventListener('click', async () => {
    try {
      await requestScreenAccess();
      setState({ screenGranted: true });
      renderAll();
    } catch (error) {
      showPromptError(`Screen access failed: ${error?.name || 'unknown error'}.`);
    }
  });

  document.getElementById('promptSelect').addEventListener('change', (event) => {
    handlePromptSelection(event.target.value);
  });

  document.getElementById('launchBtn').addEventListener('click', async () => {
    const sessionConfig = {
      prompt: state.selectedPrompt,
      documents: state.documents,
      user: state.user,
      permissions: {
        microphone: state.micGranted,
        screen: state.screenGranted,
      },
    };

    saveSession(sessionConfig);
    await window.electronAPI.loadChat(sessionConfig);
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await window.electronAPI.signOut();
  });
}

async function init() {
  bindUserData();
  renderAll();
  wireActions();
  await loadPrompts();
}

init();
