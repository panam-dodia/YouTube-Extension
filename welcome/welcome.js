// TalkBridge Welcome Page JavaScript

document.addEventListener('DOMContentLoaded', () => {
  console.log('🌉 TalkBridge Welcome Page Loaded');

  // Track when user clicks the YouTube button
  const youtubeBtn = document.getElementById('goto-youtube');
  if (youtubeBtn) {
    youtubeBtn.addEventListener('click', () => {
      console.log('User clicked "Open YouTube" button');
      // Analytics or tracking can be added here if needed
    });
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
