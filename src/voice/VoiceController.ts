import * as xb from 'xrblocks';
import { soundFX } from '../audio/SoundFX.ts';
import { type Difficulty, type LeaderboardSort, type MenuView, type PuzzleId } from '../types.ts';

export type VoiceAction =
  | { type: 'navigate'; view: MenuView }
  | { type: 'toggle_hud'; show?: boolean }
  | { type: 'select_puzzle'; puzzleId: PuzzleId }
  | { type: 'set_difficulty'; difficulty: Difficulty }
  | { type: 'start_game' }
  | { type: 'start_tutorial' }
  | { type: 'restart_game' }
  | { type: 'toggle_pause'; paused?: boolean }
  | { type: 'hint' }
  | { type: 'recenter' }
  | { type: 'rotate_piece'; axis: 'x' | 'y' | 'z'; dir: 1 | -1 }
  | { type: 'next_piece' }
  | { type: 'snap_piece' }
  | { type: 'sort_leaderboard'; sort: LeaderboardSort }
  | { type: 'create_room' }
  | { type: 'toggle_ready' }
  | { type: 'leave_room' }
  | { type: 'toggle_setting'; setting: 'voiceEnabled' | 'ttsEnabled' | 'sfxEnabled' | 'ghostGuides' | 'snapAssist'; value?: boolean }
  | { type: 'help' };

export interface VoiceStatus {
  listening: boolean;
  supported: boolean;
  lastTranscript: string;
  lastActionLabel: string;
  error: string | null;
}

