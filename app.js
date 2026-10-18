/**
 * ==========================================================================
 * 포모도로 타이머 & 앰비언트 백색소음 시스템 (app.js)
 * ==========================================================================
 */

// 1. 상수 및 설정
const DEFAULT_FOCUS_MINS = 25;
const DEFAULT_BREAK_MINS = 5;
const CIRCUMFERENCE = 2 * Math.PI * 135; // 약 848.23px

// 2. 상태 관리
const state = {
  mode: 'focus', // 'focus' | 'break'
  focusMinutes: DEFAULT_FOCUS_MINS,
  breakMinutes: DEFAULT_BREAK_MINS,
  totalTime: DEFAULT_FOCUS_MINS * 60,
  timeLeft: DEFAULT_FOCUS_MINS * 60,
  isRunning: false,
  timerInterval: null,
  activeSound: null, // null | 'ocean' | 'rain' | 'birds'
  volume: 0.6,
  isMuted: false,
  completedSessions: 0,
};

// 3. DOM 요소 캐싱
const elements = {
  body: document.body,
  timeDisplay: document.getElementById('time-display'),
  progressCircle: document.getElementById('progress-circle'),
  modeBadge: document.getElementById('mode-badge'),
  subLabel: document.getElementById('sub-label'),
  currentSessionNum: document.getElementById('current-session-num'),
  btnStart: document.getElementById('btn-start'),
  btnPause: document.getElementById('btn-pause'),
  btnReset: document.getElementById('btn-reset'),
  btnSkip: document.getElementById('btn-skip'),
  // 시간 설정 DOM
  btnFocusMinus: document.getElementById('btn-focus-minus'),
  btnFocusPlus: document.getElementById('btn-focus-plus'),
  focusMinsDisplay: document.getElementById('focus-mins-display'),
  btnBreakMinus: document.getElementById('btn-break-minus'),
  btnBreakPlus: document.getElementById('btn-break-plus'),
  breakMinsDisplay: document.getElementById('break-mins-display'),
  presetChips: document.querySelectorAll('.preset-chip'),
  // 사운드 & 볼륨 DOM
  soundBtns: document.querySelectorAll('.sound-btn'),
  soundStatusBadge: document.getElementById('sound-status-badge'),
  volumeSlider: document.getElementById('volume-slider'),
  volumeText: document.getElementById('volume-text'),
  btnMute: document.getElementById('btn-mute'),
  iconVolHigh: document.getElementById('icon-volume-high'),
  iconVolMuted: document.getElementById('icon-volume-muted'),
  completedSessionsCount: document.getElementById('completed-sessions-count'),
  btnResetSessions: document.getElementById('btn-reset-sessions'),
  tomatoBadges: document.getElementById('tomato-badges'),
  toast: document.getElementById('toast'),
  toastTitle: document.getElementById('toast-title'),
  toastDesc: document.getElementById('toast-desc'),
  toastIcon: document.getElementById('toast-icon')
};

