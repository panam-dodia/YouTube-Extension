// Popup script - Trial + Waitlist Model
const API_URL = 'https://talkbridge-backend-1053199504066.us-central1.run.app';
const TRIAL_DAYS = 7;
const DAILY_LIMIT_MINUTES = 15;

// Generate browser fingerprint for device identification
function generateFingerprint() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillText('fingerprint', 2, 2);
  const canvasData = canvas.toDataURL();

  const fingerprint = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    colorDepth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvasFingerprint: canvasData.slice(-50) // Last 50 chars for uniqueness
  };

  // Create a hash-like string from the fingerprint
  const fingerprintString = JSON.stringify(fingerprint);
  let hash = 0;
  for (let i = 0; i < fingerprintString.length; i++) {
    const char = fingerprintString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return {
    fingerprint: fingerprint,
    hash: Math.abs(hash).toString(36)
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const trialDaysEl = document.getElementById('trial-days');
  const usageInfoEl = document.getElementById('usage-info');
  const trialStatusEl = document.getElementById('trial-status');
  const settingsSection = document.getElementById('settings-section');
  const actionsSection = document.getElementById('actions-section');
  const waitlistSection = document.getElementById('waitlist-section');
  const waitlistSuccess = document.getElementById('waitlist-success');
  const emailRegistrationSection = document.getElementById('email-registration-section');
  const trialEmailInput = document.getElementById('trial-email');
  const startTrialBtn = document.getElementById('start-trial-btn');
  const enableTranslation = document.getElementById('enable-translation');
  const targetLanguage = document.getElementById('target-language');
  const enableQA = document.getElementById('enable-qa');
  const saveButton = document.getElementById('save-settings');
  const startTranslationButton = document.getElementById('start-translation');
  const joinWaitlistBtn = document.getElementById('join-waitlist');
  const waitlistEmailInput = document.getElementById('waitlist-email');

  // Generate device fingerprint
  const deviceInfo = generateFingerprint();

  // Initialize trial data
  let trialData = await chrome.storage.local.get({
    trialEmail: null,
    installDate: null,
    dailyUsage: {},
    waitlistEmail: null,
    isRegistered: false,
    deviceFingerprint: null
  });

  // Check if user needs to register email first
  if (!trialData.trialEmail || !trialData.installDate) {
    showEmailRegistration();
    return; // Stop here until email is provided
  }

  // Save device fingerprint if not already saved
  if (!trialData.deviceFingerprint) {
    await chrome.storage.local.set({
      deviceFingerprint: deviceInfo.hash
    });
  }

  // Calculate trial status
  const daysSinceInstall = Math.floor((Date.now() - trialData.installDate) / (1000 * 60 * 60 * 24));
  const daysRemaining = TRIAL_DAYS - daysSinceInstall;
  const isTrialActive = daysRemaining > 0;
  const isRegistered = trialData.isRegistered;

  // Get today's usage from background script (real-time)
  let usageMinutes = 0;
  try {
    const usageResponse = await chrome.runtime.sendMessage({ action: 'getUsage' });
    if (usageResponse && usageResponse.success) {
      usageMinutes = usageResponse.minutes;
    }
  } catch (error) {
    console.error('Failed to get usage:', error);
    // Fallback to storage
    const today = new Date().toISOString().split('T')[0];
    const todayUsage = trialData.dailyUsage[today] || 0;
    usageMinutes = Math.floor(todayUsage / 60);
  }

  // Update UI based on status
  if (isRegistered) {
    // User already registered - show success message
    showWaitlistSuccess(trialData.waitlistEmail);
  } else if (!isTrialActive) {
    // Trial expired - show waitlist registration
    showWaitlist();
  } else {
    // Trial active - show settings
    showSettings(daysRemaining, usageMinutes);

    // Start real-time usage updates
    startUsageUpdates();
  }

  // Check if current tab is YouTube
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.url && tab.url.includes('youtube.com/watch')) {
    statusIndicator.classList.remove('inactive');
    statusIndicator.classList.add('active');
    statusText.textContent = 'Active on YouTube';
  }

  // Load saved settings
  const settings = await chrome.storage.sync.get({
    enableTranslation: false,
    targetLanguage: '',
    enableQA: false
  });

  enableTranslation.checked = settings.enableTranslation;
  targetLanguage.value = settings.targetLanguage;
  enableQA.checked = settings.enableQA;

  // Auto-start tab capture if translation is enabled
  if (settings.enableTranslation && settings.targetLanguage && (isTrialActive || isRegistered)) {
    console.log('🎬 Auto-starting tab capture...');
    await autoStartCapture();
  }

  // Function to automatically start tab capture
  async function autoStartCapture() {
    try {
      // Get the current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        console.error('❌ No active tab found');
        return;
      }

      // Request tab capture stream ID (user gesture is preserved here in popup context)
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Failed to get stream ID:', chrome.runtime.lastError.message);
          return;
        }

        console.log('✅ Got stream ID:', streamId);

        // Get source language from settings
        chrome.storage.sync.get({ sourceLanguage: 'en' }, (result) => {
          // Send streamId to background script to relay to offscreen document
          chrome.runtime.sendMessage({
            action: 'startTabCapture',
            streamId: streamId,
            tabId: tab.id,
            sourceLanguage: result.sourceLanguage
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('❌ Failed to send message:', chrome.runtime.lastError.message);
              return;
            }

            if (response && response.success) {
              console.log('✅ Translation started successfully (auto-start)');

              // Auto-close popup after 1 second
              setTimeout(() => {
                window.close();
              }, 1000);
            } else {
              console.error('❌ Failed to start translation:', response?.error);
            }
          });
        });
      });
    } catch (error) {
      console.error('❌ Error auto-starting translation:', error);
    }
  }

  // Start Translation - handles tab audio capture with user gesture
  startTranslationButton.addEventListener('click', async () => {
    try {
      console.log('🎬 Start Translation button clicked');

      // Check if trial is active
      if (!isTrialActive && !isRegistered) {
        alert('Your trial has expired. Please join the waitlist!');
        return;
      }

      // Get the current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        throw new Error('No active tab found');
      }

      // Visual feedback - starting
      startTranslationButton.textContent = 'Starting...';
      startTranslationButton.disabled = true;

      // Request tab capture stream ID (user gesture is preserved here in popup context)
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Failed to get stream ID:', chrome.runtime.lastError.message);
          startTranslationButton.textContent = 'Start Translation';
          startTranslationButton.disabled = false;
          alert('Failed to start translation: ' + chrome.runtime.lastError.message);
          return;
        }

        console.log('✅ Got stream ID:', streamId);

        // Get source language from settings
        chrome.storage.sync.get({ sourceLanguage: 'en' }, (result) => {
          // Send streamId to background script to relay to offscreen document
          chrome.runtime.sendMessage({
            action: 'startTabCapture',
            streamId: streamId,
            tabId: tab.id,
            sourceLanguage: result.sourceLanguage
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('❌ Failed to send message:', chrome.runtime.lastError.message);
              startTranslationButton.textContent = 'Start Translation';
              startTranslationButton.disabled = false;
              return;
            }

            if (response && response.success) {
              console.log('✅ Translation started successfully');

              // Toggle button visibility
              startTranslationButton.style.display = 'none';
              stopTranslationButton.style.display = 'block';
              stopTranslationButton.textContent = 'Stop Translation';
              stopTranslationButton.disabled = false;

              // Auto-close popup after 1 second
              setTimeout(() => {
                window.close();
              }, 1000);
            } else {
              console.error('❌ Failed to start translation:', response?.error);
              startTranslationButton.textContent = 'Start Translation';
              startTranslationButton.disabled = false;

              // Check if it's a daily limit error
              if (response?.error === 'Daily limit exceeded') {
                alert(`⚠️ ${response.message}\n\nYou've used ${response.minutesUsed || 15} minutes today.`);
              } else {
                alert('Failed to start translation: ' + (response?.error || 'Unknown error'));
              }
            }
          });
        });
      });
    } catch (error) {
      console.error('❌ Error starting translation:', error);
      startTranslationButton.textContent = 'Start Translation';
      startTranslationButton.disabled = false;
      alert('Error: ' + error.message);
    }
  });

  // Stop Translation
  const stopTranslationButton = document.getElementById('stop-translation');
  if (stopTranslationButton) {
    stopTranslationButton.addEventListener('click', async () => {
      try {
        console.log('🛑 Stop Translation button clicked');

        // Visual feedback
        stopTranslationButton.textContent = 'Stopping...';
        stopTranslationButton.disabled = true;

        // Send message to background script to stop tab capture
        chrome.runtime.sendMessage({
          action: 'stopTabCapture'
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Failed to stop:', chrome.runtime.lastError.message);
            stopTranslationButton.textContent = 'Stop Translation';
            stopTranslationButton.disabled = false;
            return;
          }

          if (response && response.success) {
            console.log('✅ Translation stopped successfully');

            // Toggle button visibility
            startTranslationButton.style.display = 'block';
            stopTranslationButton.style.display = 'none';
            startTranslationButton.textContent = 'Start Translation';
            startTranslationButton.style.background = '';
            startTranslationButton.disabled = false;

            // Auto-close popup after 1 second
            setTimeout(() => {
              window.close();
            }, 1000);
          } else {
            console.error('❌ Failed to stop translation:', response?.error);
            stopTranslationButton.textContent = 'Stop Translation';
            stopTranslationButton.disabled = false;
          }
        });
      } catch (error) {
        console.error('❌ Error stopping translation:', error);
        stopTranslationButton.textContent = 'Stop Translation';
        stopTranslationButton.disabled = false;
      }
    });
  }

  // Save settings
  saveButton.addEventListener('click', async () => {
    if (!isTrialActive && !isRegistered) {
      alert('Your trial has expired. Please join the waitlist!');
      return;
    }

    const newSettings = {
      enableTranslation: enableTranslation.checked,
      targetLanguage: targetLanguage.value,
      enableQA: enableQA.checked
    };

    // Validation
    if (enableTranslation.checked && !newSettings.targetLanguage) {
      alert('Please select a target language for translation');
      return;
    }

    await chrome.storage.sync.set(newSettings);

    // Send message to content script to update
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'UPDATE_SETTINGS',
          settings: newSettings
        });
      }
    });

    // Visual feedback
    saveButton.textContent = 'Saved!';
    saveButton.style.background = '#4caf50';
    setTimeout(() => {
      saveButton.textContent = 'Save Settings';
      saveButton.style.background = '';
    }, 1500);
  });

  // Join waitlist
  joinWaitlistBtn.addEventListener('click', async () => {
    const email = waitlistEmailInput.value.trim();

    if (!email || !email.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }

    try {
      joinWaitlistBtn.textContent = 'Joining...';
      joinWaitlistBtn.disabled = true;

      const response = await fetch(`${API_URL}/api/waitlist/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (!response.ok) {
        throw new Error('Failed to register');
      }

      // Save registration locally
      await chrome.storage.local.set({
        waitlistEmail: email,
        isRegistered: true
      });

      // Show success message
      showWaitlistSuccess(email);

    } catch (error) {
      console.error('Waitlist registration error:', error);
      alert('Failed to join waitlist. Please try again.');
      joinWaitlistBtn.textContent = 'Join Waitlist';
      joinWaitlistBtn.disabled = false;
    }
  });

  function showSettings(daysRemaining, usageMinutes) {
    trialStatusEl.style.display = 'block';
    settingsSection.style.display = 'block';
    actionsSection.style.display = 'block';
    waitlistSection.style.display = 'none';
    waitlistSuccess.style.display = 'none';

    trialDaysEl.textContent = `🎉 Free Trial: ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`;
    usageInfoEl.textContent = `📊 Today: ${usageMinutes} / ${DAILY_LIMIT_MINUTES} minutes used`;
  }

  function showWaitlist() {
    trialStatusEl.style.display = 'none';
    settingsSection.style.display = 'none';
    actionsSection.style.display = 'none';
    waitlistSection.style.display = 'block';
    waitlistSuccess.style.display = 'none';
  }

  function showWaitlistSuccess(email) {
    trialStatusEl.style.display = 'none';
    settingsSection.style.display = 'none';
    actionsSection.style.display = 'none';
    waitlistSection.style.display = 'none';
    waitlistSuccess.style.display = 'block';
    emailRegistrationSection.style.display = 'none';
    document.getElementById('registered-email').textContent = email;
  }

  function showEmailRegistration() {
    emailRegistrationSection.style.display = 'block';
    trialStatusEl.style.display = 'none';
    settingsSection.style.display = 'none';
    actionsSection.style.display = 'none';
    waitlistSection.style.display = 'none';
    waitlistSuccess.style.display = 'none';
  }

  // Handle trial email registration
  startTrialBtn.addEventListener('click', async () => {
    const email = trialEmailInput.value.trim();

    if (!email || !email.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }

    try {
      startTrialBtn.textContent = 'Verifying...';
      startTrialBtn.disabled = true;

      // Validate email with backend
      const response = await fetch(`${API_URL}/api/trial/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          deviceFingerprint: deviceInfo.hash,
          deviceInfo: deviceInfo.fingerprint
        })
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          alert('This email or device has already been used for a trial. Each email can only start one trial.');
        } else {
          alert(result.error || 'Failed to start trial. Please try again.');
        }
        startTrialBtn.textContent = 'Start 7-Day Free Trial';
        startTrialBtn.disabled = false;
        return;
      }

      // Save trial data locally
      await chrome.storage.local.set({
        trialEmail: email,
        installDate: Date.now(),
        deviceFingerprint: deviceInfo.hash
      });

      // Reload the popup to show trial UI
      location.reload();

    } catch (error) {
      console.error('Trial start error:', error);
      alert('Failed to start trial. Please check your internet connection.');
      startTrialBtn.textContent = 'Start 7-Day Free Trial';
      startTrialBtn.disabled = false;
    }
  });

  // Real-time usage updates
  let usageUpdateInterval = null;

  function startUsageUpdates() {
    // Update usage display every 2 seconds
    usageUpdateInterval = setInterval(async () => {
      try {
        const usageResponse = await chrome.runtime.sendMessage({ action: 'getUsage' });
        if (usageResponse && usageResponse.success) {
          const minutes = usageResponse.minutes;
          const isOverLimit = minutes >= DAILY_LIMIT_MINUTES;

          // Update the display
          usageInfoEl.textContent = `📊 Today: ${minutes} / ${DAILY_LIMIT_MINUTES} minutes used`;

          // Change color if over limit
          if (isOverLimit) {
            usageInfoEl.style.color = '#f44336';
            usageInfoEl.textContent = `⚠️ Daily limit reached: ${minutes} / ${DAILY_LIMIT_MINUTES} minutes`;
          } else {
            usageInfoEl.style.color = '';
          }
        }
      } catch (error) {
        console.error('Failed to update usage:', error);
      }
    }, 2000);
  }

  // Clean up interval when popup closes
  window.addEventListener('unload', () => {
    if (usageUpdateInterval) {
      clearInterval(usageUpdateInterval);
    }
  });
});
