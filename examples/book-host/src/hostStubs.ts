/** Minimal @newscast/host stub so registry ThemeProvider and hooks can load in Book. */
export function createHostStub(): Record<string, unknown> {
  const secureStore = {
    getItemAsync: async () => null,
    setItemAsync: async () => undefined,
    deleteItemAsync: async () => undefined,
  };
  const gqlClient = { request: async () => ({}) };
  return {
    secureStore,
    createGqlClient: () => gqlClient,
    publicGqlClient: gqlClient,
    ARTICLE_FIELDS: '',
    FEED_QUERY: '',
    ARTICLE_QUERY: '',
    SAVED_ARTICLES_QUERY: '',
    READ_ARTICLES_QUERY: '',
    MY_TOPICS_QUERY: '',
    TOPICS_DRAWER_QUERY: '',
    SEARCH_TOPICS_QUERY: '',
    MY_STATS_QUERY: '',
    MY_THEME_QUERY: '',
    MY_PREFERENCES_QUERY: '',
    SAVE_ARTICLE_MUTATION: '',
    UNSAVE_ARTICLE_MUTATION: '',
    MARK_ARTICLE_READ_MUTATION: '',
    SELECT_TOPICS_MUTATION: '',
    UNSELECT_TOPICS_MUTATION: '',
    UPDATE_THEME_MUTATION: '',
    UPDATE_PREFERENCES_MUTATION: '',
  };
}

export function createAsyncStorageStub(): Record<string, unknown> {
  const store = {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  };
  return { ...store, default: store, __esModule: true };
}

export function createLibphonenumberStub(): Record<string, unknown> {
  return {
    __esModule: true,
    default: {},
    parsePhoneNumber: () => ({ isValid: () => true }),
    isValidPhoneNumber: () => true,
  };
}
