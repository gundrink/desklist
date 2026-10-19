import { useEffect, useMemo, useState } from 'react';
import type { Project, Snapshot } from '@desklist/shared';
import { initialsOf, picOf, statusOf, statusStyle, tasksOf } from '../lib/model';
import { Avatar, StatusPill } from './Common';

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };
const offs = () => { const m = -new Date().getTimezoneOffset(); return `UTC${m >= 0 ? '+' : '−'}${Math.floor(Math.abs(m) / 60)}${m % 60 ? ':' + pad(Math.abs(m) % 60) : ''}`; };
export const isDoneProject = (s: Snapshot, p: Project) => { const st = statusOf(s, p); const t = tasksOf(s, p.id); return st === 'Done' || (t.all.length > 0 && t.done.length === t.all.length); };
export function relDay(iso: string, today = new Date()) {
  const a = new Date(`${iso}T00:00:00`); const b = new Date(ymd(today) + 'T00:00:00'); const d = Math.round((a.getTime() - b.getTime()) / 86400000);
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : d < 0 ? `${-d} days overdue` : d < 7 ? `In ${d} days` : `In ${Math.round(d / 7)} wk`;
}
export function useNow(ms = 1000) { const [n, setN] = useState(() => new Date()); useEffect(() => { const t = setInterval(() => setN(new Date()), ms); return () => clearInterval(t); }, [ms]); return n; }

