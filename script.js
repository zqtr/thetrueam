import * as THREE from 'https://esm.sh/three';

// --- Pixel Snow Background Setup ---
const vertexShader = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const fragmentShader = `
precision mediump float;

uniform float uTime;
uniform vec2 uResolution;
uniform float uFlakeSize;
uniform float uMinFlakeSize;
uniform float uPixelResolution;
uniform float uSpeed;
uniform float uDepthFade;
uniform float uFarPlane;
uniform vec3 uColor;
uniform float uBrightness;
uniform float uGamma;
uniform float uDensity;
uniform float uVariant;
uniform float uDirection;

// Precomputed constants
#define PI 3.14159265
#define PI_OVER_6 0.5235988
#define PI_OVER_3 1.0471976
#define INV_SQRT3 0.57735027
#define M1 1597334677U
#define M2 3812015801U
#define M3 3299493293U
#define F0 2.3283064e-10

// Optimized hash - inline multiplication
#define hash(n) (n * (n ^ (n >> 15)))
#define coord3(p) (uvec3(p).x * M1 ^ uvec3(p).y * M2 ^ uvec3(p).z * M3)

// Precomputed camera basis vectors (normalized vec3(1,1,1), vec3(1,0,-1))
const vec3 camK = vec3(0.57735027, 0.57735027, 0.57735027);
const vec3 camI = vec3(0.70710678, 0.0, -0.70710678);
const vec3 camJ = vec3(-0.40824829, 0.81649658, -0.40824829);

// Precomputed branch direction
const vec2 b1d = vec2(0.574, 0.819);

vec3 hash3(uint n) {
  uvec3 hashed = hash(n) * uvec3(1U, 511U, 262143U);
  return vec3(hashed) * F0;
}

float snowflakeDist(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  a = abs(mod(a + PI_OVER_6, PI_OVER_3) - PI_OVER_6);
  vec2 q = r * vec2(cos(a), sin(a));
  float dMain = max(abs(q.y), max(-q.x, q.x - 1.0));
  float b1t = clamp(dot(q - vec2(0.4, 0.0), b1d), 0.0, 0.4);
  float dB1 = length(q - vec2(0.4, 0.0) - b1t * b1d);
  float b2t = clamp(dot(q - vec2(0.7, 0.0), b1d), 0.0, 0.25);
  float dB2 = length(q - vec2(0.7, 0.0) - b2t * b1d);
  return min(dMain, min(dB1, dB2)) * 10.0;
}

void main() {
  // Precompute reciprocals to avoid division
  float invPixelRes = 1.0 / uPixelResolution;
  float pixelSize = max(1.0, floor(0.5 + uResolution.x * invPixelRes));
  float invPixelSize = 1.0 / pixelSize;
  
  vec2 fragCoord = floor(gl_FragCoord.xy * invPixelSize);
  vec2 res = uResolution * invPixelSize;
  float invResX = 1.0 / res.x;

  vec3 ray = normalize(vec3((fragCoord - res * 0.5) * invResX, 1.0));
  ray = ray.x * camI + ray.y * camJ + ray.z * camK;

  // Precompute time-based values
  float timeSpeed = uTime * uSpeed;
  float windX = cos(uDirection) * 0.4;
  float windY = sin(uDirection) * 0.4;
  vec3 camPos = (windX * camI + windY * camJ + 0.1 * camK) * timeSpeed;
  vec3 pos = camPos;

  // Precompute ray reciprocal for strides
  vec3 absRay = max(abs(ray), vec3(0.001));
  vec3 strides = 1.0 / absRay;
  vec3 raySign = step(ray, vec3(0.0));
  vec3 phase = fract(pos) * strides;
  phase = mix(strides - phase, phase, raySign);

  // Precompute for intersection test
  float rayDotCamK = dot(ray, camK);
  float invRayDotCamK = 1.0 / rayDotCamK;
  float invDepthFade = 1.0 / uDepthFade;
  float halfInvResX = 0.5 * invResX;
  vec3 timeAnim = timeSpeed * 0.1 * vec3(7.0, 8.0, 5.0);

  float t = 0.0;
  for (int i = 0; i < 128; i++) {
    if (t >= uFarPlane) break;
    
    vec3 fpos = floor(pos);
    uint cellCoord = coord3(fpos);
    float cellHash = hash3(cellCoord).x;

    if (cellHash < uDensity) {
      vec3 h = hash3(cellCoord);
      
      // Optimized flake position calculation
      vec3 sinArg1 = fpos.yzx * 0.073;
      vec3 sinArg2 = fpos.zxy * 0.27;
      vec3 flakePos = 0.5 - 0.5 * cos(4.0 * sin(sinArg1) + 4.0 * sin(sinArg2) + 2.0 * h + timeAnim);
      flakePos = flakePos * 0.8 + 0.1 + fpos;

      float toIntersection = dot(flakePos - pos, camK) * invRayDotCamK;
      
      if (toIntersection > 0.0) {
        vec3 testPos = pos + ray * toIntersection - flakePos;
        float testX = dot(testPos, camI);
        float testY = dot(testPos, camJ);
        vec2 testUV = abs(vec2(testX, testY));
        
        float depth = dot(flakePos - camPos, camK);
        float flakeSize = max(uFlakeSize, uMinFlakeSize * depth * halfInvResX);
        
        // Avoid branching with step functions where possible
        float dist;
        if (uVariant < 0.5) {
          dist = max(testUV.x, testUV.y);
        } else if (uVariant < 1.5) {
          dist = length(testUV);
        } else {
          float invFlakeSize = 1.0 / flakeSize;
          dist = snowflakeDist(vec2(testX, testY) * invFlakeSize) * flakeSize;
        }

        if (dist < flakeSize) {
          float flakeSizeRatio = uFlakeSize / flakeSize;
          float intensity = exp2(-(t + toIntersection) * invDepthFade) *
                           min(1.0, flakeSizeRatio * flakeSizeRatio) * uBrightness;
          gl_FragColor = vec4(uColor * pow(vec3(intensity), vec3(uGamma)), 1.0);
          return;
        }
      }
    }

    float nextStep = min(min(phase.x, phase.y), phase.z);
    vec3 sel = step(phase, vec3(nextStep));
    phase = phase - nextStep + strides * sel;
    t += nextStep;
    pos = mix(pos + ray * nextStep, floor(pos + ray * nextStep + 0.5), sel);
  }

  gl_FragColor = vec4(0.0);
}
`;

