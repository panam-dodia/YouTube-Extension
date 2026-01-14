// TalkBridge Welcome Page JavaScript

const API_URL = 'https://talkbridge-backend-1053199504066.us-central1.run.app';

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
    canvasFingerprint: canvasData.slice(-50)
  };

  // Create a hash-like string from the fingerprint
  const fingerprintString = JSON.stringify(fingerprint);
  let hash = 0;
  for (let i = 0; i < fingerprintString.length; i++) {
    const char = fingerprintString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return {
    fingerprint: fingerprint,
    hash: Math.abs(hash).toString(36)
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🌉 TalkBridge Welcome Page Loaded');

  const setupSection = document.getElementById('setup-section');
  const successSection = document.getElementById('success-section');
  const trialEmailInput = document.getElementById('trial-email');
  const targetLanguageSelect = document.getElementById('target-language');
  const startTrialBtn = document.getElementById('start-trial-btn');

  // Generate device fingerprint
  const deviceInfo = generateFingerprint();

  // Check if already configured
  const trialData = await chrome.storage.local.get({
    trialEmail: null,
    installDate: null,
    deviceFingerprint: null
  });

  const settings = await chrome.storage.sync.get({
    targetLanguage: ''
  });

  // If already configured, show success
  if (trialData.trialEmail && settings.targetLanguage) {
    showSuccess();
    return;
  }

  // Handle form submission
  startTrialBtn.addEventListener('click', async () => {
    const email = trialEmailInput.value.trim();
    const targetLanguage = targetLanguageSelect.value;

    // Validation
    if (!email || !email.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }

    if (!targetLanguage) {
      alert('Please select a target language');
      return;
    }

    try {
      startTrialBtn.textContent = 'Setting up...';
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
        startTrialBtn.textContent = 'Start Free Trial';
        startTrialBtn.disabled = false;
        return;
      }

      // Save trial data locally
      await chrome.storage.local.set({
        trialEmail: email,
        installDate: Date.now(),
        deviceFingerprint: deviceInfo.hash
      });

      // Save language settings
      await chrome.storage.sync.set({
        targetLanguage: targetLanguage,
        enableTranslation: false, // User will enable it later from popup
        enableQA: false
      });

      console.log('✅ Trial started and language configured');

      // Show success screen
      showSuccess();

    } catch (error) {
      console.error('Trial start error:', error);
      alert('Failed to start trial. Please check your internet connection.');
      startTrialBtn.textContent = 'Start Free Trial';
      startTrialBtn.disabled = false;
    }
  });

  function showSuccess() {
    setupSection.style.display = 'none';
    successSection.style.display = 'block';
  }

  // Add smooth scroll animation for any internal links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // Add entrance animations as elements come into view
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // Observe feature cards and steps for scroll animations
  document.querySelectorAll('.feature-card, .step').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
  });
});