export function Clock({ compact }: { compact?: boolean }) {
  const n = useNow();
  return (
    <div className={`ovclock ${compact ? 'compact' : ''}`} data-clock>
      <span className="cap mono">Local time</span>
      <div className="ovtime mono" aria-label="Current time">{pad(n.getHours())}<i>:</i>{pad(n.getMinutes())}<em>:{pad(n.getSeconds())}</em></div>
      <div className="ovdate">{n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div className="ovtz mono">{tz()} · {offs()}</div>
    </div>
  );
}

function ProjLine({ s, p, onOpen, rel }: { s: Snapshot; p: Project; onOpen: (id: string) => void; rel?: boolean }) {
  const t = tasksOf(s, p.id); const pic = picOf(s, p);
  return <button className="ovp" data-ovproject={p.name} onClick={() => onOpen(p.id)}>
    <span className="dot" style={{ background: statusStyle(statusOf(s, p)).color }} /><span className="nm">{p.name}</span>
    <StatusPill status={statusOf(s, p)} theme="dark" /><span className="mono pr">{t.done.length}/{t.all.length}</span>
    {pic ? <Avatar initials={initialsOf(pic)} size="xs" title={`BIC ${pic}`} /> : <span className="noav" />}
    {rel && p.deadline && <span className={`mono rel ${p.deadline < ymd(new Date()) ? 'late' : ''}`}>{relDay(p.deadline)}</span>}</button>;
}

/** Overview: live clock, month calendar with deadline dots, summary cards, upcoming deadlines. */
export function Overview({ s, onOpen }: { s: Snapshot; onOpen: (id: string) => void }) {
  const now = new Date(); const today = ymd(now);
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [day, setDay] = useState<string>(today); const [dir, setDir] = useState(0);
  const byDay = useMemo(() => { const m = new Map<string, Project[]>(); for (const p of s.projects) if (p.deadline) m.set(p.deadline, [...(m.get(p.deadline) ?? []), p]); return m; }, [s.projects]);
  const open = s.projects.filter((p) => !isDoneProject(s, p)); const done = s.projects.length - open.length;
  const wk = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const dueWeek = open.filter((p) => p.deadline && p.deadline >= today && p.deadline <= wk).length;
  const overdue = open.filter((p) => p.deadline && p.deadline < today).length;
  const mine = s.tasks.filter((t) => !t.done && t.bicMemberId === s.me.id).length;
  const upcoming = open.filter((p) => p.deadline).sort((a, b) => a.deadline!.localeCompare(b.deadline!)).filter((p) => p.deadline! >= today || true).slice(0, 5);
  const first = (month.getDay() + 6) % 7; const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => { const d = i - first + 1; return d >= 1 && d <= days ? new Date(month.getFullYear(), month.getMonth(), d) : null; });
  const go = (k: number) => { setDir(k); setMonth(new Date(month.getFullYear(), month.getMonth() + k, 1)); };
  const dayList = byDay.get(day) ?? [];
  const card = (cls: string, label: string, v: number, hint: string) => <div className={`ovstat ${cls}`} data-stat={label}><span className="cap">{label}</span><b className="mono">{v}</b><em>{hint}</em><i className="tick tl" /><i className="tick br" /></div>;
  return (
    <>
      <div className="rhead"><div className="row"><h1>Overview</h1><span className="rmeta">{s.team.name} · {s.projects.length} projects</span></div></div>
      <div className="rbody scroll ovpage mswap" data-overview>
        <div className="ovtop">
          <div className="ovcard ovclockcard"><Clock /><i className="plus p1">+</i><i className="plus p2">+</i></div>
          <div className="ovstats">
            {card('prog', 'In progress', open.length, 'open projects')}
            {card('done', 'Done', done, 'completed')}
            {card('week', 'Due this week', dueWeek, 'next 7 days')}
            {card('late', 'Overdue', overdue, 'past deadline')}
            {card('mine', 'My tasks open', mine, 'you are BIC')}
          </div>
        </div>
        <div className="ovmain">
          <div className="ovcard ovcal" data-calendar>
            <div className="ovcalh"><b>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><span className="ml" />
              <button className="btn sec sm" aria-label="Previous month" onClick={() => go(-1)}>‹</button>
              <button className="btn sec sm" onClick={() => { setDir(0); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setDay(today); }}>Today</button>
              <button className="btn sec sm" aria-label="Next month" onClick={() => go(1)}>›</button></div>
            <div className="ovwd">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
            <div className={`ovgrid ${dir < 0 ? 'from-l' : dir > 0 ? 'from-r' : ''}`} key={ymd(month)}>
              {cells.map((d, i) => { if (!d) return <span key={i} className="ovc empty" />; const k = ymd(d); const ps = byDay.get(k) ?? [];
                return <button key={i} className={`ovc ${k === today ? 'today' : ''} ${k === day ? 'sel' : ''}`} data-day={k} aria-label={`${k}${ps.length ? `, ${ps.length} due` : ''}`} onClick={() => setDay(k)}>
                  <span className="mono dn">{d.getDate()}</span><span className="dots">{ps.slice(0, 4).map((p) => <i key={p.id} style={{ background: statusStyle(statusOf(s, p)).color }} />)}</span></button>; })}
            </div>
          </div>
          <div className="ovside">
            <div className="ovcard ovday" data-dayopen={day}>
              <div className="ovh"><span>{new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span><em className="mono">{dayList.length} due</em></div>
              {dayList.length ? dayList.map((p) => <ProjLine key={p.id} s={s} p={p} onOpen={onOpen} />) : <div className="muted small ovempty">No deadlines this day.</div>}
            </div>
            <div className="ovcard ovup">
              <div className="ovh"><span>Upcoming deadlines</span><em className="mono">next 5</em></div>
              {upcoming.length ? upcoming.map((p) => <ProjLine key={p.id} s={s} p={p} onOpen={onOpen} rel />) : <div className="muted small ovempty">No upcoming deadlines.</div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Widget compact overview: clock + today's and upcoming deadlines. */
export function WidgetOverview({ s, onOpen }: { s: Snapshot; onOpen: (id: string) => void }) {
  const today = ymd(new Date());
  const open = s.projects.filter((p) => !isDoneProject(s, p) && p.deadline).sort((a, b) => a.deadline!.localeCompare(b.deadline!));
  const tday = open.filter((p) => p.deadline === today); const next = open.filter((p) => p.deadline !== today).slice(0, 5);
  return (
    <div className="wov scroll nodrag" data-woverview>
      <Clock compact />
      <div className="sect">Due today · {tday.length}</div>
      {tday.length ? tday.map((p) => <ProjLine key={p.id} s={s} p={p} onOpen={onOpen} />) : <div className="muted small ovempty">Nothing due today.</div>}
      <div className="sect">Upcoming</div>
      {next.length ? next.map((p) => <ProjLine key={p.id} s={s} p={p} onOpen={onOpen} rel />) : <div className="muted small ovempty">No upcoming deadlines.</div>}
    </div>
  );
}
