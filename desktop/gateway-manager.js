const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');

class GatewayManager extends EventEmitter {
  constructor() {
    super();
    this._process = null;
    this._logs = [];
    this._status = 'stopped';
    this._restartTimer = null;
    this._shouldRestart = false;
  }

  _getGatewayPath() {
    if (process.env.NODE_ENV === 'development') {
      return path.join(__dirname, '..', 'gateway', 'dist', 'index.js');
    }
    return path.join(process.resourcesPath, 'gateway', 'index.js');
  }

  start() {
    if (this._process) {
      return;
    }

    this._shouldRestart = true;
    this._setStatus('running');

    const gatewayPath = this._getGatewayPath();
    this._process = spawn(process.execPath, [gatewayPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const buffer = [];

    this._process.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this._logs.push(line);
        buffer.push(line);
        if (line.includes('HTTP server @')) {
          this.emit('ready');
        }
      }
      if (buffer.length > 0) {
        this.emit('log', [...buffer]);
        buffer.length = 0;
      }
    });

    this._process.stderr.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this._logs.push(line);
        buffer.push(line);
      }
      if (buffer.length > 0) {
        this.emit('log', [...buffer]);
        buffer.length = 0;
      }
    });

    this._process.on('exit', (code) => {
      this._process = null;
      this._setStatus('stopped');

      if (code !== 0) {
        this.emit('crashed', code);
      }

      if (this._shouldRestart) {
        this._restartTimer = setTimeout(() => {
          this.start();
        }, 3000);
      }
    });

    this._process.on('error', (err) => {
      this._process = null;
      this._setStatus('stopped');
      this.emit('crashed', err.code || 1);
    });
  }

  stop() {
    this._shouldRestart = false;

    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    if (!this._process) {
      this._setStatus('stopped');
      return;
    }

    this._process.kill('SIGTERM');
    this._process = null;
    this._setStatus('stopped');
  }

  restart() {
    this.stop();
    setTimeout(() => {
      this.start();
    }, 1000);
  }

  getStatus() {
    return this._status;
  }

  getLogs() {
    return [...this._logs];
  }

  _setStatus(status) {
    this._status = status;
    this.emit('status-change', status);
  }
}

module.exports = GatewayManager;