// ==========================================================================
// 4. 오디오 엔진 (Web Audio API 기반 100% 무중단 사운드 합성 & 알람)
// ==========================================================================
class AmbientAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.currentSourceNodes = [];
    this.birdTimer = null;
  }

  // 브라우저 AudioContext 초기화 (사용자 인터랙션 시 자동 활성화)
  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(state.isMuted ? 0 : state.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 볼륨 변경
  setVolume(val) {
    if (!this.ctx || !this.masterGain) return;
    const effectiveVol = state.isMuted ? 0 : val;
    this.masterGain.gain.setTargetAtTime(effectiveVol, this.ctx.currentTime, 0.05);
  }

  // 현재 재생 중인 사운드 정지
  stopCurrent() {
    if (this.birdTimer) {
      clearInterval(this.birdTimer);
      this.birdTimer = null;
    }
    this.currentSourceNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        node.disconnect();
      } catch (e) {
        // 무시
      }
    });
    this.currentSourceNodes = [];
  }

  // 1) 🍃 바람 소리 (Gentle Wind / Breeze)
  playWind() {
    this.initContext();
    this.stopCurrent();

    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    // 핑크/브라운 노이즈 베이스 (부드러운 공기 흐름)
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.2;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // 바람결 스윕을 위한 로우패스 필터 (부드러운 음색)
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(360, this.ctx.currentTime);

    // 바람이 살랑살랑 불어오는 리듬 LFO (0.09Hz)
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.09, this.ctx.currentTime);

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(220, this.ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const windGain = this.ctx.createGain();
    windGain.gain.setValueAtTime(0.85, this.ctx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(windGain);
    windGain.connect(this.masterGain);

    whiteNoise.start();
    lfo.start();

    this.currentSourceNodes.push(whiteNoise, lfo, filter, windGain, lfoGain);
  }

  // 하위 호환 별칭
  playOcean() {
    this.playWind();
  }

  // 2) 🌧️ 비 소리 (Rainfall)
  playRain() {
    this.initContext();
    this.stopCurrent();

    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    // 화이트 + 핑크 노이즈 결합
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      output[i] = (b0 + b1 + b2 + white * 0.5362) * 0.12;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    // 빗소리 밴드패스/하이패스 필터
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, this.ctx.currentTime);
    filter.Q.setValueAtTime(0.7, this.ctx.currentTime);

    const rainGain = this.ctx.createGain();
    rainGain.gain.setValueAtTime(1.1, this.ctx.currentTime);

    noise.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(this.masterGain);

    noise.start();
    this.currentSourceNodes.push(noise, filter, rainGain);
  }

  // 3) 🐦 숲속 새 소리 (Forest Birds)
  playBirds() {
    this.initContext();
    this.stopCurrent();

    // 잔잔한 숲속 앰비언스 베이스 배경음 (미세한 바람소리)
    const bufferSize = this.ctx.sampleRate * 2;
    const windBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = windBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.02;
    }
    const windNode = this.ctx.createBufferSource();
    windNode.buffer = windBuffer;
    windNode.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(450, this.ctx.currentTime);
    windNode.connect(windFilter);
    windFilter.connect(this.masterGain);
    windNode.start();
    this.currentSourceNodes.push(windNode, windFilter);

    // 주기적으로 지저귀는 새소리 합성 함수 (FM 짹짹)
    const chirp = () => {
      if (!this.ctx || state.activeSound !== 'birds') return;
      
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const baseFreq = 2600 + Math.random() * 800; // 2600Hz ~ 3400Hz
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq + 1200, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(baseFreq + 200, now + 0.16);
      osc.frequency.exponentialRampToValueAtTime(baseFreq + 900, now + 0.22);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.4);
    };

    // 첫 울림 후 랜덤 간격(1.5초~4초)으로 지저귐
    chirp();
    this.birdTimer = setInterval(() => {
      chirp();
      if (Math.random() > 0.4) {
        setTimeout(chirp, 300); // 2단 지저귐
      }
    }, 2400);
  }

  // 4) 🔔 세션 완료 시 맑은 크리스털 알림음 (Clear Chime Alarm)
  playAlarmChime() {
    this.initContext();
    const now = this.ctx.currentTime;
    
    // 4단 화음 아르페지오 (C6, E6, G6, C7 벨 사운드)
    const notes = [1046.50, 1318.51, 1567.98, 2093.00];

    notes.forEach((freq, idx) => {
      const noteTime = now + (idx * 0.15);
      const osc = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      // 벨 특유의 빠른 어택과 긴 릴리즈
      noteGain.gain.setValueAtTime(0, noteTime);
      noteGain.gain.linearRampToValueAtTime(0.45, noteTime + 0.02);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 1.6);

      osc.connect(noteGain);
      noteGain.connect(this.ctx.destination); // 알람음은 음소거/슬라이더 영향과 무관하게 선명히 재생

      osc.start(noteTime);
      osc.stop(noteTime + 1.8);
    });
  }
}

const soundEngine = new AmbientAudioEngine();

// ==========================================================================
// 5. 타이머 코어 로직
// ==========================================================================

// 숫자 2자리 포맷팅 (mm:ss)
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// 화면 렌더링 (디스플레이, 프로그레스 링, 브라우저 탭 타이틀)
function updateUI() {
  const timeStr = formatTime(state.timeLeft);
  elements.timeDisplay.textContent = timeStr;

  // 원형 프로그레스 링 진행률 계산 (남은 시간에 비례하여 채워짐)
  const progressRatio = state.timeLeft / state.totalTime;
  const offset = CIRCUMFERENCE * (1 - progressRatio);
  elements.progressCircle.style.strokeDashoffset = offset;

  // 브라우저 탭 타이틀(Document Title) 실시간 연동
  const modeText = state.mode === 'focus' ? '집중 시간' : '휴식 시간';
  if (state.isRunning) {
    document.title = `[${timeStr}] ${modeText} | 포모도로 타이머`;
  } else {
    document.title = `[일시정지] ${timeStr} - ${modeText} | 포모도로 타이머`;
  }
}