export function parseVoiceCommand(raw: string): { action: VoiceAction; label: string } | null {
  const t = raw.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
  if (!t) return null;

  // Navigation
  if (/\b(leaderboard|top scores|rankings|high scores|ranks)\b/.test(t)) {
    return { action: { type: 'navigate', view: 'leaderboard' }, label: 'Opened Leaderboard' };
  }
  if (/\b(multiplayer|friends|lobby|coop|co op|race mode|invite)\b/.test(t) && !/\bcreate\b/.test(t)) {
    return { action: { type: 'navigate', view: 'multiplayer' }, label: 'Opened Multiplayer' };
  }
  if (/\b(settings|options|preferences|audio settings|config)\b/.test(t)) {
    return { action: { type: 'navigate', view: 'settings' }, label: 'Opened Settings' };
  }
  if (/\b(tutorial|onboarding|how to play|learn|training)\b/.test(t)) {
    if (/\b(start|begin|launch|open|play)\b/.test(t)) {
      return { action: { type: 'start_tutorial' }, label: 'Starting Tutorial' };
    }
    return { action: { type: 'navigate', view: 'tutorial' }, label: 'Opened Tutorial' };
  }
  if (/\b(puzzles|puzzle select|home|main menu|open menu|show menu)\b/.test(t)) {
    return { action: { type: 'navigate', view: 'play' }, label: 'Opened Puzzle Menu' };
  }
  if (/\b(hide menu|close menu|hide hud|minimize|cinema mode)\b/.test(t)) {
    return { action: { type: 'toggle_hud', show: false }, label: 'Minimized HUD' };
  }
  if (/\b(show hud|expand menu|open dock)\b/.test(t)) {
    return { action: { type: 'toggle_hud', show: true }, label: 'Expanded HUD' };
  }

  // Puzzle selection
  if (/\b(chrono|cube|soma)\b/.test(t)) {
    return { action: { type: 'select_puzzle', puzzleId: 'chrono-cube' }, label: 'Selected Chrono Cube' };
  }
  if (/\b(aether|clockwork|gear|gears|watch)\b/.test(t)) {
    return { action: { type: 'select_puzzle', puzzleId: 'aether-clockwork' }, label: 'Selected Aether Clockwork' };
  }
  if (/\b(orbital|sanctum|gimbal|crystal)\b/.test(t)) {
    return { action: { type: 'select_puzzle', puzzleId: 'orbital-sanctum' }, label: 'Selected Orbital Sanctum' };
  }

  // Difficulty
  if (/\b(easy|casual|relaxed)\b/.test(t)) {
    return { action: { type: 'set_difficulty', difficulty: 'easy' }, label: 'Difficulty: Easy' };
  }
  if (/\b(normal|standard|medium)\b/.test(t)) {
    return { action: { type: 'set_difficulty', difficulty: 'normal' }, label: 'Difficulty: Normal' };
  }
  if (/\b(hard|expert|pro|competitive)\b/.test(t)) {
    return { action: { type: 'set_difficulty', difficulty: 'hard' }, label: 'Difficulty: Hard' };
  }

  // Match controls
  if (/\b(start game|start puzzle|start match|begin|play now|go)\b/.test(t)) {
    return { action: { type: 'start_game' }, label: 'Starting Match' };
  }
  if (/\b(restart|reset puzzle|reset board|try again)\b/.test(t)) {
    return { action: { type: 'restart_game' }, label: 'Restarting Puzzle' };
  }
  if (/\b(pause|freeze|stop timer)\b/.test(t)) {
    return { action: { type: 'toggle_pause', paused: true }, label: 'Paused' };
  }
  if (/\b(resume|continue|unpause)\b/.test(t)) {
    return { action: { type: 'toggle_pause', paused: false }, label: 'Resumed' };
  }
  if (/\b(hint|clue|show me|where does)\b/.test(t)) {
    return { action: { type: 'hint' }, label: 'Activated Hint' };
  }
  if (/\b(recenter|place on table|calibrate|move board|center board)\b/.test(t)) {
    return { action: { type: 'recenter' }, label: 'Recentered Workbench' };
  }

  // Hands-free piece manipulation
  if (/\b(rotate left|turn left|counterclockwise|left)\b/.test(t)) {
    return { action: { type: 'rotate_piece', axis: 'y', dir: 1 }, label: 'Rotated Left' };
  }
  if (/\b(rotate right|turn right|clockwise|right)\b/.test(t)) {
    return { action: { type: 'rotate_piece', axis: 'y', dir: -1 }, label: 'Rotated Right' };
  }
  if (/\b(rotate up|tilt up|pitch up|up)\b/.test(t)) {
    return { action: { type: 'rotate_piece', axis: 'x', dir: 1 }, label: 'Tilted Up' };
  }
  if (/\b(rotate down|tilt down|pitch down|down)\b/.test(t)) {
    return { action: { type: 'rotate_piece', axis: 'x', dir: -1 }, label: 'Tilted Down' };
  }
  if (/\b(flip|roll|turn over)\b/.test(t)) {
    return { action: { type: 'rotate_piece', axis: 'z', dir: 1 }, label: 'Rolled Piece' };
  }
  if (/\b(next piece|select next|switch piece)\b/.test(t)) {
    return { action: { type: 'next_piece' }, label: 'Selected Next Piece' };
  }
  if (/\b(snap|drop|assemble|lock piece)\b/.test(t)) {
    return { action: { type: 'snap_piece' }, label: 'Snap Check' };
  }

  // Leaderboard sorting
  if (/\b(sort by time|best time|fastest)\b/.test(t)) {
    return { action: { type: 'sort_leaderboard', sort: 'bestTimeMs' }, label: 'Sorted by Best Time' };
  }
  if (/\b(sort by accuracy|accuracy|most accurate)\b/.test(t)) {
    return { action: { type: 'sort_leaderboard', sort: 'accuracy' }, label: 'Sorted by Accuracy' };
  }
  if (/\b(sort by score|top score|best score)\b/.test(t)) {
    return { action: { type: 'sort_leaderboard', sort: 'score' }, label: 'Sorted by Score' };
  }

  // Multiplayer & Settings
  if (/\b(create room|host room|new room|host game)\b/.test(t)) {
    return { action: { type: 'create_room' }, label: 'Creating Room' };
  }
  if (/\b(ready up|im ready|i am ready|ready)\b/.test(t)) {
    return { action: { type: 'toggle_ready' }, label: 'Toggled Ready' };
  }
  if (/\b(leave room|exit room)\b/.test(t)) {
    return { action: { type: 'leave_room' }, label: 'Left Room' };
  }
  if (/\b(mute|silence|sound off)\b/.test(t)) {
    return { action: { type: 'toggle_setting', setting: 'sfxEnabled', value: false }, label: 'Muted SFX' };
  }
  if (/\b(unmute|sound on|toggle sound)\b/.test(t)) {
    return { action: { type: 'toggle_setting', setting: 'sfxEnabled' }, label: 'Toggled Sound' };
  }
  if (/\b(toggle guides|ghost guides|guides)\b/.test(t)) {
    return { action: { type: 'toggle_setting', setting: 'ghostGuides' }, label: 'Toggled Ghost Guides' };
  }
  if (/\b(voice feedback|read aloud|speech|toggle tts)\b/.test(t)) {
    return { action: { type: 'toggle_setting', setting: 'ttsEnabled' }, label: 'Toggled Voice Feedback' };
  }
  if (/\b(help|commands|what can i say)\b/.test(t)) {
    return { action: { type: 'help' }, label: 'Voice Commands Help' };
  }

  return null;
}

