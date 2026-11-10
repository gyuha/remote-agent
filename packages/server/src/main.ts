// Process entry point: reads an AppConfig JSON file and runs the app until SIGINT/SIGTERM.
// Usage: node dist/main.js <config.json>. TELEGRAM_BOT_TOKEN overrides telegram.token.
import fs from 'node:fs';
import path from 'node:path';
import { createApp, type AppConfig } from './app.ts';

const configPath = path.resolve(process.argv[2] ?? 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig;
const token = process.env.TELEGRAM_BOT_TOKEN ?? config.telegram.token;
if (!token) throw new Error(`${configPath}: telegram.token or TELEGRAM_BOT_TOKEN is required`);

// Relative paths in the config are resolved against the config file's directory.
const base = path.dirname(configPath);
const app = createApp({
  ...config,
  dataDir: path.resolve(base, config.dataDir),
  folders: config.folders.map((f) => path.resolve(base, f)),
  telegram: {
    ...config.telegram,
    token,
    defaultAgent: config.telegram.defaultAgent && {
      ...config.telegram.defaultAgent,
      folder: path.resolve(base, config.telegram.defaultAgent.folder),
    },
  },
});

await app.start();
console.log(`remote-agent started (config: ${configPath})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.stop().then(() => process.exit(0));
  });
}