// 모드 전환 (Focus ↔ Break)
function switchMode(newMode) {
  state.mode = newMode;
  state.totalTime = newMode === 'focus' ? state.focusMinutes * 60 : state.breakMinutes * 60;
  state.timeLeft = state.totalTime;

  if (newMode === 'focus') {
    elements.body.className = 'mode-focus';
    elements.modeBadge.textContent = '집중 시간 (Focus)';
    elements.subLabel.textContent = '집중하세요';
  } else {
    elements.body.className = 'mode-break';
    elements.modeBadge.textContent = '휴식 시간 (Break)';
    elements.subLabel.textContent = '편안히 쉬세요';
  }

  updateUI();
}

// ==========================================================================
// 5-1. 시간 조정 (Custom Time Adjustment)
// ==========================================================================
function updateTimeDisplays() {
  if (elements.focusMinsDisplay) {
    elements.focusMinsDisplay.textContent = state.focusMinutes;
  }
  if (elements.breakMinsDisplay) {
    elements.breakMinsDisplay.textContent = state.breakMinutes;
  }

  // 칩 active 상태 동기화
  elements.presetChips.forEach(chip => {
    const type = chip.dataset.type;
    const mins = parseInt(chip.dataset.mins, 10);
    const isCurrent = (type === 'focus' && state.focusMinutes === mins) ||
                      (type === 'break' && state.breakMinutes === mins);
    chip.classList.toggle('active', isCurrent);
  });
}

function saveTimeSettings() {
  localStorage.setItem('pomodoro_focus_mins', state.focusMinutes);
  localStorage.setItem('pomodoro_break_mins', state.breakMinutes);
}

function loadSavedTimes() {
  const savedFocus = localStorage.getItem('pomodoro_focus_mins');
  const savedBreak = localStorage.getItem('pomodoro_break_mins');

  if (savedFocus) state.focusMinutes = Math.max(1, Math.min(120, parseInt(savedFocus, 10)));
  if (savedBreak) state.breakMinutes = Math.max(1, Math.min(60, parseInt(savedBreak, 10)));

  state.totalTime = state.mode === 'focus' ? state.focusMinutes * 60 : state.breakMinutes * 60;
  state.timeLeft = state.totalTime;
  updateTimeDisplays();
}

// +/- 스텝퍼를 통한 1분 단위 증감
function adjustMinutes(type, delta) {
  if (type === 'focus') {
    const newFocus = Math.max(1, Math.min(120, state.focusMinutes + delta));
    if (newFocus === state.focusMinutes) return;
    state.focusMinutes = newFocus;
  } else {
    const newBreak = Math.max(1, Math.min(60, state.breakMinutes + delta));
    if (newBreak === state.breakMinutes) return;
    state.breakMinutes = newBreak;
  }

  saveTimeSettings();
  updateTimeDisplays();

  // 실행 중이 아닐 때 현재 모드 시간 즉시 반영
  if (!state.isRunning) {
    state.totalTime = state.mode === 'focus' ? state.focusMinutes * 60 : state.breakMinutes * 60;
    state.timeLeft = state.totalTime;
    updateUI();
  }

  showToast('⏱️ 시간 설정 완료', `${type === 'focus' ? '집중' : '휴식'} 시간이 ${type === 'focus' ? state.focusMinutes : state.breakMinutes}분으로 설정되었습니다.`);
}

// 퀵 프리셋 칩 클릭
function setPresetMinutes(type, mins) {
  if (type === 'focus') {
    state.focusMinutes = mins;
  } else {
    state.breakMinutes = mins;
  }

  saveTimeSettings();
  updateTimeDisplays();

  if (!state.isRunning) {
    state.totalTime = state.mode === 'focus' ? state.focusMinutes * 60 : state.breakMinutes * 60;
    state.timeLeft = state.totalTime;
    updateUI();
  }

  showToast('⏱️ 프리셋 적용', `${type === 'focus' ? '집중' : '휴식'} 시간이 ${mins}분으로 변경되었습니다.`);
}

// 1초 타이머 틱(Tick)
function timerTick() {
  if (state.timeLeft > 0) {
    state.timeLeft--;
    updateUI();
  } else {
    // 0초 도달: 세션 완료 이벤트 발생!
    handleSessionComplete();
  }
}