export class VoiceController {
  private recognition: SpeechRecognition | null = null;
  private wantListening = false;
  private restartTimer = 0;
  private startSequence = 0;
  private onAction: (action: VoiceAction, label: string, raw: string) => void;
  private onStatus: (status: VoiceStatus) => void;
  private lastTranscript = '';
  private lastActionLabel = 'Ready';
  private lastError: string | null = null;
  public ttsEnabled = false;

  constructor(
    onAction: (action: VoiceAction, label: string, raw: string) => void,
    onStatus: (status: VoiceStatus) => void
  ) {
    this.onAction = onAction;
    this.onStatus = onStatus;
  }

  private getSpeechCtor(): (new () => SpeechRecognition) | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognition;
      webkitSpeechRecognition?: new () => SpeechRecognition;
    };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  isSupported(): boolean {
    return Boolean(this.getSpeechCtor());
  }

  private emitStatus(): void {
    this.onStatus({
      listening: this.wantListening,
      supported: this.isSupported(),
      lastTranscript: this.lastTranscript,
      lastActionLabel: this.lastActionLabel,
      error: this.lastError,
    });
  }

  private async hasAudioInput(): Promise<boolean> {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return true;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices || devices.length === 0) return true;
      return devices.some((d) => d.kind === 'audioinput');
    } catch {
      return true;
    }
  }

  start(): void {
    const Ctor = this.getSpeechCtor();
    if (!Ctor) {
      this.wantListening = false;
      this.lastError = 'Speech API unavailable; use quick command bar.';
      this.emitStatus();
      return;
    }

    this.wantListening = true;
    this.lastError = null;
    const seq = ++this.startSequence;
    this.emitStatus();

    void this.beginRecognition(Ctor, seq);
  }

  private async beginRecognition(Ctor: new () => SpeechRecognition, seq: number): Promise<void> {
    const hasMic = await this.hasAudioInput();
    if (!this.wantListening || seq !== this.startSequence) return;

    if (!hasMic) {
      this.wantListening = false;
      this.lastError = 'No microphone detected; use command bar.';
      this.emitStatus();
      return;
    }

    if (!this.recognition) {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (event: SpeechRecognitionEvent) => {
        if (!this.wantListening) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            this.processTranscript(text);
          } else {
            this.lastTranscript = text;
            this.emitStatus();
          }
        }
      };
      rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
        const err = ev.error;
        if (err === 'no-speech' || err === 'aborted') {
          return;
        }
        this.wantListening = false;
        window.clearTimeout(this.restartTimer);
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          this.lastError = 'Microphone permission denied; use command bar.';
        } else if (err === 'audio-capture') {
          this.lastError = 'Microphone unavailable; use command bar.';
        } else if (err === 'network') {
          this.lastError = 'Voice service offline; use command bar.';
        } else {
          this.lastError = `Voice unavailable (${err}); use command bar.`;
        }
        this.emitStatus();
      };
      rec.onend = () => {
        if (this.wantListening && !this.lastError) {
          window.clearTimeout(this.restartTimer);
          this.restartTimer = window.setTimeout(() => {
            if (this.wantListening && !this.lastError && this.recognition === rec) {
              try {
                rec.start();
              } catch {
                // ignore busy start
              }
            }
          }, 350);
        } else {
          this.emitStatus();
        }
      };
      this.recognition = rec;
    }

    try {
      this.recognition.start();
    } catch {
      // already started
    }
    this.emitStatus();
  }

  stop(): void {
    this.wantListening = false;
    this.startSequence++;
    window.clearTimeout(this.restartTimer);
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
    this.emitStatus();
  }

  toggle(): boolean {
    if (this.wantListening) {
      this.stop();
    } else {
      this.start();
    }
    return this.wantListening;
  }

  processTranscript(raw: string): boolean {
    this.lastTranscript = raw.trim();
    const parsed = parseVoiceCommand(raw);
    if (!parsed) {
      this.lastActionLabel = `Heard: "${this.lastTranscript}"`;
      this.emitStatus();
      return false;
    }
    this.lastActionLabel = parsed.label;
    soundFX.playVoiceChirp();
    this.onAction(parsed.action, parsed.label, this.lastTranscript);
    if (this.ttsEnabled) {
      this.speak(parsed.label);
    }
    this.emitStatus();
    return true;
  }

  speak(text: string): void {
    if (!this.ttsEnabled) return;
    try {
      if (xb.core?.sound?.speechSynthesizer) {
        void xb.core.sound.speechSynthesizer.speak(text);
        return;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.08;
        window.speechSynthesis.speak(utter);
      }
    } catch {
      // ignore TTS failure
    }
  }

  dispose(): void {
    this.stop();
    this.recognition = null;
  }
}
