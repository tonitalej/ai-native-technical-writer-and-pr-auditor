import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { AUDIT_RECOVERY_INTERVAL_MS } from '../config/constants.js';
import type { AppConfig } from '../config/env.js';
import type { AuditData } from '../data/contracts.js';
import { processClaimedAudit, type ProcessAuditDeps } from '../services/audits/processAudit.js';
import type { AppLogger } from '../utils/logger.js';

export class AuditWorker {
  readonly workerId: string;
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private nudge = false;
  private draining = false;
  private inflight = 0;
  private lastRecovery = 0;
  private readonly idleWaiters: Array<() => void> = [];

  constructor(
    private readonly deps: ProcessAuditDeps & { audits: AuditData; config: AppConfig; logger: AppLogger },
  ) {
    this.workerId = createWorkerId();
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.draining = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.config.auditWorkerIntervalMs);
    void this.tick();
    this.deps.logger.info({ worker_id: this.workerId }, 'audit worker started');
  }

  wake(): void {
    if (this.draining) {
      return;
    }
    void this.tick();
  }

  async stop(timeoutMs: number): Promise<void> {
    this.draining = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.waitForIdle(timeoutMs);
    this.deps.logger.info({ worker_id: this.workerId, inflight: this.inflight }, 'audit worker stopped');
  }

  async tick(): Promise<void> {
    if (this.draining) {
      return;
    }
    if (this.ticking) {
      this.nudge = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.nudge = false;
        await this.recoverIfDue();
        await this.claimBatch();
      } while (this.nudge && !this.draining);
    } catch (error) {
      this.deps.logger.error(
        { err: error instanceof Error ? error.name : 'error', worker_id: this.workerId },
        'audit worker tick failed',
      );
    } finally {
      this.ticking = false;
    }
  }

  private async recoverIfDue(): Promise<void> {
    const now = Date.now();
    if (this.lastRecovery !== 0 && now - this.lastRecovery < AUDIT_RECOVERY_INTERVAL_MS) {
      return;
    }
    this.lastRecovery = now;
    const result = await this.deps.audits.recoverStale(this.deps.config.auditStaleAfterSeconds);
    if (result.requeued > 0 || result.exhausted > 0) {
      this.deps.logger.info(
        { worker_id: this.workerId, requeued: result.requeued, exhausted: result.exhausted },
        'stale audits recovered',
      );
    }
  }

  private async claimBatch(): Promise<void> {
    const started: Array<Promise<void>> = [];
    while (this.inflight < this.deps.config.auditWorkerConcurrency && !this.draining) {
      const claimed = await this.deps.audits.claimNext(this.workerId);
      if (!claimed) {
        break;
      }
      this.inflight += 1;
      this.deps.logger.info(
        { audit_id: claimed.id, worker_id: this.workerId, attempts: claimed.attempts },
        'audit claimed',
      );
      started.push(
        processClaimedAudit(this.deps, claimed).finally(() => {
          this.inflight -= 1;
          if (this.inflight === 0) {
            for (const resolve of this.idleWaiters.splice(0)) {
              resolve();
            }
          }
        }),
      );
    }
    await Promise.all(started);
  }

  private waitForIdle(timeoutMs: number): Promise<void> {
    if (this.inflight === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function createWorkerId(): string {
  const host = hostname().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'host';
  return `${host}:${process.pid}:${randomUUID()}`;
}
