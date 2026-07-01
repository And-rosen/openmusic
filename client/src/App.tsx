import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

const Home = lazy(() => import('./pages/Home'));
const Room = lazy(() => import('./pages/Room'));
const TvDisplay = lazy(() => import('./pages/TvDisplay'));

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center bg-netease-dark text-netease-muted">
      <div className="flex items-center gap-2 text-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-netease-muted/30 border-t-netease-red" />
        加载中…
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="h-full">
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="/tv/:roomId" element={<TvDisplay />} />
        </Routes>
      </Suspense>
    </div>
  );
}
