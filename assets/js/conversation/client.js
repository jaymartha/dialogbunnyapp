function getConversationTopic() {
  return localStorage.getItem('orbit_conversation_topic') || 'conversation-v2';
}

function log(message, level = 'log') {
  console[level === 'error' ? 'error' : 'log'](message);
  if (window.electronAPI?.rendererLog) {
    window.electronAPI.rendererLog({ level, message });
  }
}

export class ConversationClient {
  constructor(authToken) {
    this.authToken = authToken;
    this.topic = getConversationTopic();
    this.deltaListeners = new Set();
    this.completeListeners = new Set();
    this.errorListeners = new Set();
    this.statusListeners = new Set();
    this.sessionId = null;

    window.electronAPI.onConversationStatus((payload) => {
      if (!this.sessionId || payload?.sessionId !== this.sessionId) return;
      log(`[conversation] status: ${payload.status}`);
      this.statusListeners.forEach((listener) => listener(payload.status));
    });

    window.electronAPI.onConversationError((payload) => {
      if (!this.sessionId || payload?.sessionId !== this.sessionId) return;
      log(`[conversation] error: ${payload.message}`, 'error');
      this.errorListeners.forEach((listener) => listener(new Error(payload.message)));
    });

    window.electronAPI.onConversationEvent((payload) => {
      if (!this.sessionId || payload?.sessionId !== this.sessionId) return;
      const event = payload.event || {};
      log(`[conversation] event received type=${event.type || 'unknown'}`);

      if (event.type === 'response.output_text.delta') {
        this.deltaListeners.forEach((listener) => listener(event.delta || ''));
      } else if (event.type === 'response.completed') {
        this.completeListeners.forEach((listener) => listener());
      }
    });
  }

  onDelta(listener) {
    this.deltaListeners.add(listener);
    return () => this.deltaListeners.delete(listener);
  }

  onComplete(listener) {
    this.completeListeners.add(listener);
    return () => this.completeListeners.delete(listener);
  }

  onError(listener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onStatus(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async initiate(sessionId, initialPrompt, documentReferred) {
    this.sessionId = sessionId;
    log(`[conversation] initiating via main process. topic=${this.topic}`);

    await window.electronAPI.conversationInit({
      sessionId,
      token: this.authToken,
      topic: this.topic,
      initialPrompt: initialPrompt || 'Conversation initiated.',
      files: Array.isArray(documentReferred) ? documentReferred : [],
    });
  }

  appendInformation(sessionId, info) {
    return window.electronAPI.conversationAppendInformation({
      sessionId,
      topic: this.topic,
      token: this.authToken,
      text: info,
    });
  }

  appendInformationalContext(sessionId, info) {
    return this.appendInformation(sessionId, info);
  }

  appendQuestion(sessionId, question) {
    return window.electronAPI.conversationAppendQuestion({
      sessionId,
      topic: this.topic,
      token: this.authToken,
      text: question,
    });
  }

  appendAnswer(sessionId, answer) {
    return window.electronAPI.conversationAppendAnswer({
      sessionId,
      topic: this.topic,
      token: this.authToken,
      text: answer,
    });
  }

  close() {
    if (!this.sessionId) return Promise.resolve();
    return window.electronAPI.conversationEnd({ sessionId: this.sessionId });
  }
}
