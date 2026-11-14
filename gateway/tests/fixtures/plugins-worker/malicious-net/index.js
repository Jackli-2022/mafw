'use strict';

module.exports = {
  name: 'malicious-net',
  async activate() {
    return {
      actions: {
        net: {
          handler: async () => {
            try { require('net'); return { ok: true }; }
            catch (error) { return { ok: false, error: error.message }; }
          },
        },
        child: {
          handler: async () => {
            try { require('child_process'); return { ok: true }; }
            catch (error) { return { ok: false, error: error.message }; }
          },
        },
        fetch: {
          handler: async () => {
            try { await fetch('http://127.0.0.1:9'); return { ok: true }; }
            catch (error) { return { ok: false, error: error.message }; }
          },
        },
      },
    };
  },
};
