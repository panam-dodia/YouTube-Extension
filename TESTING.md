# Testing Checklist

## Before Testing

- [ ] Generate icons using `assets/generate-icons.html`
- [ ] Save icons as icon16.png, icon48.png, icon128.png in assets/
- [ ] Verify backend is running at: https://talkbridge-backend-149462569558.us-central1.run.app

## Load Extension

- [ ] Open `chrome://extensions/`
- [ ] Enable Developer mode
- [ ] Click "Load unpacked"
- [ ] Select `YouTube Extension` folder
- [ ] Extension appears without errors

## Test Popup

- [ ] Click TalkBridge icon in toolbar
- [ ] Popup opens and displays correctly
- [ ] All settings visible (language dropdown, checkboxes)
- [ ] Status shows "Not on YouTube"
- [ ] Click "Save Settings" → Shows "Saved!" feedback

## Test on YouTube (No Features Enabled)

- [ ] Go to: https://www.youtube.com/watch?v=q_N-Uv7n3Ms
- [ ] Click extension icon
- [ ] Status shows "Active on YouTube"
- [ ] Keep all features disabled
- [ ] Console shows: "🌉 TalkBridge extension loaded"

## Test Q&A Feature

- [ ] Enable "Enable Q&A Panel" checkbox
- [ ] Click "Save Settings"
- [ ] Refresh YouTube page
- [ ] Q&A panel appears on right side
- [ ] Panel has: header, message area, input field
- [ ] Type question: "What is this video about?"
- [ ] Click Send
- [ ] Wait for response
- [ ] Response appears in chat
- [ ] Try another question
- [ ] Close button (X) hides panel

## Test Video Changes

- [ ] Navigate to different YouTube video
- [ ] Wait 1-2 seconds
- [ ] Console shows: "Video changed: [new-video-id]"
- [ ] Q&A panel reloads for new video
- [ ] Ask question about new video
- [ ] Answer is relevant to new video (not old one)

## Test Settings Persistence

- [ ] Close and reopen popup
- [ ] Previously selected settings are saved
- [ ] Change language to "Spanish"
- [ ] Save and close popup
- [ ] Reopen popup
- [ ] Language still shows "Spanish"

## Test Error Handling

- [ ] Go to YouTube video WITHOUT captions
- [ ] Enable Q&A
- [ ] Should show error notification
- [ ] Check console for error message
- [ ] Try video with captions again
- [ ] Should work correctly

## Test Backend Integration

- [ ] Open browser DevTools (F12)
- [ ] Go to Network tab
- [ ] Enable Q&A on YouTube video
- [ ] Should see POST request to `/api/youtube/sessions`
- [ ] Request should succeed (200 status)
- [ ] Ask a question
- [ ] Should see POST request to `/api/youtube/qa`
- [ ] Response should contain answer

## Known Issues / TODO

- [ ] Translation overlay not implemented yet
- [ ] Voice dubbing not implemented yet
- [ ] Icons are placeholders (need professional design)
- [ ] CORS issues may occur if backend changes

## Performance

- [ ] Extension doesn't slow down YouTube
- [ ] Video playback smooth with Q&A panel open
- [ ] No memory leaks (check Task Manager)
- [ ] Works on multiple tabs simultaneously

## Browser Console Checks

Expected console messages:
```
🌉 TalkBridge extension loaded
Current video: [video-id]
🎯 Loading video features...
✅ Fetched [X] transcript segments
✅ Session created: [session-id]
```

No errors should appear in console during normal operation.