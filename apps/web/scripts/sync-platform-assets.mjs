import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const platform = process.argv[2];

if (!platform || !['tizen', 'webos'].includes(platform)) {
  console.error('Usage: node ./scripts/sync-platform-assets.mjs <tizen|webos>');
  process.exit(1);
}

const distDir = path.join(appRoot, 'dist');
const platformDir = path.join(appRoot, 'platforms', platform);
const bundleDir = path.join(platformDir, 'bundle');

await mkdir(bundleDir, { recursive: true });
await cp(distDir, bundleDir, { recursive: true, force: true });

if (platform === 'tizen') {
  const configPath = path.join(platformDir, 'config.xml');
  const config = await readFile(configPath, 'utf8');
  await writeFile(path.join(bundleDir, 'config.xml'), config);
}

if (platform === 'webos') {
  const appInfoPath = path.join(platformDir, 'appinfo.json');
  const appInfo = await readFile(appInfoPath, 'utf8');
  await writeFile(path.join(bundleDir, 'appinfo.json'), appInfo);
}

console.log(`Prepared ${platform} bundle in ${bundleDir}`);
