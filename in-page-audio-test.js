// In-Page Audio Capture Test
// Run this in the console of ANY video site (YouTube, Netflix, Prime, etc.)
// This will test if Web Audio API can capture audio from the video on that page

(function() {
  console.clear();
  console.log('🔬 Starting In-Page Audio Capture Test...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Find video element
  const video = document.querySelector('video');
  if (!video) {
    console.error('❌ No <video> element found on this page!');
    console.log('Make sure you are on a page with a video player.');
    return;
  }

  console.log('✅ Found video element:', video);
  console.log(`   URL: ${window.location.href}`);
  console.log(`   Video src: ${video.src || video.currentSrc || 'MSE/blob URL'}`);
  console.log(`   Dimensions: ${video.videoWidth}x${video.videoHeight}`);
  console.log(`   Duration: ${video.duration?.toFixed(2)}s`);
  console.log(`   Paused: ${video.paused}`);
  console.log(`   Muted: ${video.muted}`);
  console.log(`   Volume: ${video.volume}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check for DRM
  console.log('🔍 Checking for DRM protection...');
  const hasDRM = video.mediaKeys !== null;
  console.log(`   Media Keys: ${video.mediaKeys ? '⚠️ YES - DRM active!' : '✅ None (no DRM)'}`);

  if (video.webkitAudioDecodedByteCount !== undefined) {
    console.log(`   Audio decoded: ${video.webkitAudioDecodedByteCount} bytes`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test Web Audio API
  console.log('🎵 Testing Web Audio API capture...');

  let audioContext, source, analyser, destination;

  try {
    // Create audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log(`✅ AudioContext created (state: ${audioContext.state})`);

    // Resume if suspended
    if (audioContext.state === 'suspended') {
      audioContext.resume();
      console.log('   Resumed AudioContext');
    }

    // Create media element source
    try {
      source = audioContext.createMediaElementSource(video);
      console.log('✅ MediaElementSource created successfully');
    } catch (err) {
      console.error('❌ Failed to create MediaElementSource:', err.message);
      console.error('   This usually means:');
      console.error('   - Video element is already connected to another audio context');
      console.error('   - Try refreshing the page and running this test first');
      throw err;
    }

    // Create analyser
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    // Create destination for recording
    destination = audioContext.createMediaStreamDestination();

    // Connect: video -> analyser -> destination + speakers
    source.connect(analyser);
    analyser.connect(destination);
    analyser.connect(audioContext.destination); // Still play through speakers

    console.log('✅ Audio graph connected: video → analyser → destination + speakers');
    console.log(`   Stream active: ${destination.stream.active}`);
    console.log(`   Audio tracks: ${destination.stream.getAudioTracks().length}`);

    if (destination.stream.getAudioTracks().length > 0) {
      const track = destination.stream.getAudioTracks()[0];
      console.log(`   Track: readyState=${track.readyState}, enabled=${track.enabled}, muted=${track.muted}`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Monitor audio level
    console.log('📊 Monitoring audio level for 10 seconds...');
    console.log('   (Make sure video is PLAYING and has VOLUME)');

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let checkCount = 0;
    let maxLevel = 0;
    let avgLevel = 0;

    const monitorInterval = setInterval(() => {
      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS (audio level)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = (rms * 100).toFixed(2);

      maxLevel = Math.max(maxLevel, parseFloat(level));
      avgLevel += parseFloat(level);
      checkCount++;

      const icon = rms > 0.01 ? '✅' : '❌';
      console.log(`   [${checkCount}/20] Audio level: ${level}% ${icon} ${rms > 0.01 ? 'AUDIO DETECTED' : 'silence'}`);

      if (checkCount >= 20) {
        clearInterval(monitorInterval);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📈 RESULTS:');
        console.log(`   Max level: ${maxLevel.toFixed(2)}%`);
        console.log(`   Avg level: ${(avgLevel / checkCount).toFixed(2)}%`);

        if (maxLevel > 1) {
          console.log('✅ SUCCESS: Web Audio API can capture audio from this video!');
        } else if (hasDRM) {
          console.log('❌ FAILED: DRM is blocking Web Audio API access');
          console.log('   Solution: Use Desktop Capture instead of Web Audio API');
        } else {
          console.log('⚠️ UNCLEAR: No DRM detected but audio level is 0');
          console.log('   Possible reasons:');
          console.log('   - Video has no audio track');
          console.log('   - Video is not playing');
          console.log('   - Browser/system audio issue');
        }

        // Test MediaRecorder
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎙️ Testing MediaRecorder...');
        try {
          const recorder = new MediaRecorder(destination.stream, {
            mimeType: 'audio/webm;codecs=opus'
          });

          recorder.ondataavailable = (event) => {
            const sizeKB = (event.data.size / 1024).toFixed(2);
            console.log(`   📦 Chunk received: ${sizeKB} KB ${sizeKB > 5 ? '✅' : '⚠️'}`);
          };

          recorder.start();
          console.log('✅ MediaRecorder started (will record for 5 seconds)');

          setTimeout(() => {
            recorder.stop();
            console.log('🛑 MediaRecorder stopped');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('');
            console.log('🎯 FINAL VERDICT:');
            console.log('');
            if (maxLevel > 1) {
              console.log('✅ Web Audio API works on this site/video!');
              console.log('   Your extension should be able to capture audio.');
            } else if (hasDRM) {
              console.log('❌ DRM is blocking audio capture');
              console.log('   You need to use Desktop Capture API instead.');
            } else {
              console.log('⚠️ No audio detected, but unclear why');
              console.log('   Check: Is video playing? Does it have audio?');
            }
            console.log('');
            console.log('Test complete! You can now refresh the page.');
          }, 5000);

        } catch (err) {
          console.error('❌ MediaRecorder failed:', err.message);
        }
      }
    }, 500); // Check every 500ms

    // Make sure video is playing
    if (video.paused) {
      console.log('⚠️ Video is paused - attempting to play...');
      video.play().then(() => {
        console.log('✅ Video playing');
      }).catch(err => {
        console.error('❌ Failed to play video:', err.message);
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

})();
