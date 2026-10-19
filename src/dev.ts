/** Dev only: ?skiplobby jumps past the start screen, Playroom's lobby and our join screen (for testing). */
export const skipLobby = import.meta.env.DEV && new URLSearchParams(location.search).has('skiplobby');
