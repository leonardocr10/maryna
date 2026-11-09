// Stub of the chrome.* APIs so the content scripts run in a plain page (DOM tests with synthetic fixtures).
// window.cs(msg) calls the content script handler like the worker would.
(() => {
  const handlers = [];
  const store = {}, changed = [];
  window.chrome = {
    runtime: {
      id: 'test', sendMessage: async m => (m?.type === 'hello' ? {tabId: 1} : {ok: true}),
      onMessage: {addListener: fn => handlers.push(fn)},
      getURL: p => 'chrome-extension://test/' + p,
      connect: () => ({postMessage() {}, onDisconnect: {addListener() {}}, disconnect() {}}),
    },
    storage: {local: {get: async k => ({[k]: store[k]}), set: async o => Object.assign(store, o)}, onChanged: {addListener: fn => changed.push(fn)}},
  };
  /** Fakes a run update from the worker (storage change). */
  window.setRun = run => { store['nlauto.run'] = run; for (const fn of changed) fn({'nlauto.run': {newValue: run}}, 'local'); };
  window.cs = msg => new Promise(resolve => {
    for (const h of handlers) { if (h(msg, {}, resolve) === true) return; }
    resolve(undefined);
  });
})();
