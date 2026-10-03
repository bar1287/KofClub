import { cardParts } from '@/lib/format';

interface Props {
  card?: string;
  /** Face-down (another player's hidden card). */
  back?: boolean;
  small?: boolean;
  highlight?: boolean;
}

export function PlayingCard({ card, back, small, highlight }: Props) {
  const size = small ? ' small' : '';
  if (back) {
    return (
      <div
        className={`playing-card back${size}`}
        aria-label="Hidden card"
        data-testid="card-back"
      />
    );
  }
  if (!card) return <div className={`playing-card placeholder${size}`} aria-hidden />;
  const p = cardParts(card);
  return (
    <div
      className={`playing-card${p.red ? ' red' : ''}${size}${highlight ? ' best' : ''}`}
      aria-label={p.label}
      data-card={card}
    >
      <span className="rank">{p.rank}</span>
      <span className="suit">{p.symbol}</span>
    </div>
  );
}
