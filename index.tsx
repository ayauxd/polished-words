/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */

import {GoogleGenAI, Type} from '@google/genai';
import {marked} from 'marked';

const MODEL_NAME = 'gemini-2.5-flash';

interface TranscriptionResult {
  raw_transcript: string;
  polished_note: string;
}

class VoiceNotesApp {
  private genAI: GoogleGenAI;
  private mediaRecorder: MediaRecorder | null = null;
  
  // UI Elements
  private recordButton: HTMLButtonElement;
  private rawPanel: HTMLDivElement;
  private polishedPanel: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private copyButton: HTMLButtonElement;
  private editorTitle: HTMLDivElement;
  
  // Controls & Visualizer
  private controlsContainer: HTMLDivElement;
  private statusPill: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement;
  private liveTimer: HTMLDivElement;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  
  // Topic Selector
  private topicToggleButton: HTMLButtonElement;
  private topicMenu: HTMLDivElement;
  private topicButtons: NodeListOf<HTMLButtonElement>;
  private currentTopic: string = 'AI News';

  // Loading & Trivia
  private loadingOverlay: HTMLDivElement;
  private triviaText: HTMLDivElement;
  private triviaCategoryLabel: HTMLDivElement;
  private cachedTrivia: string = "Artificial Intelligence continues to evolve rapidly, transforming industries from healthcare to creative arts.";

  // Audio State
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private stream: MediaStream | null = null;
  
  // Visualizer State
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;

