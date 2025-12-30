# Quick Start Guide

## Step 1: Load the Extension

1. Open Chrome
2. Go to `chrome://extensions/`
3. Toggle **Developer mode** ON (top right)
4. Click **Load unpacked**
5. Select this folder: `YouTube Extension`

## Step 2: Test It

1. Go to any YouTube video with captions:
   - Example: https://www.youtube.com/watch?v=q_N-Uv7n3Ms
2. Click the TalkBridge extension icon (top right of Chrome)
3. Enable **Q&A Panel**
4. Click **Save Settings**
5. Refresh the YouTube page

## Step 3: Use Q&A

A panel will appear on the right side:
- Type: "What is this video about?"
- Get AI-powered answers instantly!

## Step 4: Add Translation (Optional)

1. Click extension icon again
2. Select target language (e.g., Spanish)
3. Enable **Translation**
4. Save and refresh

## Troubleshooting

**Q&A panel not appearing?**
- Make sure you refreshed the page after enabling
- Check that video has captions (CC button on YouTube player)
- Open browser console (F12) and check for errors

**Extension not loading?**
- Make sure all files are in the folder
- Check `chrome://extensions/` for error messages
- Try removing and re-adding the extension

## Need Icons?

The extension needs icon files. You can:
1. Create simple 16x16, 48x48, 128x128 PNG icons
2. Or use placeholder images temporarily
3. Put them in the `assets/` folder as:
   - `icon16.png`
   - `icon48.png`
   - `icon128.png`

For now, the extension will work without icons (you'll see a puzzle piece icon).