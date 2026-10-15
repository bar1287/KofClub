'use client';

import { useSession } from '@/lib/session';
import { openTelegramLink, shareClubLink } from '@/lib/telegram';
import { useOperator } from '@/lib/useOperator';
import { useTelegramConfig } from '@/lib/useTelegramConfig';

/**
 * Shares a club code to a Telegram chat as a link that opens the Mini App
 * on the join page. Hidden where this deployment has no Telegram bot.
 */
export function TelegramShareButton({ code, clubName }: { code: string; clubName: string }) {
  const { ep } = useSession();
  const config = useTelegramConfig(ep);
  const operator = useOperator(ep);
  // In an operator's world, links open the operator's bot (ADR-019).
  const bot = operator.slug
    ? (operator.info?.botUsername ?? null)
    : config?.enabled
      ? config.botUsername
      : null;
  if (!bot) return null;
  return (
    <button
      className="btn small"
      type="button"
      data-testid="share-telegram"
      onClick={() => void openTelegramLink(shareClubLink(bot, code, clubName))}
    >
      Share in Telegram
    </button>
  );
}
