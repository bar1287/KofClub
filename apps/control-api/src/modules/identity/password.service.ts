import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { APP_CONFIG, AppConfig } from '../../config/config';

/**
 * Argon2id password hashing (spec §9). Parameters follow the OWASP baseline
 * (19 MiB, t=2, p=1); the encoded hash stores its own parameters so they can
 * be raised later and old hashes re-hashed on login.
 */
@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get options(): argon2.HashOptions & { raw: false } {
    return {
      raw: false,
      type: argon2.argon2id,
      memoryCost: this.config.ARGON2_MEMORY_KIB,
      timeCost: 2,
      parallelism: 1,
    };
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    const { memoryCost, timeCost, parallelism } = this.options;
    return argon2.needsRehash(hash, { memoryCost, timeCost, parallelism });
  }

  /**
   * Burns the same CPU/memory as a real verification when the account does
   * not exist, so response timing does not reveal registered logins.
   */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-equalization');
    await this.verify(await this.dummyHash, password);
  }
}
