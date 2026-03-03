const BASE_URL = localStorage.getItem('orbit_api_base_url') || 'http://localhost:4000';
const PROMPTS_ENDPOINT = `${BASE_URL}/api/prompts`;
const DOCUMENT_ENDPOINT = `${BASE_URL}/api/documents`;

function normalizePrompt(prompt) {
  const documentIds = prompt.documentIds || prompt.documents || prompt.document_ids || [];
  return {
    id: String(prompt.id ?? prompt.promptId ?? ''),
    name: prompt.name || prompt.title || 'Untitled prompt',
    description: prompt.description || 'No description provided.',
    documentIds: Array.isArray(documentIds) ? documentIds.map(String) : [],
  };
}

function normalizeDocument(doc, id) {
  return {
    id: String(doc.id ?? id),
    name: doc.name || doc.title || `Document ${id}`,
    description: doc.description || doc.summary || 'No description provided.',
    type: doc.type || doc.fileType || 'unknown',
  };
}

export async function fetchPrompts() {
  const response = await fetch(PROMPTS_ENDPOINT);
  if (!response.ok) throw new Error(`Prompt API failed (${response.status})`);

  const data = await response.json();
  const prompts = Array.isArray(data) ? data : data.items || data.prompts || [];
  return prompts.map(normalizePrompt);
}

export async function fetchDocumentById(documentId) {
  const response = await fetch(`${DOCUMENT_ENDPOINT}/${documentId}`);
  if (!response.ok) throw new Error(`Document API failed for ${documentId}`);

  const doc = await response.json();
  return normalizeDocument(doc, documentId);
}
