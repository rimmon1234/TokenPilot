import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500/50 disabled:opacity-50 disabled:cursor-not-allowed select-none';

  const sizeStyles: Record<ButtonSize, string> = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-sm px-3.5 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  };

  const variantStyles: Record<ButtonVariant, string> = {
    primary: 'bg-brand-600 hover:bg-brand-500 text-white shadow-sm hover:shadow-brand-500/20 active:translate-y-px',
    secondary: 'bg-dark-800 hover:bg-dark-750 text-slate-200 border border-dark-700 active:translate-y-px',
    outline: 'bg-transparent hover:bg-dark-850 text-slate-300 border border-dark-700 hover:border-dark-600 active:translate-y-px',
    ghost: 'bg-transparent hover:bg-dark-800 text-slate-400 hover:text-slate-100',
    danger: 'bg-rose-600/90 hover:bg-rose-600 text-white shadow-sm hover:shadow-rose-500/20 active:translate-y-px',
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin -ml-0.5 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      ) : icon ? (
        <span className="flex items-center justify-center">{icon}</span>
      ) : null}
      {children}
    </button>
  );
};
