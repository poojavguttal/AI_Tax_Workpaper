import { useWorkpaper } from './state/Workpaper.jsx';
import { useRoute } from './state/router.js';
import { Sidebar, Toasts } from './components/Shell.jsx';
import { TraceDrawer } from './components/Trace.jsx';
import { Overview } from './screens/Overview.jsx';
import { Queue } from './screens/Queue.jsx';
import { Finding } from './screens/Finding.jsx';
import { Return } from './screens/Return.jsx';
import { Documents, Document } from './screens/Documents.jsx';
import { History } from './screens/History.jsx';

const SCREENS = { overview: Overview, queue: Queue, finding: Finding, return: Return, documents: Documents, document: Document, history: History };

export function App() {
  const { ready, trace } = useWorkpaper();
  const { path, params } = useRoute();
  const Screen = SCREENS[path] ?? Overview;
  return (
    <div className="app">
      <Sidebar path={path} />
      <main className="main">{ready ? <Screen key={path} params={params} /> : <div className="page c3">Loading…</div>}</main>
      {trace && <TraceDrawer key={trace.id} />}
      <Toasts />
    </div>
  );
}
