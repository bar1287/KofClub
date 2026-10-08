import { avatarFor } from '@/lib/avatar';

/** A player's generated avatar (decorative: the name is always shown too). */
export function Avatar({ seed, size = 24 }: { seed: string; size?: number }) {
  const { hue, cells } = avatarFor(seed);
  return (
    <svg
      className="avatar"
      width={size}
      height={size}
      viewBox="0 0 5 5"
      aria-hidden
      data-testid="avatar"
      shapeRendering="crispEdges"
    >
      <rect width="5" height="5" fill={`hsl(${hue} 35% 22%)`} />
      {cells.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={`hsl(${hue} 70% 62%)`} />
          ) : null,
        ),
      )}
    </svg>
  );
}
