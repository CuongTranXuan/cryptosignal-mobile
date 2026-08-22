declare module "ws" {
  export default class WebSocket {
    constructor(url: string);
    on(event: "message" | "close" | "error", listener: (value?: unknown) => void): WebSocket;
    close(): void;
  }
}
