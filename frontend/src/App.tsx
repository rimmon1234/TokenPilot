import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { ModelStudioPage } from './pages/ModelStudioPage';
import { RoutingPage } from './pages/RoutingPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { BenchmarkLabPage } from './pages/BenchmarkLabPage';
import { SettingsPage } from './pages/SettingsPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<PlaygroundPage />} />
          <Route path="/studio" element={<ModelStudioPage />} />
          <Route path="/routing" element={<RoutingPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/benchmarks" element={<BenchmarkLabPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
