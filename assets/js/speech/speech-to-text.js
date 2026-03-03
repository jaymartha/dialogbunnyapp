export class SpeechToText {
  constructor() {
    this.authToken = '';
    this.region = 'eastus';
    this.endpoint = 'https://eastus.api.cognitive.microsoft.com/';
    this.speechConfig = null;
    this.audioConfig = null;
    this.speechRecognizer = null;
    this.tokenRefreshInterval = null;
    this.streamListeners = new Set();
  }

  async initializeWithToken(token, region = 'eastus', endpoint = 'https://eastus.api.cognitive.microsoft.com/') {
    const sdk = window.SpeechSDK;
    if (!sdk) throw new Error('Microsoft Speech SDK not loaded.');

    this.authToken = token;
    this.region = region || 'eastus';
    this.endpoint = endpoint || 'https://eastus.api.cognitive.microsoft.com/';

    this.speechConfig = sdk.SpeechConfig.fromAuthorizationToken(this.authToken, this.region);
    this.speechConfig.authorizationToken = this.authToken;
    this.speechConfig.speechRecognitionLanguage = 'en-US';

    if (!this.audioConfig) {
      this.audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    }

    this.speechRecognizer = new sdk.SpeechRecognizer(this.speechConfig, this.audioConfig);
  }

  onStream(listener) {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  emitStream(payload) {
    this.streamListeners.forEach((listener) => listener(payload));
  }

  updateToken(token) {
    this.authToken = token;
    if (this.speechConfig) {
      this.speechConfig.authorizationToken = token;
    }
  }

  startTokenRefresh(fetchTokenFn) {
    this.stopTokenRefresh();
    this.tokenRefreshInterval = window.setInterval(async () => {
      try {
        await fetchTokenFn();
      } catch (error) {
        console.error('Speech token refresh failed:', error);
      }
    }, 540000);
  }

  stopTokenRefresh() {
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
      this.tokenRefreshInterval = null;
    }
  }

  startSpeechListening() {
    if (!this.speechRecognizer) {
      throw new Error('Speech recognizer not initialized.');
    }

    this.speechRecognizer.recognizing = (_recognizer, result) => {
      this.emitStream({ text: result.result.text || '', streamEnded: false });
    };

    this.speechRecognizer.recognized = (_recognizer, result) => {
      this.emitStream({ text: result.result.text || '', streamEnded: true });
    };

    this.speechRecognizer.startContinuousRecognitionAsync(() => {
      console.log('Recognition started');
    });
  }

  stopListening() {
    if (this.speechRecognizer) {
      this.speechRecognizer.stopContinuousRecognitionAsync(() => {
        console.log('Listening stopped');
      });
    }
  }

  closeCurrentSession() {
    if (this.speechRecognizer) {
      this.speechRecognizer.close();
      this.speechRecognizer = null;
    }
    this.stopTokenRefresh();
  }
}
