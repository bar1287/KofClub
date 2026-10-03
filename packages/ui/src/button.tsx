import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

const colors: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: '#2ea043',
  secondary: '#30363d',
  danger: '#da3633',
};

export function Button({ variant = 'primary', style, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      style={{
        background: colors[variant],
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        padding: '8px 14px',
        fontWeight: 600,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.5 : 1,
        ...style,
      }}
    />
  );
}
