import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';

export const Shell: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-dark-950 text-slate-100">
      <Navbar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-dark-800 bg-dark-950/80 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>TokenPilot Gateway v0.1.0 • Built with Antigravity</span>
          <span>Zero-Secret Client Policy • Local-first IndexedDB</span>
        </div>
      </footer>
    </div>
  );
};
