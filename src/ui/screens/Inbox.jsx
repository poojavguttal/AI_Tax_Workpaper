import { useState } from 'react';
import { MessageCircleQuestion, UserPlus, CalendarClock, Bell } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { packet, actorById } from '../state/base.js';
import { fmtDate, KIND } from '../format.js';
import { Crumbs, Empty, Person, Stat, Status } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { QuestionThread, AskForm, useNotifications, targetLink, AssignBox } from '../components/People.jsx';
import { navigate } from '../state/router.js';

const today = () => new Date().toISOString().slice(0, 10);

export function Inbox({ params }) {
  const { state, actor } = useWorkpaper();
  const tab = params.tab ?? 'mine';
  const notes = useNotifications();
  const open = state.questions.filter((q) => !q.answer);
  const assigned = state.items.filter((i) => i.assignment);
  const unassigned = state.items.filter((i) => !i.assignment && ['error', 'conflict', 'judgment'].includes(i.kind) && i.status !== 'closed');
  const overdue = assigned.filter((i) => i.assignment.payload.due && i.assignment.payload.due < today() && i.status !== 'closed');
  const [qFilter, setQFilter] = useState('open');
  const qs = state.questions.filter((q) => (qFilter === 'open' ? !q.answer : qFilter === 'answered' ? q.answer : true)).slice().reverse();
  const TABS = [['mine', 'For you', notes.length], ['questions', 'Questions', state.questions.length], ['assignments', 'Assignments', assigned.length], ['deadlines', 'Deadlines', packet.raw.firm.deadlines.length]];

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Inbox']]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <h1 className="h1">Inbox</h1>
              <div className="sub">Questions to the client and colleagues, who owns what, and the dates that matter. Every answer is recorded and kept as evidence on the item it was asked about.</div>
            </div>
          </div>
          <div className="stats mb24">
            <Stat label="For you" value={notes.filter((n) => n.id !== 'deadline').length} sub={actor?.name} icon={Bell} />
            <Stat label="Questions waiting" value={open.length} sub={`${open.filter((q) => actorById.get(q.payload.to)?.kind === 'client').length} with the client`} icon={MessageCircleQuestion} tone={open.some((q) => q.payload.blocking) ? 'amber' : ''} />
            <Stat label="Findings unassigned" value={unassigned.length} sub="Open errors, conflicts and judgments" icon={UserPlus} />
            <Stat label="Overdue" value={overdue.length} sub="Assignments past their due date" icon={CalendarClock} tone={overdue.length ? 'red' : ''} />
          </div>
          <div className="sch-tabs mb24">
            {TABS.map(([k, l, n]) => <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => navigate('inbox', { tab: k })}>{l} <span className="c4">{n}</span></button>)}
          </div>

          {tab === 'mine' && (
            <div className="card">
              {notes.length === 0 ? <Empty title="Nothing needs you right now" /> : notes.map((n) => {
                const Icon = n.icon;
                return (
                  <div key={n.id} className="lrow click" onClick={n.go} style={{ padding: '14px 20px' }}>
                    <span className={`icotile ${n.tone}`}><Icon size={17} /></span>
                    <div className="grow" style={{ minWidth: 0 }}><div className="w5">{n.text}</div><div className="t12 c3 ellipsis">{n.sub}</div></div>
                    {n.at && <span className="t12 c4">{fmtDate(n.at)}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'questions' && (
            <div className="grid-main">
              <div className="card">
                <div className="card-h">
                  <div className="h3">Questions</div>
                  <div className="seg">{[['open', 'Waiting'], ['answered', 'Answered'], ['all', 'All']].map(([k, l]) => <button type="button" key={k} className={qFilter === k ? 'on' : ''} onClick={() => setQFilter(k)}>{l}</button>)}</div>
                </div>
                <div style={{ padding: '8px 24px 16px' }}>{qs.length === 0 ? <div className="c3" style={{ padding: '16px 0' }}>No questions here.</div> : qs.map((q) => <QuestionThread key={q.id} q={q} />)}</div>
              </div>
              <div className="card">
                <div className="card-h"><div className="h3">Ask about the whole return</div></div>
                <div className="card-b"><AskForm target="return" /><div className="t12 c3 mt12">To ask about a specific finding or line, use the Questions tab on that finding.</div></div>
              </div>
            </div>
          )}

          {tab === 'assignments' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl tall" style={{ tableLayout: 'fixed' }}>
                <thead><tr><th>Finding</th><th style={{ width: 150 }}>Kind</th><th style={{ width: 170 }}>Status</th><th style={{ width: 420 }}>Owner and due date</th></tr></thead>
                <tbody>
                  {[...assigned, ...unassigned].map((i) => (
                    <tr key={i.id}>
                      <td><button type="button" className="linkish w5 ellipsis" style={{ maxWidth: '100%' }} title={i.title} onClick={() => navigate('finding', { id: i.id })}>{i.title}</button></td>
                      <td className="c2">{KIND[i.kind]?.label ?? i.kind}</td>
                      <td><Status status={i.status} /></td>
                      <td><AssignBox target={i.id} compact /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'deadlines' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl tall">
                <thead><tr><th style={{ width: 160 }}>Date</th><th>What</th><th style={{ width: 220 }}>Status</th></tr></thead>
                <tbody>
                  {packet.raw.firm.deadlines.slice().sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
                    const ext = /original due/i.test(d.what) && state.extensions.length;
                    const done = (/review complete/i.test(d.what) && state.returnSignoffs.some((s) => s.valid && s.payload.level === 'reviewer')) || (/due date/i.test(d.what) && state.filed);
                    const past = d.date < today();
                    return (
                      <tr key={d.what}>
                        <td className="w6">{fmtDate(d.date)}</td>
                        <td>{d.what}</td>
                        <td>{done ? <span className="pill green">Met</span> : ext ? <span className="pill outline">Extended to Oct 15, 2026</span> : past ? <span className="pill red">Passed</span> : <span className="pill amber">Upcoming</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

