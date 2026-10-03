import type { HTMLAttributes } from 'react';

export function Panel({ style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        background: '#17212c',
        borderRadius: 8,
        padding: 16,
        border: '1px solid #26313d',
        ...style,
      }}
    />
  );
}