function initPixelSnow() {
    const container = document.querySelector('.bg-animation');
    if (!container) return;

    // Configuration based on user's React props
    const config = {
        color: '#ffffff',
        flakeSize: 0.01,
        minFlakeSize: 1.25,
        pixelResolution: 4000, // Increased to remove pixelation effect
        speed: 1.25,
        depthFade: 8,
        farPlane: 20,
        brightness: 1,
        gamma: 0.4545,
        density: 0.3,
        variant: 'snowflake',
        direction: 125
    };

    const variantValue = config.variant === 'round' ? 1.0 : config.variant === 'snowflake' ? 2.0 : 0.0;
    const threeColor = new THREE.Color(config.color);
    const colorVector = new THREE.Vector3(threeColor.r, threeColor.g, threeColor.b);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({
        antialias: true, // Enabled antialiasing for smoother edges
        alpha: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        depth: false
    });

    // Use a higher max pixel ratio to ensure it looks sharp on high-res displays (like Retina/4K)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2(container.offsetWidth * Math.min(window.devicePixelRatio, 3), container.offsetHeight * Math.min(window.devicePixelRatio, 3)) }, // Pass actual pixel resolution to shader
            uFlakeSize: { value: config.flakeSize },
            uMinFlakeSize: { value: config.minFlakeSize },
            uPixelResolution: { value: config.pixelResolution * Math.min(window.devicePixelRatio, 3) }, // Scale pixel resolution
            uSpeed: { value: config.speed },
            uDepthFade: { value: config.depthFade },
            uFarPlane: { value: config.farPlane },
            uColor: { value: colorVector },
            uBrightness: { value: config.brightness },
            uGamma: { value: config.gamma },
            uDensity: { value: config.density },
            uVariant: { value: variantValue },
            uDirection: { value: (config.direction * Math.PI) / 180 }
        },
        transparent: true
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));

    let resizeTimeout;
    const handleResize = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const w = container.offsetWidth;
            const h = container.offsetHeight;
            const dpr = Math.min(window.devicePixelRatio, 3);
            renderer.setSize(w, h);
            material.uniforms.uResolution.value.set(w * dpr, h * dpr);
        }, 100);
    };
    window.addEventListener('resize', handleResize);

    const startTime = performance.now();
    const animate = () => {
        requestAnimationFrame(animate);
        material.uniforms.uTime.value = (performance.now() - startTime) * 0.001;
        renderer.render(scene, camera);
    };
    animate();
}

