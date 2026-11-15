import { privateStorage } from '../private-storage';
import {
  worldsPreferences,
  onWorldsPreferences,
  loadWorldsPreferences,
  saveWorldsVoicePreferences,
} from './worlds-preferences';
import voiceConnectSoundUrl from '../assets/audio/worlds-voice-connect.mp3';
import voiceDisconnectSoundUrl from '../assets/audio/worlds-voice-disconnect.mp3';
import { WorldsVoiceMeter } from './worlds-voice-meter';
import { WorldsVoicePlayback } from './worlds-voice-playback';
import type {
  WorldsMember,
  WorldsVoiceCommand,
  WorldsVoiceEvent,
  WorldsVoiceStatus,
} from '../../shared/social/battly-worlds-contract';

/** The launcher owns the microphone. Closing the overlay never ends an ongoing call. */
export function bindWorldsVoice(): void {
  const preferencesReady = loadWorldsPreferences().catch(() => undefined);
  const cues = {
    connect: new Audio(voiceConnectSoundUrl),
    disconnect: new Audio(voiceDisconnectSoundUrl),
  };
  cues.connect.volume = cues.disconnect.volume = 0.25;
  const playCue = (kind: keyof typeof cues) => {
    if (!worldsPreferences().voiceSounds || deafened) {
      return;
    }
    const cue = cues[kind];
    cue.currentTime = 0;
    void cue.play().catch(() => undefined);
  };
  let context: Extract<WorldsVoiceEvent, { type: 'ready' }> | undefined;
  let members: WorldsMember[] = [];
  let stream: MediaStream | undefined;
  let desired = false,
    muted = false,
    deafened = false,
    generation = 0,
    deviceId = '';
  try {
    const raw: unknown = JSON.parse(privateStorage.getItem('battly.worlds.voice') || '{}');
    const saved = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    muted = saved.muted === true;
    deafened = saved.deafened === true;
  } catch {
    /* Missing preferences use the default microphone state. */
  }
  const savePreferences = () => {
    saveWorldsVoicePreferences(muted, deafened);
    try {
      privateStorage.setItem('battly.worlds.voice', JSON.stringify({ muted, deafened }));
    } catch {
      status('No se pudo guardar el estado del micrófono.');
    }
  };
  const meter = new WorldsVoiceMeter();
  const playback = new WorldsVoicePlayback();
  let currentRoom = '';
  let devices: { deviceId: string; label: string }[] = [];
  const peers = new Map<
    string,
    {
      pc: RTCPeerConnection;
      audio: HTMLAudioElement;
      pending: RTCIceCandidateInit[];
      queue: Promise<void>;
      makingOffer: boolean;
      recoveryTimer?: ReturnType<typeof setTimeout>;
    }
  >();
  const volumes = new Map<string, number>();
  const retries = new Map<
    string,
    { attempts: number; after: number; timer?: ReturnType<typeof setTimeout> }
  >();
  const restartSignals = new Map<string, number>();
  const clearRetries = (): void => {
    for (const retry of retries.values()) {
      clearTimeout(retry.timer);
    }
    retries.clear();
    restartSignals.clear();
  };

  const status = (error = ''): void => {
    void window.battly
      .worldsVoiceState({
        devices,
        inputDeviceId: deviceId,
        connected: !!stream && !!context,
        muted,
        deafened,
        error,
      } satisfies WorldsVoiceStatus)
      .catch(() => undefined);
  };
  const closePeer = (id: string): void => {
    const peer = peers.get(id);
    if (!peer) {
      return;
    }
    meter.remove(id);
    playback.remove(id);
    clearTimeout(peer.recoveryTimer);
    peer.pc.onconnectionstatechange = null;
    peer.pc.onicecandidate = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    peers.delete(id);
  };
  const resetPeers = (): void => {
    for (const id of peers.keys()) {
      closePeer(id);
    }
  };
  const release = (): void => {
    if (stream) {
      playCue('disconnect');
    }
    generation++;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    meter.close();
    resetPeers();
    playback.close();
    clearRetries();
    status();
  };
  const send = (to: string, signal: Record<string, unknown>): void => {
    void window.battly.worldsVoiceSignal(to, signal).catch(() => {
      if (peers.has(to)) {
        status('No se pudo enviar la señal de voz. Comprueba la conexión con Battly.');
      }
    });
  };

  function peerFor(id: string) {
    const existing = peers.get(id);
    if (existing) {
      return existing;
    }
    if (!context || !stream) {
      throw new Error('Voz desconectada');
    }
    const pc = new RTCPeerConnection({ iceServers: context.iceServers });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.volume = volumes.get(id) ?? 1;
    audio.muted = deafened;
    document.body.append(audio);
    const peer = {
      pc,
      audio,
      pending: [] as RTCIceCandidateInit[],
      queue: Promise.resolve(),
      makingOffer: false,
      recoveryTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    peers.set(id, peer);
    for (const track of stream.getAudioTracks()) {
      pc.addTrack(track, stream);
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        send(id, { type: 'candidate', ...event.candidate.toJSON() });
      }
    };
    pc.ontrack = (event) => {
      if (peers.get(id) !== peer || !context || !stream) {
        return;
      }
      const remote = event.streams[0] || new MediaStream([event.track]);
      meter.add(id, remote);
      void playback.add(id, remote).then((filtered) => {
        if (!filtered || peers.get(id) !== peer || !context || !stream) {
          return;
        }
        audio.srcObject = filtered;
        return audio
          .play()
          .catch(() => status('Pulsa Escuchar para permitir la reproducción del audio.'));
      });
    };
    pc.onconnectionstatechange = () => {
      if (peers.get(id) !== peer) {
        return;
      }
      if (pc.connectionState === 'connected') {
        status();
        clearTimeout(peer.recoveryTimer);
        peer.recoveryTimer = undefined;
        const retry = retries.get(id);
        clearTimeout(retry?.timer);
        retries.delete(id);
      }
      if (pc.connectionState === 'disconnected') {
        if (!peer.recoveryTimer) {
          peer.recoveryTimer = setTimeout(() => {
            peer.recoveryTimer = undefined;
            if (peers.get(id) === peer && pc.connectionState === 'disconnected') {
              recover();
            }
          }, 8000);
        }
      }
      if (pc.connectionState === 'failed') {
        recover();
      }
    };
    function recover(): void {
      if (peers.get(id) !== peer) {
        return;
      }
      console.warn(
        '[Battly Worlds] Voice recovery ' +
          JSON.stringify({
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            microphoneEnabled: stream?.getAudioTracks().some((track) => track.enabled) ?? false,
          }),
      );
      closePeer(id);
      const attempts = (retries.get(id)?.attempts || 0) + 1;
      const delay = Math.min(attempts * 3000, 30000);
      const retry = {
        attempts,
        after: Date.now() + delay,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      retries.set(id, retry);
      status('Reconectando el audio de un participante…');
      retry.timer = setTimeout(() => {
        if (
          !context ||
          !stream ||
          !members.some(
            (m) => m.userId === id && m.voiceConnected && m.voiceChannel === context!.channel,
          )
        ) {
          return;
        }
        send(id, { type: 'restart' });
        sync();
      }, delay);
    }
    // ICE/signaling can stall in "new" or "connecting" without ever reporting
    // "failed" (for example when the first offer is lost during a reconnect).
    peer.recoveryTimer = setTimeout(() => {
      peer.recoveryTimer = undefined;
      if (peers.get(id) === peer && pc.connectionState !== 'connected') {
        recover();
      }
    }, 25000);
    return peer;
  }
  async function offer(id: string): Promise<void> {
    if (!stream || !context) {
      return;
    }
    const retry = retries.get(id);
    if (retry && retry.after > Date.now()) {
      return;
    }
    const epoch = generation,
      peer = peerFor(id);
    if (peer.makingOffer || peer.pc.signalingState !== 'stable') {
      return;
    }
    peer.makingOffer = true;
    try {
      const description = await peer.pc.createOffer();
      if (epoch !== generation || peers.get(id) !== peer) {
        return;
      }
      await peer.pc.setLocalDescription(description);
      send(id, { type: 'offer', sdp: description.sdp });
    } catch {
      if (epoch === generation) {
        status('No se pudo negociar la voz con un participante.');
      }
    } finally {
      peer.makingOffer = false;
    }
  }
  function sync(): void {
    if (!context || !stream) {
      return;
    }
    const active = members.filter(
      (m) =>
        m.voiceConnected && m.voiceChannel === context!.channel && m.userId !== context!.userId,
    );
    const ids = new Set(active.map((m) => m.userId));
    for (const id of peers.keys()) {
      if (!ids.has(id)) {
        closePeer(id);
      }
    }
    for (const id of ids) {
      if (!peers.has(id) && context.userId < id) {
        void offer(id);
      }
    }
  }
  async function connect(): Promise<void> {
    desired = true;
    if (!context) {
      status('Conectando el canal de voz…');
      return;
    }
    desired = true;
    const epoch = ++generation;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: { ideal: 1 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      });
      if (epoch !== generation || !desired || !context) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      const wasConnected = !!stream;
      stream?.getTracks().forEach((t) => t.stop());
      stream = media;
      console.warn(
        '[Battly Worlds] Microphone opened ' +
          JSON.stringify({
            tracks: media
              .getAudioTracks()
              .map((track) => ({ readyState: track.readyState, muted: track.muted })),
            muted,
            deafened,
          }),
      );
      meter.add(context.userId, media);
      for (const track of media.getAudioTracks()) {
        track.enabled = !muted && !deafened;
        track.onended = () => {
          desired = false;
          release();
          status('Se ha desconectado el micrófono. Selecciona otro dispositivo.');
        };
      }
      try {
        devices = (await navigator.mediaDevices.enumerateDevices())
          .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
          .slice(0, 32)
          .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Micrófono' }));
      } catch {
        devices = [];
      }
      if (epoch !== generation || !stream) {
        return;
      }
      if (!wasConnected) {
        playCue('connect');
      }
      resetPeers();
      clearRetries();
      status();
      sync();
    } catch (error) {
      if (epoch !== generation) {
        return;
      }
      desired = false;
      release();
      console.warn(
        '[Battly Worlds] Microphone capture failed ' +
          JSON.stringify({
            name: error instanceof Error || error instanceof DOMException ? error.name : 'Error',
          }),
      );
      status(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Permite el acceso al micrófono en Windows para activar la voz.'
          : 'No se pudo abrir el micrófono. Comprueba el dispositivo seleccionado.',
      );
    }
  }
  async function command(value: WorldsVoiceCommand): Promise<void> {
    switch (value.type) {
      case 'connect':
        if (!stream) {
          await connect();
        } else {
          for (const peer of peers.values()) {
            peer.audio.muted = deafened;
            void peer.audio.play().catch(() => undefined);
          }
          status();
        }
        break;
      case 'disconnect':
        desired = false;
        release();
        break;
      case 'mute':
        muted = value.value;
        savePreferences();
        stream?.getAudioTracks().forEach((t) => {
          t.enabled = !muted && !deafened && !!context;
        });
        status();
        break;
      case 'deafen':
        deafened = value.value;
        savePreferences();
        stream?.getAudioTracks().forEach((t) => {
          t.enabled = !muted && !deafened && !!context;
        });
        for (const peer of peers.values()) {
          peer.audio.muted = deafened;
          if (!deafened) {
            void peer.audio.play().catch(() => undefined);
          }
        }
        status();
        break;
      case 'input':
        deviceId = value.deviceId;
        if (stream) {
          await connect();
        }
        break;
      case 'volume':
        volumes.set(value.userId, value.volume);
        {
          const peer = peers.get(value.userId);
          if (peer) {
            peer.audio.volume = value.volume;
          }
        }
        break;
    }
  }
  function signal(from: string, signal: Record<string, unknown>): void {
    if (
      !context ||
      !stream ||
      !members.some((m) => m.userId === from && m.voiceChannel === context!.channel)
    ) {
      return;
    }
    if (signal.type === 'restart') {
      if (Date.now() - (restartSignals.get(from) || 0) < 2000) {
        return;
      }
      restartSignals.set(from, Date.now());
      closePeer(from);
      if (context.userId < from) {
        void offer(from);
      }
      return;
    }
    const peer = peerFor(from),
      epoch = generation;
    peer.queue = peer.queue
      .then(async () => {
        if (epoch !== generation || peers.get(from) !== peer) {
          return;
        }
        if (signal.type === 'candidate') {
          const candidate = {
            candidate: String(signal.candidate),
            ...(typeof signal.usernameFragment === 'string'
              ? { usernameFragment: signal.usernameFragment }
              : {}),
            sdpMid: signal.sdpMid as string | null,
            sdpMLineIndex: signal.sdpMLineIndex as number | null,
          };
          if (peer.pc.remoteDescription) {
            await peer.pc.addIceCandidate(candidate);
          } else if (peer.pending.length < 128) {
            peer.pending.push(candidate);
          }
        } else if (signal.type === 'offer' || signal.type === 'answer') {
          if (
            signal.type === 'offer' &&
            (peer.makingOffer || peer.pc.signalingState !== 'stable')
          ) {
            if (context!.userId < from) {
              return;
            }
            await peer.pc.setLocalDescription({ type: 'rollback' });
          }
          await peer.pc.setRemoteDescription({ type: signal.type, sdp: String(signal.sdp) });
          for (const candidate of peer.pending.splice(0)) {
            await peer.pc.addIceCandidate(candidate);
          }
          if (signal.type === 'offer') {
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            if (epoch === generation) {
              send(from, { type: 'answer', sdp: answer.sdp });
            }
          }
        }
      })
      .catch((error: unknown) => {
        console.warn('[Battly Worlds] Voice negotiation failed', {
          operation: signal.type,
          name: error instanceof Error ? error.name : 'Error',
          signalingState: peer.pc.signalingState,
          connectionState: peer.pc.connectionState,
          iceConnectionState: peer.pc.iceConnectionState,
        });
        if (epoch === generation) {
          status('No se pudo conectar el audio de un participante.');
        }
      });
  }
  onWorldsPreferences((value) => {
    muted = value.voiceMuted;
    deafened = value.voiceDeafened;
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted && !deafened && !!context;
    });
    for (const peer of peers.values()) {
      peer.audio.muted = deafened;
    }
    status();
  });
  window.battly.onWorldsEvent((event) => {
    if (
      event.type === 'snapshot' &&
      (!event.snapshot.code || ['idle', 'error'].includes(event.snapshot.state))
    ) {
      currentRoom = '';
      context = undefined;
      desired = false;
      if (stream) {
        release();
      }
      return;
    }
    if (event.type !== 'voice') {
      return;
    }
    const value = event.event;
    switch (value.type) {
      case 'ready': {
        const newRoom = currentRoom !== value.roomCode;
        const sameSession =
          !newRoom && context?.userId === value.userId && context?.channel === value.channel;
        if (currentRoom && currentRoom !== value.roomCode) {
          desired = false;
          release();
        }
        if (newRoom) {
          desired = worldsPreferences().voiceAutoJoin;
        }
        currentRoom = value.roomCode;
        context = value;
        if (stream) {
          meter.add(value.userId, stream);
          stream.getAudioTracks().forEach((t) => {
            t.enabled = !muted && !deafened;
          });
          if (!sameSession) {
            resetPeers();
            clearRetries();
          } else {
            for (const peer of peers.values()) {
              peer.pc.setConfiguration({ iceServers: value.iceServers });
            }
          }
          status();
          sync();
        } else {
          void preferencesReady.then(() => {
            if (context?.roomCode !== value.roomCode) {
              return;
            }
            if (newRoom) {
              desired = worldsPreferences().voiceAutoJoin;
            }
            if (desired) {
              void connect();
            }
          });
        }
        break;
      }
      case 'lost':
        if (value.message) {
          context = undefined;
          desired = false;
          release();
          status(value.message);
          break;
        }
        // The signaling socket is independent from established WebRTC audio.
        // Keep the call alive while Socket.IO reconnects.
        if (stream || desired) {
          status('Reconectando con Battly; manteniendo el audio activo…');
        }
        break;
      case 'members':
        if (context && stream) {
          const inChannel = (member: WorldsMember) =>
            member.voiceConnected &&
            member.voiceChannel === context!.channel &&
            member.userId !== context!.userId;
          const previous = new Set(members.filter(inChannel).map((member) => member.userId));
          const next = new Set(value.members.filter(inChannel).map((member) => member.userId));
          if ([...previous].some((id) => !next.has(id))) {
            playCue('disconnect');
          }
          if ([...next].some((id) => !previous.has(id))) {
            playCue('connect');
          }
        }
        members = value.members;
        sync();
        break;
      case 'channel':
        if (context && context.channel !== value.channel) {
          context = { ...context, channel: value.channel };
          resetPeers();
          clearRetries();
          status();
          sync();
        }
        break;
      case 'command':
        void command(value.command);
        break;
      case 'signal':
        signal(value.from, value.signal);
        break;
    }
  });
  window.addEventListener('beforeunload', () => {
    desired = false;
    release();
  });
}