// 음성 안내 (TTS: Text-to-Speech)
function speakVoice(text) {
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel(); // 이전 음성 중복 방지
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      // 맑은 차임 알람음이 울린 후 자연스럽게 음성이 나오도록 약간의 지연 후 발화
      setTimeout(() => {
        window.speechSynthesis.speak(utterance);
      }, 650);
    } catch (e) {
      console.warn('음성 안내 재생 실패:', e);
    }
  }
}

// 세션 종료 처리 (자동 전환 & 알림음 & 음성 안내 & 카운터)
function handleSessionComplete() {
  pauseTimer();
  soundEngine.playAlarmChime();

  if (state.mode === 'focus') {
    // 1) 집중 세션 완료
    state.completedSessions++;
    saveCompletedSessions();
    renderSessionStats();

    // 사용자가 설정한 집중 시간과 휴식 시간에 맞춘 동적 안내 문구 및 음성
    const focusDoneMsg = `${state.focusMinutes}분 동안 고생하셨습니다. ${state.breakMinutes}분 휴식을 시작합니다.`;
    showToast('🍅 집중 시간 완료!', focusDoneMsg);
    speakVoice(focusDoneMsg);

    // 2) 휴식 모드로 자동 전환 및 즉시 타이머 시작
    setTimeout(() => {
      switchMode('break');
      startTimer();
    }, 1200);

  } else {
    // 3) 휴식 세션 완료
    const breakDoneMsg = `${state.breakMinutes}분 휴식이 종료되었습니다. 다시 ${state.focusMinutes}분 집중을 시작합니다.`;
    showToast('🌿 휴식 시간 종료!', breakDoneMsg);
    speakVoice(breakDoneMsg);

    // 4) 집중 모드로 자동 복귀 및 즉시 타이머 시작
    setTimeout(() => {
      switchMode('focus');
      startTimer();
    }, 1200);
  }
}

// 타이머 시작
function startTimer() {
  if (state.isRunning) return;
  
  soundEngine.initContext();
  state.isRunning = true;
  elements.btnStart.disabled = true;
  elements.btnPause.disabled = false;

  updateUI();
  state.timerInterval = setInterval(timerTick, 1000);
}

// 타이머 일시정지
function pauseTimer() {
  if (!state.isRunning) return;

  state.isRunning = false;
  clearInterval(state.timerInterval);
  state.timerInterval = null;

  elements.btnStart.disabled = false;
  elements.btnPause.disabled = true;
  updateUI();
}

// 타이머 초기화 (Reset)
function resetTimer() {
  pauseTimer();
  state.timeLeft = state.totalTime;
  updateUI();
  showToast('🔄 초기화 완료', `${state.mode === 'focus' ? '집중' : '휴식'} 시간이 리셋되었습니다.`);
}

// 다음 세션으로 수동 건너뛰기
function skipToNextMode() {
  pauseTimer();
  const nextMode = state.mode === 'focus' ? 'break' : 'focus';
  switchMode(nextMode);
  showToast('⏩ 모드 전환', `${nextMode === 'focus' ? '집중' : '휴식'} 모드로 전환되었습니다.`);
}

// ==========================================================================
// 6. 백색소음 제어
// ==========================================================================

function handleSoundSelect(soundType) {
  soundEngine.initContext();

  // 이미 재생 중인 사운드를 다시 클릭하면 정지 (토글)
  if (state.activeSound === soundType) {
    soundEngine.stopCurrent();
    state.activeSound = null;
    elements.soundBtns.forEach(btn => btn.classList.remove('active'));
    elements.soundStatusBadge.textContent = '꺼짐';
    elements.soundStatusBadge.classList.remove('playing');
    return;
  }

  // 새로운 사운드 재생
  state.activeSound = soundType;
  elements.soundBtns.forEach(btn => {
    const isActive = btn.dataset.sound === soundType;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive);
  });

  const soundLabels = { 
    wind: '바람 소리', 
    ocean: '바람 소리', 
    rain: '비 소리', 
    birds: '숲속 새소리' 
  };
  elements.soundStatusBadge.textContent = `${soundLabels[soundType] || '사운드'} 재생 중`;
  elements.soundStatusBadge.classList.add('playing');

  if (soundType === 'wind' || soundType === 'ocean') soundEngine.playWind();
  if (soundType === 'rain') soundEngine.playRain();
  if (soundType === 'birds') soundEngine.playBirds();
}

// 볼륨 슬라이더 핸들러
function handleVolumeChange(e) {
  const val = Number(e.target.value);
  state.volume = val / 100;
  elements.volumeText.textContent = `${val}%`;
  
  if (state.isMuted && val > 0) {
    toggleMute(false);
  }
  soundEngine.setVolume(state.volume);
}

