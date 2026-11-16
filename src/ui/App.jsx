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
import { Schedules } from './screens/Schedules.jsx';
import { Inbox } from './screens/Inbox.jsx';
import { Versions } from './screens/Versions.jsx';
import { Filing, Notice, ClientCopy } from './screens/Filing.jsx';
import { NextYear } from './screens/NextYear.jsx';
import { Firm } from './screens/Firm.jsx';
import { ClientPortal, Examiner } from './screens/Portals.jsx';

const SCREENS = { overview: Overview, queue: Queue, finding: Finding, return: Return, documents: Documents, document: Document, history: History, schedules: Schedules,
  inbox: Inbox, versions: Versions, filing: Filing, notice: Notice, copy: ClientCopy, nextyear: NextYear, firm: Firm, client: ClientPortal, examiner: Examiner };
// A client signed in sees only their portal and their copy of the return.
const CLIENT_SCREENS = new Set(['client', 'copy']);

export function App() {
  const { ready, trace, actor } = useWorkpaper();
  const { path, params } = useRoute();
  const Screen = actor?.kind === 'client' && !CLIENT_SCREENS.has(path) ? ClientPortal : SCREENS[path] ?? Overview;
  return (
    <div className="app">
      <Sidebar path={path} />
      <main className="main">{ready ? <Screen key={path} params={params} /> : <div className="page c3">Loading…</div>}</main>
      {trace && <TraceDrawer key={trace.id} />}
      <Toasts />
    </div>
  );
}
