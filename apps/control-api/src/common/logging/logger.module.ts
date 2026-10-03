import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../../config/config';
import { resolveRequestId } from '../http/request-id';

/**
 * Structured JSON logging (pino). Sensitive values are redacted: auth
 * headers, cookies, passwords and tokens must never reach the logs.
 */
@Module({})
export class LoggingModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        PinoLoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            base: { service: 'control-api', env: config.APP_ENV },
            messageKey: 'msg',
            genReqId: (req, res) => resolveRequestId(req, res),
            customAttributeKeys: { reqId: 'request_id' },
            autoLogging: {
              ignore: (req) => /^\/(health|metrics)/.test(req.url ?? ''),
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.password',
                '*.refreshToken',
                '*.accessToken',
              ],
              censor: '[REDACTED]',
            },
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            transport:
              config.APP_ENV === 'local' && process.env.LOG_PRETTY === '1'
                ? { target: 'pino-pretty' }
                : undefined,
          },
        }),
      ],
    };
  }
}
