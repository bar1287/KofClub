/**
 * Generated avatars (roadmap W1.6): a symmetric 5×5 pattern and a hue
 * derived from a stable seed (the user id), so a player looks the same
 * everywhere without uploading anything.
 */
export interface AvatarSpec {
  hue: number;
  /** 5 rows of 5 cells, mirrored left to right. */
  cells: boolean[][];
}

/** FNV-1a 32-bit. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function avatarFor(seed: string): AvatarSpec {
  const h = fnv1a(seed);
  const bits = fnv1a(`${seed}:cells`);
  const cells: boolean[][] = [];
  let filled = 0;
  for (let row = 0; row < 5; row++) {
    const half: boolean[] = [];
    for (let col = 0; col < 3; col++) {
      const on = ((bits >>> (row * 3 + col)) & 1) === 1;
      half.push(on);
      if (on) filled += col === 2 ? 1 : 2;
    }
    cells.push([half[0]!, half[1]!, half[2]!, half[1]!, half[0]!]);
  }
  // Never blank: light the centre column when nothing else is.
  if (filled === 0) for (const r of cells) r[2] = true;
  return { hue: h % 360, cells };
}
