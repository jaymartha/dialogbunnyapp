export async function requestMicrophoneAccess() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

export async function requestScreenAccess() {
  // Keep this to video-only; screen audio is platform-limited and can fail capture setup.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  stream.getTracks().forEach((track) => track.stop());
}
