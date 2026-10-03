import { Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '../../common/ids';
import { Database, Queryable } from '../../infra/database/database';

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskEventInput {
  subjectUserId: string | null;
  clubId?: string | null;
  type: string;
  severity: RiskSeverity;
  score?: number;
  featureValues?: Record<string, unknown>;
  evidenceRefs?: string[];
}

/**
 * Records fair-play/security signals for later review (spec §11). The MVP
 * only collects evidence; it never auto-bans from a single heuristic.
 */
@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(private readonly db: Database) {}

  async record(event: RiskEventInput, q: Queryable = this.db): Promise<void> {
    try {
      await q.query(
        `INSERT INTO risk_events (id, subject_user_id, club_id, type, severity, score, feature_values, evidence_refs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uuidv7(),
          event.subjectUserId,
          event.clubId ?? null,
          event.type,
          event.severity,
          event.score ?? 0,
          JSON.stringify(event.featureValues ?? {}),
          JSON.stringify(event.evidenceRefs ?? []),
        ],
      );
    } catch (err) {
      // Telemetry must not break the user-facing operation, but failures are visible.
      this.logger.error(
        { err: (err as Error).message, type: event.type },
        'risk_event_write_failed',
      );
    }
  }
}
