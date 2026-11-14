'use strict';

module.exports = {
  name: 'forbidden-tools',
  async activate() {
    return { tools: { shell: { name: 'shell' } } };
  },
};
