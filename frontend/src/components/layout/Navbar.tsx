import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Compass,
  Cpu,
  GitFork,
  BarChart3,
  FlaskConical,
  Settings as SettingsIcon,
  HardDrive,
  ExternalLink,
} from 'lucide-react';
import { checkBackendHealth } from '../../services/api';

export const Navbar: React.FC = () => {
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    let mounted = true;
    const verifyHealth = async () => {
      try {
        await checkBackendHealth();
        if (mounted) setBackendStatus('online');
      } catch {
        if (mounted) setBackendStatus('offline');
      }
    };
    verifyHealth();
    const interval = setInterval(verifyHealth, 20000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const navLinks = [
    { to: '/', label: 'Playground', icon: Compass },
    { to: '/studio', label: 'Model Studio', icon: Cpu },
    { to: '/routing', label: 'Routing Pools', icon: GitFork },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/benchmarks', label: 'Benchmark Lab', icon: FlaskConical },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-dark-750 bg-dark-900/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 via-indigo-500 to-cyan-400 p-0.5 shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform">
                <div className="w-full h-full bg-dark-950 rounded-[10px] flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-brand-400 group-hover:text-brand-300 transition-colors" />
                </div>
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                  TokenPilot
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30">
                    Gateway
                  </span>
                </span>
                <p className="text-[10px] text-slate-400 -mt-0.5">ML-Powered LLM Optimizer</p>
              </div>
            </NavLink>

            {/* Main Nav Items */}
            <nav className="hidden md:flex items-center gap-1 ml-4">
              {navLinks.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-dark-800 text-brand-300 border border-dark-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-dark-850'
                    }`
                  }
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Right Status Indicators */}
          <div className="flex items-center gap-3">
            {/* Storage indicator */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-dark-850 border border-dark-750 text-[11px] text-slate-400">
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
              <span>IndexedDB Local</span>
            </div>

            {/* Backend connectivity indicator */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                backendStatus === 'online'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : backendStatus === 'offline'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-dark-800 border-dark-700 text-slate-400'
              }`}
              title={
                backendStatus === 'online'
                  ? 'Connected to TokenPilot FastAPI backend'
                  : 'Backend server offline (run: uvicorn app.main:app --port 8000)'
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  backendStatus === 'online'
                    ? 'bg-emerald-400 animate-pulse'
                    : backendStatus === 'offline'
                    ? 'bg-amber-400'
                    : 'bg-slate-400'
                }`}
              />
              <span className="hidden sm:inline">
                {backendStatus === 'online' ? 'Backend Ready' : backendStatus === 'offline' ? 'Offline Mode' : 'Connecting...'}
              </span>
            </div>

            {/* Docs link */}
            <a
              href="https://github.com/rimmon1234/TokenPilot"
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-dark-800 transition-colors"
              title="GitHub Repository"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </header>
  );
};
