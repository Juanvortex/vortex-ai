
import { useEffect, useRef, useState } from "react";
import "./VoiceMode.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function VoiceMode({ onClose }) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");

  const socketRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const gainRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef(new Set());

  function cleanup() {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  useEffect(() => {
    return () => cleanup();
  }, []);

  function playAudio(arrayBuffer) {
    const context = audioContextRef.current;
    if (!context || arrayBuffer.byteLength < 2) return;

    const pcm = new Int16Array(
      arrayBuffer,
      0,
      Math.floor(arrayBuffer.byteLength / 2)
    );

    const samples = new Float32Array(pcm.length);

    for (let i = 0; i < pcm.length; i++) {
      samples[i] = pcm[i] / 32768;
    }

    const buffer = context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);

    const source = context.createBufferSource();
source.buffer = buffer;
source.connect(context.destination);

activeSourcesRef.current.add(source);

source.onended = () => {
  activeSourcesRef.current.delete(source);
};

    const startTime = Math.max(
      context.currentTime + 0.02,
      nextPlayTimeRef.current
    );

    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
  }
  function interruptPlayback() {
  activeSourcesRef.current.forEach((source) => {
    try {
      source.stop();
    } catch (error) {
      // Audio source may have already stopped.
    }
  });

  activeSourcesRef.current.clear();
  nextPlayTimeRef.current = 0;
}

  function resampleAudio(input, inputRate, outputRate) {
    if (inputRate === outputRate) return input;

    const ratio = inputRate / outputRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const fraction = position - index;

      const first = input[index] || 0;
      const second = input[index + 1] || first;

      output[i] = first + (second - first) * fraction;
    }

    return output;
  }

  function convertToPCM16(samples) {
    const buffer = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(
        i * 2,
        sample < 0 ? sample * 32768 : sample * 32767,
        true
      );
    }

    return buffer;
  }

  async function startVoice() {
    try {
      setError("");
      setTranscript("");
      setReply("");
      setStatus("connecting");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      const context = new AudioContextClass();
      audioContextRef.current = context;

      await context.resume();

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const gain = context.createGain();

      gain.gain.value = 0;

      sourceRef.current = source;
      processorRef.current = processor;
      gainRef.current = gain;

      const backendURL = new URL(API_URL);
      backendURL.protocol =
        backendURL.protocol === "https:" ? "wss:" : "ws:";
      backendURL.pathname = "/ws/voice";

      const socket = new WebSocket(backendURL.toString());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus("listening");

        source.connect(processor);
        processor.connect(gain);
        gain.connect(context.destination);

        processor.onaudioprocess = (event) => {
          if (socket.readyState !== WebSocket.OPEN) return;

          const input = event.inputBuffer.getChannelData(0);
          const resampled = resampleAudio(
            input,
            context.sampleRate,
            16000
          );

          socket.send(convertToPCM16(resampled));
        };
      };

      socket.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          playAudio(event.data);
          setStatus("speaking");
          return;
        }

        const data = JSON.parse(event.data);
        if (data.type === "interrupted") {
  interruptPlayback();
  setStatus("listening");
  return;
}

        if (data.type === "connected") {
          setStatus("listening");
        }

        if (data.type === "input_transcription" && data.text) {
          setTranscript((previous) => previous + data.text);
        }

        if (data.type === "output_transcription" && data.text) {
          setReply((previous) => previous + data.text);
        }

        if (data.type === "turn_complete") {
          setStatus("listening");
        }

        if (data.type === "error") {
          setError(data.message || "Voice connection failed.");
          setStatus("error");
          cleanup();
        }
      };

      socket.onerror = () => {
        setError("Could not connect to VORTEX Voice Mode.");
        setStatus("error");
        cleanup();
      };

      socket.onclose = () => {
        if (status !== "idle") {
          setStatus("idle");
        }
      };
    } catch (err) {
      setError(err.message || "Could not start your microphone.");
      setStatus("error");
      cleanup();
    }
  }

  function stopVoice() {
    cleanup();
    setStatus("idle");
  }

  function closeVoice() {
    cleanup();
    onClose();
  }

  return (
    <div className="voice-mode">
      <button className="voice-close" onClick={closeVoice}>
        ✕
      </button>

      <div className="voice-heading">
        <span>VORTEX AI</span>
        <h1>Voice Mode</h1>
        <p>Your intelligent voice companion</p>
      </div>

      <div className={`voice-orb ${status}`}>
        <div className="orb-core">
          <span>V</span>
        </div>
      </div>

      <div className="voice-status">
        {status === "idle" && "READY TO CONNECT"}
        {status === "connecting" && "CONNECTING..."}
        {status === "listening" && "LISTENING..."}
        {status === "speaking" && "VORTEX IS SPEAKING"}
        {status === "error" && "CONNECTION ERROR"}
      </div>

      <div className="voice-conversation">
        {transcript && (
          <p><strong>YOU:</strong> {transcript}</p>
        )}
        {reply && (
          <p><strong>VORTEX:</strong> {reply}</p>
        )}
      </div>

      {error && <p className="voice-error">{error}</p>}

      <div className="voice-controls">
        {status === "idle" || status === "error" ? (
          <button onClick={startVoice}>
            START CONVERSATION
          </button>
        ) : (
          <button onClick={stopVoice}>
            END CONVERSATION
          </button>
        )}
      </div>

      <p className="voice-footer">
        POWERED BY GEMINI LIVE
      </p>
    </div>
  );
}

export default VoiceMode;
