/**
 * Generate iOS PWA icons from source icon
 * Run with: node scripts/generate-ios-icons.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const sourceIcon = path.join(projectRoot, 'public/icon-512x512.png');
const outputDir = path.join(projectRoot, 'public');
const iosIconVersion = '20260529';
const avsYellow = { r: 241, g: 214, b: 74 };

const iconSizes = [
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'apple-touch-icon-180x180.png', size: 180 },
  { name: 'apple-touch-icon-152x152.png', size: 152 },
  { name: 'apple-touch-icon-167x167.png', size: 167 },
];

const cacheBustedAliases = [
  { source: 'icon-192x192.png', name: `icon-avs-yellow-${iosIconVersion}-192x192.png` },
  { source: 'icon-512x512.png', name: `icon-avs-yellow-${iosIconVersion}-512x512.png` },
  { source: 'apple-touch-icon.png', name: `apple-touch-icon-avs-yellow-${iosIconVersion}.png` },
  { source: 'apple-touch-icon-180x180.png', name: `apple-touch-icon-avs-yellow-${iosIconVersion}-180x180.png` },
  { source: 'apple-touch-icon-152x152.png', name: `apple-touch-icon-avs-yellow-${iosIconVersion}-152x152.png` },
  { source: 'apple-touch-icon-167x167.png', name: `apple-touch-icon-avs-yellow-${iosIconVersion}-167x167.png` },
];

async function generateIcons() {
  console.log('🍎 Generating iOS PWA icons...\n');

  if (!fs.existsSync(sourceIcon)) {
    console.error('❌ Source icon not found:', sourceIcon);
    process.exit(1);
  }

  for (const icon of iconSizes) {
    const outputPath = path.join(outputDir, icon.name);
    
    try {
      await sharp(sourceIcon)
        .resize(icon.size, icon.size, {
          fit: 'contain',
          background: { ...avsYellow, alpha: 1 },
        })
        .flatten({ background: avsYellow })
        .png()
        .toFile(outputPath);
      
      console.log(`✅ Generated: ${icon.name} (${icon.size}x${icon.size})`);
    } catch (error) {
      console.error(`❌ Failed to generate ${icon.name}:`, error.message);
      process.exit(1);
    }
  }

  for (const alias of cacheBustedAliases) {
    const sourcePath = path.join(outputDir, alias.source);
    const outputPath = path.join(outputDir, alias.name);

    try {
      await sharp(sourcePath)
        .flatten({ background: avsYellow })
        .png()
        .toFile(outputPath);
      console.log(`✅ Generated cache-busted alias: ${alias.name}`);
    } catch (error) {
      console.error(`❌ Failed to generate ${alias.name}:`, error.message);
      process.exit(1);
    }
  }

  console.log('\n✨ All iOS icons generated successfully!');
}

generateIcons().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

