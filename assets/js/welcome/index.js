import { normalizePrompt } from './api.js';
import { requestMicrophoneAccess, requestScreenAccess } from './permissions.js';
import { state, setState } from './state.js';
import { renderAll, showPromptError, showPromptLoadingError, showPromptsLoaded } from './ui.js';
import { readUser, saveSession, saveUser } from '../shared/session.js';

function bindUserData() {
  const fallbackUser = readUser();
  if (fallbackUser) {
    const prompts = Array.isArray(fallbackUser.prompts) ? fallbackUser.prompts.map(normalizePrompt) : [];
    setState({
      user: fallbackUser.oauthUser || fallbackUser,
      appUser: fallbackUser.appUser || null,
      appApiError: fallbackUser.appApiError || null,
      userDocuments: Array.isArray(fallbackUser.userDocuments) ? fallbackUser.userDocuments : [],
      prompts,
    });
    if (prompts.length) {
      showPromptsLoaded();
    } else if (fallbackUser.appApiError) {
      showPromptLoadingError();
      showPromptError(`Login succeeded, but app setup failed: ${fallbackUser.appApiError}`);
    }
    renderAll();
  }

  window.electronAPI.onUserData((userData) => {
    const oauthUser = userData?.oauthUser || userData;
    const prompts = Array.isArray(userData?.prompts) ? userData.prompts.map(normalizePrompt) : [];

    setState({
      user: oauthUser,
      appUser: userData?.appUser || null,
      appApiError: userData?.appApiError || null,
      userDocuments: Array.isArray(userData?.userDocuments) ? userData.userDocuments : [],
      prompts,
    });

    saveUser(userData);
    if (prompts.length) {
      showPromptsLoaded();
      showPromptError('');
    } else {
      showPromptLoadingError();
      if (userData?.appApiError) {
        showPromptError(`Login succeeded, but app setup failed: ${userData.appApiError}`);
      } else {
        showPromptError('No prompts found for this user.');
      }
    }
    renderAll();
  });
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
    const idSet = new Set(selectedPrompt.documentIds.map(String));
    const documents = (state.userDocuments || []).filter((doc) => idSet.has(String(doc._id || doc.id)));
    setState({ documents });

    const foundIds = new Set(documents.map((doc) => String(doc._id || doc.id)));
    const missingCount = selectedPrompt.documentIds.filter((id) => !foundIds.has(String(id))).length;

    if (missingCount > 0) {
      showPromptError(`${missingCount} linked document(s) were not found in your document library.`);
    } else {
      showPromptError('');
    }
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

function init() {
  bindUserData();
  renderAll();
  wireActions();
}

init();
