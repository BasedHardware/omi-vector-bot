const pages = [
  {
    url: 'https://help.omi.me/en/articles/13153612-conversations-memories-and-chats',
    title: 'Conversations, Memories and chats',
    body: 'Use the Omi app to search your conversations and memories. Omi apps can query memories.',
    source: 'help', rank: 0.9,
  },
  {
    url: 'https://help.omi.me/en/articles/13153540-using-the-omi-app',
    title: 'Using the Omi app',
    body: 'The Omi app has an Apps Marketplace and Memories view.',
    source: 'help', rank: 0.8,
  },
  {
    url: 'https://help.omi.me/en/articles/13153599-omi-apps',
    title: 'Omi Apps',
    body: 'Install Omi apps that work with conversations and memories.',
    source: 'help', rank: 0.7,
  },
  {
    url: 'https://docs.omi.me/docs/developer/apps/Import',
    title: 'Import Apps: Read Memories Import',
    body: 'Build an Omi app that reads memories programmatically with the Read Memories Import endpoint and an app API key.',
    source: 'docs', rank: 0.6,
  },
  {
    url: 'https://docs.omi.me/api-reference/api-keys/create-api-key',
    title: 'Create API key',
    body: 'Create a developer API key with memories:read scope to access memories from an app.',
    source: 'docs', rank: 0.5,
  },
  {
    url: 'https://docs.omi.me/api-reference/conversations/get-conversation',
    title: 'Get conversation',
    body: 'Read a conversation through the developer API in your own app.',
    source: 'docs', rank: 0.4,
  },
];

function store() {
  return {
    searchDocPages: async (_query, limit, sources = []) => pages
      .filter((page) => !sources.length || sources.includes(page.source))
      .slice(0, limit)
      .map((page) => ({ ...page, chunk_index: 0 })),
  };
}

module.exports = { pages, store };
