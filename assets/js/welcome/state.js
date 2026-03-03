export const state = {
  user: null,
  micGranted: false,
  screenGranted: false,
  prompts: [],
  selectedPrompt: null,
  documents: [],
};

export function setState(patch) {
  Object.assign(state, patch);
}
