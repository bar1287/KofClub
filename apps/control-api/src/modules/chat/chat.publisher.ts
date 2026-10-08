import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';

/** Redis channel the realtime gateways listen on (docs/realtime-protocol.md). */
export const CHAT_CHANNEL = 'table:chat';

/**
 * Hands chat frames to every realtime gateway: each one delivers the frame
 * to its connections subscribed to the table. The frame is the exact server
 * frame (CHAT_MESSAGE or CHAT_HIDDEN); gateways do not interpret it.
 */
@Injectable()
export class ChatPublisher {
  private readonly logger = new Logger(ChatPublisher.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Returns false when Redis is unavailable (ADR-005: degradable). */
  async publish(tableId: string, frame: Record<string, unknown>): Promise<boolean> {
    try {
      await this.redis.publish(CHAT_CHANNEL, JSON.stringify({ tableId, frame }));
      return true;
    } catch (err) {
      // Never log the frame: it carries the message text.
      this.logger.warn(
        { err: (err as Error).message, tableId, type: frame.type },
        'chat bus unavailable; frame not delivered to other gateways',
      );
      return false;
    }
  }
}
