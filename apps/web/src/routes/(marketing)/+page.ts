// `/` answers with HTML or Markdown depending on Accept (see ./+server.ts), so caches must key on it.
export const load = ({ setHeaders }) => {
  setHeaders({ vary: 'Accept' });
};
