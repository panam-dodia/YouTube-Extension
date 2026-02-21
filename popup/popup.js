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
  const languageSelectionSection = document.getElementById('language-selection-section');
  const trialEmailInput = document.getElementById('trial-email');
  const startTrialBtn = document.getElementById('start-trial-btn');
  const languageSelect = document.getElementById('language-select');
  const saveLanguageBtn = document.getElementById('save-language-btn');
  const enableTranslation = document.getElementById('enable-translation');
  const targetLanguage = document.getElementById('target-language');
  const enableQA = document.getElementById('enable-qa');
  const saveButton = document.getElementById('save-settings');
  const joinWaitlistBtn = document.getElementById('join-waitlist');
  const waitlistEmailInput = document.getElementById('waitlist-email');

  // Real-time usage updates interval
  let usageUpdateInterval = null;

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

  console.log('🔍 Trial data:', trialData);

  // Attach trial start button handler early (before any return)
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

  // Check if user needs to register email first
  if (!trialData.trialEmail || !trialData.installDate) {
    console.log('❌ Email not registered, showing email registration');
    showEmailRegistration();
    return; // Stop here until email is provided
  }

  // Check if target language is configured
  const languageCheck = await chrome.storage.sync.get({
    targetLanguage: ''
  });

  console.log('🌍 Language check:', languageCheck);

  if (!languageCheck.targetLanguage) {
    console.log('❌ Language not configured, showing language selection');
    showLanguageSelection();
    return; // Stop here until language is selected
  }

  console.log('✅ Email and language configured, showing main UI');

  // Save device fingerprint if not already saved
  if (!trialData.deviceFingerprint) {
    await chrome.storage.local.set({
      deviceFingerprint: deviceInfo.hash
    });
  }

  // Calculate trial status — validate against backend first (handles developer emails)
  let daysRemaining, isTrialActive, isRegistered;
  try {
    const fingerprint = trialData.deviceFingerprint || deviceInfo.hash;
    const validateRes = await fetch(`${API_URL}/api/trial/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trialData.trialEmail, deviceFingerprint: fingerprint })
    });
    if (validateRes.ok) {
      const validateData = await validateRes.json();
      daysRemaining = validateData.daysRemaining;
      isTrialActive = validateData.isActive;
      isRegistered = isTrialActive ? false : trialData.isRegistered; // dev/active users skip waitlist screen
      console.log('✅ Backend trial validate:', validateData);
    } else {
      throw new Error('Validate failed');
    }
  } catch (e) {
    // Fallback to local calculation if backend unreachable
    const daysSinceInstall = Math.floor((Date.now() - trialData.installDate) / (1000 * 60 * 60 * 24));
    daysRemaining = TRIAL_DAYS - daysSinceInstall;
    isTrialActive = daysRemaining > 0;
    isRegistered = trialData.isRegistered;
    console.warn('⚠️ Using local trial calculation:', { daysRemaining, isTrialActive });
  }

  // Get today's usage from background script (real-time)
  let usageMinutes = 0;
  try {
    const usageResponse = await chrome.runtime.sendMessage({ action: 'getUsage' });
    if (usageResponse && usageResponse.success) {
      usageMinutes = usageResponse.minutes;
      console.log('📊 Usage from background:', usageResponse);
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

  // Track if settings have been saved
  let settingsSaved = true;

  // Function to mark settings as unsaved (changed)
  function markSettingsChanged() {
    if (settingsSaved) {
      settingsSaved = false;
      saveButton.textContent = 'Save Settings';
      saveButton.style.background = '';
    }
  }

  // Function to mark settings as saved
  function markSettingsSaved() {
    settingsSaved = true;
    saveButton.textContent = 'Saved ✓';
    saveButton.style.background = '#4caf50';
  }

  // Listen for changes to settings
  enableTranslation.addEventListener('change', markSettingsChanged);
  targetLanguage.addEventListener('change', markSettingsChanged);
  enableQA.addEventListener('change', markSettingsChanged);

  // Initially mark as saved since we just loaded the settings
  markSettingsSaved();

  // Save settings
  saveButton.addEventListener('click', async () => {
    console.log('💾 Save button clicked');
    console.log('Trial active:', isTrialActive, 'Registered:', isRegistered);

    if (!isTrialActive && !isRegistered) {
      alert('Your trial has expired. Please join the waitlist!');
      return;
    }

    const newSettings = {
      enableTranslation: enableTranslation.checked,
      targetLanguage: targetLanguage.value,
      enableQA: enableQA.checked
    };

    console.log('💾 Saving settings:', newSettings);

    // Validation
    if (enableTranslation.checked && !newSettings.targetLanguage) {
      alert('Please select a target language for translation');
      return;
    }

    try {
      await chrome.storage.sync.set(newSettings);
      console.log('✅ Settings saved successfully');

      // Send message to content script to update
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'UPDATE_SETTINGS',
            settings: newSettings
          });
        }
      });

      // Mark as saved
      markSettingsSaved();
    } catch (error) {
      console.error('❌ Failed to save settings:', error);
      alert('Failed to save settings. Please try again.');
    }
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
    emailRegistrationSection.style.display = 'none';

    trialDaysEl.textContent = `🎉 Free Trial: ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`;
    usageInfoEl.textContent = `📊 Today: ${usageMinutes} / ${DAILY_LIMIT_MINUTES} minutes used`;
  }

  function showWaitlist() {
    trialStatusEl.style.display = 'none';
    settingsSection.style.display = 'none';
    actionsSection.style.display = 'none';
    waitlistSection.style.display = 'block';
    waitlistSuccess.style.display = 'none';
    emailRegistrationSection.style.display = 'none';
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
    languageSelectionSection.style.display = 'none';
    trialStatusEl.style.display = 'none';
    settingsSection.style.display = 'none';
    actionsSection.style.display = 'none';
    waitlistSection.style.display = 'none';
    waitlistSuccess.style.display = 'none';
  }

  function showLanguageSelection() {
    emailRegistrationSection.style.display = 'none';
    languageSelectionSection.style.display = 'block';
    trialStatusEl.style.display = 'none';
    settingsSection.style.display = 'none';
    actionsSection.style.display = 'none';
    waitlistSection.style.display = 'none';
    waitlistSuccess.style.display = 'none';
  }

  // Handle language selection
  saveLanguageBtn.addEventListener('click', async () => {
    const selectedLanguage = languageSelect.value;

    if (!selectedLanguage) {
      alert('Please select a language');
      return;
    }

    try {
      saveLanguageBtn.textContent = 'Saving...';
      saveLanguageBtn.disabled = true;

      // Save language setting
      await chrome.storage.sync.set({
        targetLanguage: selectedLanguage,
        enableTranslation: false, // User will enable it later
        enableQA: false
      });

      console.log('✅ Language configured:', selectedLanguage);

      // Reload popup to show main UI
      location.reload();

    } catch (error) {
      console.error('Language save error:', error);
      alert('Failed to save language. Please try again.');
      saveLanguageBtn.textContent = 'Continue';
      saveLanguageBtn.disabled = false;
    }
  });

  // Handle trial email registration (handler attached earlier, before return)

  function startUsageUpdates() {
    console.log('🔄 Starting usage updates...');

    // Update usage display every 2 seconds
    usageUpdateInterval = setInterval(async () => {
      try {
        const usageResponse = await chrome.runtime.sendMessage({ action: 'getUsage' });
        if (usageResponse && usageResponse.success) {
          const minutes = usageResponse.minutes;
          const isOverLimit = minutes >= DAILY_LIMIT_MINUTES;

          console.log(`📊 Updated usage: ${minutes} minutes`);

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