// 음소거 토글
function toggleMute(forceState) {
  state.isMuted = typeof forceState === 'boolean' ? forceState : !state.isMuted;
  
  if (state.isMuted) {
    elements.iconVolHigh.classList.add('hidden');
    elements.iconVolMuted.classList.remove('hidden');
    elements.volumeText.textContent = '0%';
    soundEngine.setVolume(0);
  } else {
    elements.iconVolHigh.classList.remove('hidden');
    elements.iconVolMuted.classList.add('hidden');
    elements.volumeText.textContent = `${elements.volumeSlider.value}%`;
    soundEngine.setVolume(state.volume);
  }
}

// ==========================================================================
// 7. 세션 카운터 및 로컬 스토리지 연동
// ==========================================================================

function loadCompletedSessions() {
  const stored = localStorage.getItem('pomodoro_completed_sessions');
  state.completedSessions = stored ? parseInt(stored, 10) : 0;
  renderSessionStats();
}

function saveCompletedSessions() {
  localStorage.setItem('pomodoro_completed_sessions', state.completedSessions);
}

function renderSessionStats() {
  elements.completedSessionsCount.textContent = state.completedSessions;
  elements.currentSessionNum.textContent = state.completedSessions + 1;

  // 토마토 뱃지 렌더링
  elements.tomatoBadges.innerHTML = '';
  if (state.completedSessions === 0) {
    elements.tomatoBadges.innerHTML = '<span class="empty-badge-hint">집중 세션을 완료하면 🍅 토마토 스탬프가 채워집니다.</span>';
    return;
  }

  // 완료한 만큼 토마토 아이콘 생성
  for (let i = 0; i < state.completedSessions; i++) {
    const tomatoSpan = document.createElement('span');
    tomatoSpan.className = 'tomato-badge-item';
    tomatoSpan.textContent = '🍅';
    tomatoSpan.title = `집중 세션 #${i + 1} 달성`;
    elements.tomatoBadges.appendChild(tomatoSpan);
  }
}

function resetCompletedSessions() {
  if (state.completedSessions === 0) return;
  if (confirm('완료한 집중 세션 기록을 모두 초기화할까요?')) {
    state.completedSessions = 0;
    saveCompletedSessions();
    renderSessionStats();
    showToast('🧹 기록 초기화', '세션 기록이 성공적으로 초기화되었습니다.');
  }
}

// ==========================================================================
// 8. 토스트 알림창
// ==========================================================================
let toastTimer = null;
function showToast(title, desc) {
  elements.toastTitle.textContent = title;
  elements.toastDesc.textContent = desc;
  elements.toast.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 4000);
}

// ==========================================================================
// 9. 이벤트 리스너 등록 & 초기화
// ==========================================================================
function initEvents() {
  // 컨트롤 버튼
  elements.btnStart.addEventListener('click', startTimer);
  elements.btnPause.addEventListener('click', pauseTimer);
  elements.btnReset.addEventListener('click', resetTimer);
  elements.btnSkip.addEventListener('click', skipToNextMode);

  // 시간 설정 스텝퍼 버튼 (+/-)
  if (elements.btnFocusMinus) {
    elements.btnFocusMinus.addEventListener('click', () => adjustMinutes('focus', -1));
  }
  if (elements.btnFocusPlus) {
    elements.btnFocusPlus.addEventListener('click', () => adjustMinutes('focus', 1));
  }
  if (elements.btnBreakMinus) {
    elements.btnBreakMinus.addEventListener('click', () => adjustMinutes('break', -1));
  }
  if (elements.btnBreakPlus) {
    elements.btnBreakPlus.addEventListener('click', () => adjustMinutes('break', 1));
  }

  // 퀵 프리셋 칩 클릭
  elements.presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.dataset.type;
      const mins = parseInt(chip.dataset.mins, 10);
      setPresetMinutes(type, mins);
    });
  });

  // 백색소음 버튼들
  elements.soundBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      handleSoundSelect(btn.dataset.sound);
    });
  });

  // 볼륨 & 음소거
  elements.volumeSlider.addEventListener('input', handleVolumeChange);
  elements.btnMute.addEventListener('click', () => toggleMute());

  // 세션 카운터 초기화
  elements.btnResetSessions.addEventListener('click', resetCompletedSessions);
}

// 애플리케이션 시작
function init() {
  initEvents();
  loadSavedTimes();
  loadCompletedSessions();
  updateUI();
}

window.addEventListener('DOMContentLoaded', init);
