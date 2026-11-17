/** Open the agent from anywhere, optionally sending a request straight away. */
export const ask = (question = '') => window.dispatchEvent(new CustomEvent('databag:ask', { detail: question }));
