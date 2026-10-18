// The link between two phones. It uses PeerJS: a free public server only introduces the two phones,
// then they talk to each other directly (WebRTC). A room is a short code, and there is no login.
import Peer, { type DataConnection, type PeerOptions } from 'peerjs';

// Letters that are hard to mix up when read out loud or typed on a phone
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const newRoomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const cleanCode = (t: string) => t.toUpperCase().replace(/[^A-Z]/g, '').replace(/[IOL]/g, '').slice(0, 4);
const peerId = (code: string) => 'blocksquad-v1-' + code;

// Tests run their own PeerJS server: ?peer=localhost:9000
function options(): PeerOptions {
  const p = new URLSearchParams(location.search).get('peer');
  if (!p) return { debug: 0 };
  const [host, port] = p.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0 };
}

export interface LinkHandlers {
  message(m: unknown): void;
  open(): void;     // the other phone is connected
  close(): void;    // the other phone went away
  error(text: string): void;
}

export class Link {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  host = false;
  closed = false;

  constructor(readonly code: string, private h: LinkHandlers) {}

  get connected() { return !!this.conn?.open; }

  send(m: unknown) {
    if (this.conn?.open) this.conn.send(m);
  }

  // Make the room and wait for the other phone. If the room already exists, join it instead.
  start(want: 'host' | 'join' | 'either') {
    if (want === 'join') this.join();
    else this.makeRoom(want === 'either');
  }

  private makeRoom(orJoin: boolean) {
    const peer = new Peer(peerId(this.code), options());
    this.peer = peer;
    this.host = true;
    peer.on('connection', c => {
      // A phone coming back after a drop replaces the old connection
      if (this.conn && this.conn !== c) this.conn.close();
      this.wire(c);
    });
    peer.on('disconnected', () => { if (!this.closed && !peer.destroyed && this.peer === peer) peer.reconnect(); });
    peer.on('error', e => {
      const type = (e as { type?: string }).type;
      if (type === 'unavailable-id' && orJoin) { peer.destroy(); this.join(); return; }
      if (type === 'unavailable-id') { this.h.error('That room code is already in use. Try again for a new one.'); return; }
      this.h.error(errorText(type));
    });
  }

  private join() {
    const peer = new Peer(options());
    this.peer = peer;
    this.host = false;
    peer.on('open', () => this.wire(peer.connect(peerId(this.code), { reliable: true })));
    peer.on('error', e => {
      const type = (e as { type?: string }).type;
      this.h.error(type === 'peer-unavailable' ? `No game with the code ${this.code} is waiting. Check the code on the other phone.` : errorText(type));
    });
  }

  private wire(c: DataConnection) {
    this.conn = c;
    c.on('open', () => { if (this.conn === c) this.h.open(); });
    c.on('data', d => { if (this.conn === c) this.h.message(d); });
    c.on('close', () => { if (this.conn === c && !this.closed) { this.conn = null; this.h.close(); } });
    c.on('error', () => { if (this.conn === c && !this.closed) { this.conn = null; this.h.close(); } });
  }

  stop() {
    this.closed = true;
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  }
}

function errorText(type?: string): string {
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return "Can't reach the internet to find the other phone. Check the Wi-Fi and try again.";
  if (type === 'browser-incompatible') return "This browser can't link phones. Try Chrome.";
  return 'Something went wrong linking the phones. Try again.';
}