  constructor() {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
      apiVersion: 'v1alpha',
    });

    // Initialize UI References
    this.recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    this.rawPanel = document.getElementById('rawTranscription') as HTMLDivElement;
    this.polishedPanel = document.getElementById('polishedNote') as HTMLDivElement;
    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector('i') as HTMLElement;
    this.copyButton = document.getElementById('copyButton') as HTMLButtonElement;
    this.editorTitle = document.querySelector('.editor-title') as HTMLDivElement;
    
    this.controlsContainer = document.querySelector('.floating-controls-container') as HTMLDivElement;
    this.statusPill = document.getElementById('statusPill') as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
    this.liveTimer = document.getElementById('liveTimer') as HTMLDivElement;
    
    this.loadingOverlay = document.getElementById('loadingOverlay') as HTMLDivElement;
    this.triviaText = document.getElementById('triviaText') as HTMLDivElement;
    this.triviaCategoryLabel = document.getElementById('triviaCategoryLabel') as HTMLDivElement;

    // Topic Selection UI
    this.topicToggleButton = document.getElementById('topicToggleButton') as HTMLButtonElement;
    this.topicMenu = document.getElementById('topicMenu') as HTMLDivElement;
    this.topicButtons = document.querySelectorAll('.topic-btn');

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
      this.resizeCanvas();
    }

    this.bindEventListeners();
    this.initTheme();
    this.showStatus('Ready to record', 2000);
    
    // Initial Trivia Fetch
    this.fetchDailyAITrivia(this.currentTopic);
  }

  private bindEventListeners(): void {
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newButton.addEventListener('click', () => this.clearSession());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    this.copyButton.addEventListener('click', () => this.copyPolishedNote());
    window.addEventListener('resize', () => this.resizeCanvas());

    // Topic Menu Logic
    this.topicToggleButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.topicMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!this.topicMenu.classList.contains('hidden') && !this.topicMenu.contains(e.target as Node) && e.target !== this.topicToggleButton) {
        this.topicMenu.classList.add('hidden');
      }
    });

    this.topicButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const topic = btn.getAttribute('data-topic');
        if (topic) {
          this.currentTopic = topic;
          this.updateTopicSelection(btn);
          this.fetchDailyAITrivia(topic);
          this.topicMenu.classList.add('hidden');
          this.showStatus(`Topic: ${topic}`, 2000);
        }
      });
    });
  }

  private updateTopicSelection(activeBtn: HTMLButtonElement): void {
    this.topicButtons.forEach(b => b.classList.remove('active'));
    activeBtn.classList.add('active');
  }

  private resizeCanvas(): void {
    if (!this.liveWaveformCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = window.innerWidth < 800 ? 300 : 600;
    const cssHeight = 80;
    
    this.liveWaveformCanvas.width = cssWidth * dpr;
    this.liveWaveformCanvas.height = cssHeight * dpr;
    this.liveWaveformCanvas.style.width = `${cssWidth}px`;
    this.liveWaveformCanvas.style.height = `${cssHeight}px`;
    
    if (this.liveWaveformCtx) {
      this.liveWaveformCtx.scale(dpr, dpr);
    }
  }

  private showStatus(message: string, duration?: number): void {
    this.statusPill.textContent = message;
    this.statusPill.classList.add('visible');
    if (duration) {
      setTimeout(() => {
        if (this.statusPill.textContent === message) {
            this.statusPill.classList.remove('visible');
        }
      }, duration);
    }
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      this.themeToggleIcon.classList.remove('fa-sun');
      this.themeToggleIcon.classList.add('fa-moon');
    }
  }

  private toggleTheme(): void {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    this.themeToggleIcon.className = isLight ? 'fas fa-moon' : 'fas fa-sun';
  }

  private async copyPolishedNote(): Promise<void> {
    const text = this.polishedPanel.innerText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copyButton.classList.add('copied');
      this.copyButton.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(() => {
        this.copyButton.classList.remove('copied');
        this.copyButton.innerHTML = '<i class="fas fa-copy"></i>';
      }, 2000);
    } catch(e) { console.error(e); }
  }

  private clearSession(): void {
    if (this.isRecording) this.stopRecording();
    this.rawPanel.textContent = '';
    this.polishedPanel.innerHTML = '';
    this.editorTitle.textContent = '';
    this.showStatus('Session cleared', 2000);
  }

  // --- Background Trivia Fetcher ---
  
  private async fetchDailyAITrivia(topic: string): Promise<void> {
    try {
      // Prompt specifically for the chosen topic
      const prompt = `Find one interesting, surprising, or new fact/headline about "${topic}". Keep it under 25 words. Do not format as markdown.`;
      
      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      
      const text = response.text;
      if (text) {
        this.cachedTrivia = text;
        // If we are currently loading, update the text immediately
        if (!this.loadingOverlay.classList.contains('hidden')) {
           this.triviaText.textContent = this.cachedTrivia;
           this.triviaCategoryLabel.textContent = topic;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch trivia", e);
    }
  }

  // --- Recording Logic ---

  private async toggleRecording(): Promise<void> {
    if (this.isRecording) {
      await this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording(): Promise<void> {
    try {
      this.audioChunks = [];
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm' 
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        this.handleRecordingStop();
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      
      this.recordButton.classList.add('recording');
      this.controlsContainer.classList.add('recording');
      this.showStatus('Recording...', 0);
      
      this.startVisualizer();

    } catch (err) {
      console.error('Mic Access Error:', err);
      this.showStatus('Microphone access denied', 3000);
    }
  }

  private async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.recordButton.classList.remove('recording');
      this.controlsContainer.classList.remove('recording');
      this.stopVisualizer();
    }
  }

  private async handleRecordingStop(): Promise<void> {
    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
    if (audioBlob.size === 0) return;

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    await this.processAudio(audioBlob);
  }

  // --- Visualizer Logic (Oscilloscope Style) ---

  private startVisualizer(): void {
    if (!this.stream) return;
    
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();
    
    // Use Time Domain Data for the "Buzz/Wave" effect
    this.analyserNode.fftSize = 2048; 
    source.connect(this.analyserNode);
    
    this.waveformDataArray = new Uint8Array(this.analyserNode.fftSize);
    
    this.recordingStartTime = Date.now();
    this.drawLoop();
    this.timerLoop();
  }

  private stopVisualizer(): void {
    if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    if (this.audioContext) this.audioContext.close();
    
    this.liveTimer.textContent = "00:00";
    if (this.liveWaveformCtx && this.liveWaveformCanvas) {
       this.liveWaveformCtx.clearRect(0, 0, this.liveWaveformCanvas.width, this.liveWaveformCanvas.height);
    }
  }

  private timerLoop(): void {
    this.timerIntervalId = window.setInterval(() => {
       const diff = Math.floor((Date.now() - this.recordingStartTime) / 1000);
       const m = Math.floor(diff / 60).toString().padStart(2, '0');
       const s = (diff % 60).toString().padStart(2, '0');
       this.liveTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  private drawLoop(): void {
    if (!this.analyserNode || !this.liveWaveformCtx || !this.liveWaveformCanvas) return;
    
    this.waveformDrawingId = requestAnimationFrame(() => this.drawLoop());
    
    // Get Time Domain Data (Waveform)
    this.analyserNode.getByteTimeDomainData(this.waveformDataArray!);
    
    const ctx = this.liveWaveformCtx;
    const width = parseInt(this.liveWaveformCanvas.style.width, 10);
    const height = parseInt(this.liveWaveformCanvas.style.height, 10);
    
    ctx.clearRect(0, 0, width, height);
    
    const isLight = document.body.classList.contains('light-mode');
    
    ctx.lineWidth = 2;
    ctx.strokeStyle = isLight ? '#2563eb' : '#38bdf8'; // Cyan or Blue
    
    // Add glow effect
    ctx.shadowBlur = 4;
    ctx.shadowColor = isLight ? 'rgba(37,99,235,0.5)' : 'rgba(56,189,248,0.5)';
    
    ctx.beginPath();
    
    const bufferLength = this.analyserNode.fftSize;
    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = this.waveformDataArray![i] / 128.0; // 128 is zero-crossing
        const y = (v * height) / 2;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        x += sliceWidth;
    }
    
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }

  // --- Processing Logic ---

  private async processAudio(blob: Blob): Promise<void> {
    // Show Loading Overlay with Current Trivia
    this.triviaCategoryLabel.textContent = this.currentTopic;
    this.triviaText.textContent = this.cachedTrivia;
    this.loadingOverlay.classList.remove('hidden');
    this.showStatus('Processing...', 0);
    
    try {
      const base64Audio = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
           const result = reader.result as string;
           resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(blob);
      });

      const prompt = `
        Listen to this audio recording. 
        First, transcribe it verbatim.
        Second, create a polished, well-formatted markdown note from it. 
        Return ONLY a JSON object.
      `;

      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: [
            { text: prompt },
            { inlineData: { mimeType: 'audio/webm', data: base64Audio } }
        ],
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    raw_transcript: { type: Type.STRING },
                    polished_note: { type: Type.STRING }
                },
                required: ['raw_transcript', 'polished_note']
            }
        }
      });

      const result = JSON.parse(response.text!) as TranscriptionResult;
      
      this.rawPanel.innerText = result.raw_transcript;
      this.polishedPanel.innerHTML = marked.parse(result.polished_note);
      
      // Auto-title heuristic
      const lines = result.polished_note.split('\n');
      const titleLine = lines.find(l => l.startsWith('# ')) || lines[0];
      if (titleLine) {
          this.editorTitle.textContent = titleLine.replace(/^#+\s*/, '').substring(0, 50);
      }

      this.showStatus('Done!', 2000);

    } catch (err) {
      console.error("Processing Failed:", err);
      this.showStatus('Error processing audio', 4000);
      this.rawPanel.innerText = "Error processing request.";
    } finally {
      setTimeout(() => {
        this.loadingOverlay.classList.add('hidden');
        // Refresh trivia for next time
        this.fetchDailyAITrivia(this.currentTopic);
      }, 500);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();
});
