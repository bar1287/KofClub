# Runbook: realtime (WebSocket) problems

Alert: `WebSocketResyncStorm` — `ws_resyncs_total` rate above 1/s for 10 min.

Resyncs are normal after reconnects; a sustained high rate means clients keep
losing continuity.

1. Break down by `reason`:
   - `EVENTS_NOT_RETAINED`: clients reconnect after the replay window
     (`FeedRing`, 1024 events per table); usually long disconnects (mobile).
   - `SEQUENCE_GAP` / `FEED_RESET`: the gateway's internal stream to a game
     node reconnected (game-node restarts, network issues between gateway and
     game nodes). Check game-service health and failovers.
2. `ws_slow_consumer_disconnects_total` rising: clients cannot keep up
   (bandwidth); the gateway disconnects them rather than blocking tables.
3. `ws_auth_failures_total{reason}`: expired tokens are normal; spikes of
   `invalid` may indicate a key rotation mismatch between control-api
   (`AUTH_JWT_PRIVATE_KEY_B64`) and gateway (`AUTH_JWT_PUBLIC_KEY_B64`).
