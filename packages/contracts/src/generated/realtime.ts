// Code generated from openapi/realtime.yaml by scripts/generate.mjs. DO NOT EDIT.
/* eslint-disable */
export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    /** @enum {string} */
    ClientMessageType:
      'HELLO' | 'SUBSCRIBE_TABLE' | 'UNSUBSCRIBE_TABLE' | 'COMMAND' | 'PING' | 'PONG';
    /** @description First client frame. Authenticates the connection. */
    Hello: {
      accessToken: string;
      clientVersion: string;
      deviceId?: string;
      /** @enum {string} */
      type: 'HELLO';
    };
    Ping: {
      nonce?: string;
      /** @enum {string} */
      type: 'PING';
    };
    Pong: {
      nonce?: string;
      /** @enum {string} */
      type: 'PONG';
    };
    /** @description Connection-level error (not tied to a table command). */
    ProtocolError: {
      /** @description An ErrorCode value from the control-api contract. */
      code: string;
      message: string;
      requestId?: string;
      /** Format: uuid */
      tableId?: string;
      /** @enum {string} */
      type: 'ERROR';
    };
    /** @enum {string} */
    ServerMessageType:
      | 'WELCOME'
      | 'TABLE_SNAPSHOT'
      | 'TABLE_EVENT'
      | 'COMMAND_RESULT'
      | 'RESYNC_REQUIRED'
      | 'ERROR'
      | 'PING'
      | 'PONG';
    Welcome: {
      connectionId: string;
      heartbeatIntervalMs: number;
      /** Format: date-time */
      serverTime: string;
      /** @enum {string} */
      type: 'WELCOME';
      /** Format: uuid */
      userId: string;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
