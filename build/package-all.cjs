const { execSync } = require('child_process');
const path = require('path');
const v = require(path.join(__dirname, '..', 'package.json')).version;

try {
  // Package all
  execSync('pnpm package:chrome && pnpm package:firefox && pnpm package:source', { stdio: 'inherit' });
  
  // Rename with versions
  execSync(`cd dist && mv -f ai-chat-exporter-chrome.zip ai-chat-exporter-v${v}-chrome.zip`, { stdio: 'inherit' });
  execSync(`cd dist && mv -f ai-chat-exporter-firefox.zip ai-chat-exporter-v${v}-firefox.zip`, { stdio: 'inherit' });
  execSync(`cd dist && mv -f ai-chat-exporter-source.zip ai-chat-exporter-v${v}-source.zip`, { stdio: 'inherit' });

  console.log(`\n✅ Packaged version ${v}:`);
  console.log(`   - ai-chat-exporter-v${v}-chrome.zip`);
  console.log(`   - ai-chat-exporter-v${v}-firefox.zip`);
  console.log(`   - ai-chat-exporter-v${v}-source.zip`);
} catch (error) {
  console.error('Packaging failed:', error.message);
  process.exit(1);
}
