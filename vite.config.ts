import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'


const productionHeaders = Object.fromEntries(JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers[0].headers.map((header: { key: string; value: string }) => [header.key, header.value]))

export default defineConfig({
  preview: { headers: productionHeaders }, plugins: [react()],
})
