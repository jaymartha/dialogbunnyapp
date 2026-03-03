export const state = {
  user: null,
  appUser: null,
  appApiError: null,
  userDocuments: [],
  micGranted: false,
  screenGranted: false,
  prompts: [],
  selectedPrompt: null,
  documents: [],
};

export function setState(patch) {
  Object.assign(state, patch);
}
