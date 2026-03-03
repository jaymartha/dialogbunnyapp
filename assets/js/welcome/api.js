export function normalizePrompt(prompt) {
  const documentIds =
    prompt.referred_documents ||
    prompt.referredDocuments ||
    prompt.documentIds ||
    prompt.documents ||
    prompt.document_ids ||
    [];

  return {
    id: String(prompt._id ?? prompt.id ?? prompt.promptId ?? ''),
    name: prompt.prompt_name || prompt.name || prompt.title || 'Untitled prompt',
    description: prompt.description || 'No description provided.',
    promptText: prompt.prompt || '',
    type: prompt.type || '',
    userId: String(prompt.user_id ?? ''),
    documentIds: Array.isArray(documentIds) ? documentIds.map(String) : [],
  };
}
