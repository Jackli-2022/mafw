import { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'ai.mafw.desktop',
  productName: 'MAFW Desktop',
  directories: {
    output: 'release',
  },
  files: [
    'out/**/*',
    '!node_modules/**/*',
  ],
  extraResources: [
    { from: '../gateway', to: 'gateway', filter: ['dist/**/*', 'package.json'] },
    { from: 'node_modules', to: 'node_modules' },
  ],
  win: {
    target: ['nsis'],
    icon: 'resources/icon.ico',
  },
  mac: {
    target: ['dmg', 'zip'],
    icon: 'resources/icon.icns',
    category: 'public.app-category.developer-tools',
  },
  linux: {
    target: ['AppImage', 'deb'],
    icon: 'resources/icons',
    category: 'Development',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
}

export default config
