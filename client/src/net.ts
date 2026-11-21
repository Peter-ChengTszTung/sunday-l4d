import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export class Net {
  private ws: WebSocket | null = null;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(name: string, room: string, ch?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => { this.send({ t: 'j', name, room, ch }); resolve(); };
      ws.onerror = () => reject(new Error('Could not reach the game server.'));
      ws.onmessage = (e) => {
        let m: ServerMsg;
        try { m = JSON.parse(e.data as string); } catch { return; }
        this.onMessage(m);
      };
      ws.onclose = () => { this.ws = null; this.onClose(); };
    });
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
