import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'
import tailwind from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['electron']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    plugins: [solid()],
    css: {
      postcss: {
        plugins: [tailwind, autoprefixer]
      }
    },
    build: {
      outDir: 'out/renderer'
    },
    resolve: {
      alias: {
        '@': 'src/renderer'
      }
    }
  }
})
