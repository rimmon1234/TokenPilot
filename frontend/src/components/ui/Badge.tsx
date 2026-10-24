import React from 'react';

export type BadgeVariant = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  icon?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  className = '',
  icon,
}) => {
  const variantStyles: Record<BadgeVariant, string> = {
    default: 'bg-dark-800 text-slate-300 border-dark-700',
    brand: 'bg-brand-500/10 text-brand-300 border-brand-500/30',
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    warning: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    danger: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
    info: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    neutral: 'bg-dark-850 text-slate-400 border-dark-750',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border transition-colors ${variantStyles[variant]} ${className}`}
    >
      {icon && <span className="w-3 h-3 flex items-center justify-center">{icon}</span>}
      {children}
    </span>
  );
};