// --- UI, Audio, and Interactive Logic ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize the WebGL background
    initPixelSnow();

    const enterScreen = document.getElementById('enter-screen');
    const enterBtn = document.getElementById('enter-btn');
    const mainContainer = document.getElementById('main-container');
    
    // Audio Elements
    const bgMusic = document.getElementById('bg-music');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playPauseIcon = playPauseBtn.querySelector('i');
    const seekBar = document.getElementById('seek-bar');
    const volumeBar = document.getElementById('volume-bar');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');
    const muteIcon = document.getElementById('mute-icon');

    let isPlaying = false;

    // Format time helper (e.g., 65 -> "1:05")
    const formatTime = (time) => {
        if (isNaN(time)) return "0:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    // Initialize audio duration
    bgMusic.addEventListener('loadedmetadata', () => {
        seekBar.max = bgMusic.duration;
        totalTimeEl.textContent = formatTime(bgMusic.duration);
    });

    // Update progress bar as audio plays
    bgMusic.addEventListener('timeupdate', () => {
        seekBar.value = bgMusic.currentTime;
        currentTimeEl.textContent = formatTime(bgMusic.currentTime);
    });

    // Seek audio when progress bar is changed
    seekBar.addEventListener('input', () => {
        bgMusic.currentTime = seekBar.value;
    });

    // Update volume
    volumeBar.addEventListener('input', () => {
        bgMusic.volume = volumeBar.value / 100;
        updateVolumeIcon(bgMusic.volume);
    });

    // Mute/Unmute
    muteIcon.addEventListener('click', () => {
        if (bgMusic.volume > 0) {
            bgMusic.dataset.lastVolume = bgMusic.volume;
            bgMusic.volume = 0;
            volumeBar.value = 0;
        } else {
            bgMusic.volume = bgMusic.dataset.lastVolume || 0.5;
            volumeBar.value = bgMusic.volume * 100;
        }
        updateVolumeIcon(bgMusic.volume);
    });

    const updateVolumeIcon = (vol) => {
        muteIcon.className = '';
        if (vol === 0) {
            muteIcon.className = 'fa-solid fa-volume-xmark';
        } else if (vol < 0.5) {
            muteIcon.className = 'fa-solid fa-volume-low';
        } else {
            muteIcon.className = 'fa-solid fa-volume-high';
        }
    };

    // --- Target Cursor Logic ---
    const cursor = document.getElementById('target-cursor');
    const dot = cursor.querySelector('.target-cursor-dot');
    const corners = Array.from(cursor.querySelectorAll('.target-cursor-corner'));
    const interactables = document.querySelectorAll('a, button, input[type="range"]');
    
    // Configuration
    const spinDuration = 2.2;
    const hoverDuration = 0.35;
    const parallaxOn = true;
    const borderWidth = 3;
    const cornerSize = 12;

    let isActive = false;
    let activeTarget = null;
    let activeStrength = { current: 0 };
    let targetCornerPositions = null;
    let spinTl = null;
    let resumeTimeout = null;

    // Initialize GSAP
    gsap.set(cursor, {
        xPercent: -50,
        yPercent: -50,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
    });

    // We need to set the initial positions of the corners so they aren't stacked in the center
    const initCorners = () => {
        const positions = [
            { x: -cornerSize * 1.5, y: -cornerSize * 1.5 },
            { x: cornerSize * 0.5, y: -cornerSize * 1.5 },
            { x: cornerSize * 0.5, y: cornerSize * 0.5 },
            { x: -cornerSize * 1.5, y: cornerSize * 0.5 }
        ];
        corners.forEach((corner, index) => {
            gsap.set(corner, { x: positions[index].x, y: positions[index].y });
        });
    };
    initCorners();

    const createSpinTimeline = () => {
        if (spinTl) spinTl.kill();
        spinTl = gsap.timeline({ repeat: -1 })
            .to(cursor, { rotation: '+=360', duration: spinDuration, ease: 'none' });
    };
    createSpinTimeline();

    // Move cursor
    window.addEventListener('mousemove', (e) => {
        // Move the wrapper instantly without GSAP easing to ensure it stays exactly under the mouse
        gsap.set(cursor, {
            x: e.clientX,
            y: e.clientY
        });
    });

    // Click effects
    window.addEventListener('mousedown', () => {
        gsap.to(dot, { scale: 0.7, duration: 0.3 });
        gsap.to(cursor, { scale: 0.9, duration: 0.2 });
    });
    window.addEventListener('mouseup', () => {
        gsap.to(dot, { scale: 1, duration: 0.3 });
        gsap.to(cursor, { scale: 1, duration: 0.2 });
    });

    // Ticker function for smooth corner tracking
    const tickerFn = () => {
        if (!targetCornerPositions || !isActive) return;

        const strength = activeStrength.current;
        if (strength === 0) return;

        const cursorX = gsap.getProperty(cursor, 'x');
        const cursorY = gsap.getProperty(cursor, 'y');

        corners.forEach((corner, i) => {
            const currentX = gsap.getProperty(corner, 'x');
            const currentY = gsap.getProperty(corner, 'y');

            const targetX = targetCornerPositions[i].x - cursorX;
            const targetY = targetCornerPositions[i].y - cursorY;

            const finalX = currentX + (targetX - currentX) * strength;
            const finalY = currentY + (targetY - currentY) * strength;

            const duration = strength >= 0.99 ? (parallaxOn ? 0.2 : 0) : 0.05;

            gsap.to(corner, {
                x: finalX,
                y: finalY,
                duration: duration,
                ease: duration === 0 ? 'none' : 'power1.out',
                overwrite: 'auto'
            });
        });
    };

    // Hover logic
    interactables.forEach(target => {
        target.addEventListener('mouseenter', () => {
            if (activeTarget === target) return;
            if (resumeTimeout) {
                clearTimeout(resumeTimeout);
                resumeTimeout = null;
            }

            activeTarget = target;
            corners.forEach(corner => gsap.killTweensOf(corner));
            
            gsap.killTweensOf(cursor, 'rotation');
            if (spinTl) spinTl.pause();
            gsap.set(cursor, { rotation: 0 });

            const rect = target.getBoundingClientRect();
            const cursorX = gsap.getProperty(cursor, 'x');
            const cursorY = gsap.getProperty(cursor, 'y');

            targetCornerPositions = [
                { x: rect.left - borderWidth, y: rect.top - borderWidth },
                { x: rect.right + borderWidth - cornerSize, y: rect.top - borderWidth },
                { x: rect.right + borderWidth - cornerSize, y: rect.bottom + borderWidth - cornerSize },
                { x: rect.left - borderWidth, y: rect.bottom + borderWidth - cornerSize }
            ];

            isActive = true;
            gsap.ticker.add(tickerFn);

            gsap.to(activeStrength, {
                current: 1,
                duration: hoverDuration,
                ease: 'power2.out'
            });

            corners.forEach((corner, i) => {
                gsap.to(corner, {
                    x: targetCornerPositions[i].x - cursorX,
                    y: targetCornerPositions[i].y - cursorY,
                    duration: 0.2,
                    ease: 'power2.out'
                });
            });
        });

        target.addEventListener('mouseleave', () => {
            gsap.ticker.remove(tickerFn);
            isActive = false;
            targetCornerPositions = null;
            gsap.set(activeStrength, { current: 0, overwrite: true });
            activeTarget = null;

            gsap.killTweensOf(corners);
            
            const positions = [
                { x: -cornerSize * 1.5, y: -cornerSize * 1.5 },
                { x: cornerSize * 0.5, y: -cornerSize * 1.5 },
                { x: cornerSize * 0.5, y: cornerSize * 0.5 },
                { x: -cornerSize * 1.5, y: cornerSize * 0.5 }
            ];

            const tl = gsap.timeline();
            corners.forEach((corner, index) => {
                tl.to(corner, {
                    x: positions[index].x,
                    y: positions[index].y,
                    duration: 0.3,
                    ease: 'power3.out'
                }, 0);
            });

            resumeTimeout = setTimeout(() => {
                if (!activeTarget) {
                    const currentRotation = gsap.getProperty(cursor, 'rotation');
                    const normalizedRotation = currentRotation % 360;
                    if (spinTl) spinTl.kill();
                    spinTl = gsap.timeline({ repeat: -1 })
                        .to(cursor, { rotation: '+=360', duration: spinDuration, ease: 'none' });
                    
                    gsap.to(cursor, {
                        rotation: normalizedRotation + 360,
                        duration: spinDuration * (1 - normalizedRotation / 360),
                        ease: 'none',
                        onComplete: () => {
                            if (spinTl) spinTl.restart();
                        }
                    });
                }
                resumeTimeout = null;
            }, 50);
        });
    });

    // --- 3D Tilt & Glare Logic ---
    const glare = document.querySelector('.glare');

    mainContainer.addEventListener('mousemove', (e) => {
        const rect = mainContainer.getBoundingClientRect();
        const x = e.clientX - rect.left; // x position within the element
        const y = e.clientY - rect.top;  // y position within the element
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        // Calculate rotation (max 10 degrees)
        const rotateX = ((y - centerY) / centerY) * -10;
        const rotateY = ((x - centerX) / centerX) * 10;
        
        mainContainer.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(0)`;
        
        // Move glare
        glare.style.left = `${x}px`;
        glare.style.top = `${y}px`;
    });

    mainContainer.addEventListener('mouseleave', () => {
        // Reset tilt
        mainContainer.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)`;
        // Glare opacity is handled by CSS hover state
    });

    // Handle Enter Button Click
    enterBtn.addEventListener('click', () => {
        // Manually reset cursor if it was hovering the enter button
        if (activeTarget === enterBtn) {
            const leaveEvent = new MouseEvent('mouseleave');
            enterBtn.dispatchEvent(leaveEvent);
        }

        // Fade out enter screen
        enterScreen.style.opacity = '0';
        
        // Wait for fade out, then hide and show main container
        setTimeout(() => {
            enterScreen.style.display = 'none';
            mainContainer.classList.remove('hidden');
            
            // Start playing music
            bgMusic.volume = volumeBar.value / 100;
            bgMusic.play().then(() => {
                isPlaying = true;
                playPauseIcon.className = 'fa-solid fa-pause';
            }).catch(error => {
                console.log("Audio play failed (might be missing file or browser policy):", error);
                // If it fails, update icon to muted
                isPlaying = false;
                playPauseIcon.className = 'fa-solid fa-play';
            });
        }, 500); // 500ms matches the CSS transition duration
    });

    // Handle Play/Pause Toggle
    playPauseBtn.addEventListener('click', () => {
        if (isPlaying) {
            bgMusic.pause();
            playPauseIcon.className = 'fa-solid fa-play';
        } else {
            bgMusic.play();
            playPauseIcon.className = 'fa-solid fa-pause';
        }
        isPlaying = !isPlaying;
    });
});
