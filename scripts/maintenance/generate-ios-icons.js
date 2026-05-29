/**
 * Generate iOS PWA icons from source icon
 * Run with: node scripts/generate-ios-icons.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const sourceIcon = path.join(projectRoot, 'public/images/logo.png');
const outputDir = path.join(projectRoot, 'public');

const iconSizes = [
  { name: 'icon-192x192.png', size: 192 },
  { name: 'icon-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'apple-touch-icon-180x180.png', size: 180 },
  { name: 'apple-touch-icon-152x152.png', size: 152 },
  { name: 'apple-touch-icon-167x167.png', size: 167 },
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
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png()
        .toFile(outputPath);
      
      console.log(`✅ Generated: ${icon.name} (${icon.size}x${icon.size})`);
    } catch (error) {
      console.error(`❌ Failed to generate ${icon.name}:`, error.message);
      process.exit(1);
    }
  }

  console.log('\n✨ All iOS icons generated successfully!');
}

generateIcons().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

