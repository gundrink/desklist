import { useEffect, useMemo, useState } from 'react';
import type { Project, Snapshot } from '@desklist/shared';
import { initialsOf, picOf, shortDate, statusOf, statusStyle, tasksOf } from '../lib/model';
import { Avatar, avatarOf, avatarByName, StatusPill } from './Common';
import { Select } from './Select';

/** App-only clock timezone (never touches the OS clock). '' = System default (follow PC). Persisted per device. */
export const getClockTz = () => localStorage.getItem('dl-tz') ?? '';
const tzListeners = new Set<() => void>();
export function setClockTz(tz: string) { localStorage.setItem('dl-tz', tz); tzListeners.forEach((f) => f()); }
export function useClockTz(): [string, (t: string) => void] {
  const [t, setT] = useState(getClockTz());
  useEffect(() => { const f = () => setT(getClockTz()); tzListeners.add(f); const g = (e: StorageEvent) => { if (e.key === 'dl-tz') f(); }; window.addEventListener('storage', g); return () => { tzListeners.delete(f); window.removeEventListener('storage', g); }; }, []);
  return [t, setClockTz];
}
/** A Date whose local fields equal the wall clock in `tz` (via Intl.DateTimeFormat). */
export function zonedNow(tz = getClockTz(), base = new Date()): Date {
  if (!tz) return base;
  try { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(base).map((x) => [x.type, x.value]));
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second, base.getMilliseconds()); } catch { return base; }
}
export function tzOffsetLabel(tz: string, base = new Date()) { const z = zonedNow(tz, base); const m = Math.round((z.getTime() - base.getTime()) / 60000) - base.getTimezoneOffset();
  return `UTC${m >= 0 ? '+' : '−'}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? ':' + pad(Math.abs(m) % 60) : ''}`; }
const sysTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };
const COMMON = ['UTC', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Australia/Sydney'];
export function tzOptions() { let all: string[] = []; try { all = (Intl as any).supportedValuesOf('timeZone'); } catch { /* old runtime */ }
  return [...COMMON, ...all.filter((z) => !COMMON.includes(z))]; }
export function TzSelect({ compact }: { compact?: boolean }) {
  const [tz, setTz] = useClockTz(); const opts = useMemo(tzOptions, []);
  return <Select className={compact ? 'tzchip' : ''} value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Clock timezone">
    <option value="">{`System default (follow PC) · ${sysTz()}`}</option>
    {opts.map((z) => <option key={z} value={z}>{`${z} · ${tzOffsetLabel(z)}`}</option>)}</Select>;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tz = () => getClockTz() || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
const offs = () => tzOffsetLabel(getClockTz());
export const isDoneProject = (s: Snapshot, p: Project) => { const st = statusOf(s, p); const t = tasksOf(s, p.id); return st === 'Done' || (t.all.length > 0 && t.done.length === t.all.length); };
export function relDay(iso: string, today = zonedNow()) {
  const a = new Date(`${iso}T00:00:00`); const b = new Date(ymd(today) + 'T00:00:00'); const d = Math.round((a.getTime() - b.getTime()) / 86400000);
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : d < 0 ? `${-d} days overdue` : d < 14 ? `In ${d} days` : `In ${Math.round(d / 7)} weeks`;
}
export function useNow(ms = 1000) { const [tz] = useClockTz(); const [n, setN] = useState(() => new Date()); useEffect(() => { const t = setInterval(() => setN(new Date()), ms); return () => clearInterval(t); }, [ms]); return zonedNow(tz, n); }

/** Clock mode (digital | analog), persisted per device and shared by Manage + widget. */
export type ClockMode = 'digital' | 'analog';
export function useClockMode(): [ClockMode, (m: ClockMode) => void] {
  const [m, setM] = useState<ClockMode>(() => (localStorage.getItem('dl-clock') === 'analog' ? 'analog' : 'digital'));
  useEffect(() => { const f = (e: StorageEvent) => { if (e.key === 'dl-clock') setM(e.newValue === 'analog' ? 'analog' : 'digital'); }; window.addEventListener('storage', f); return () => window.removeEventListener('storage', f); }, []);
  return [m, (v) => { localStorage.setItem('dl-clock', v); setM(v); }];
}
const weekStart = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function Analog({ n, size = 168 }: { n: Date; size?: number }) {
  const sec = n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
  const h = (sec / 120) % 360, mi = (sec / 10) % 3600, s = sec * 6; // cumulative second angle: no 59→0 jump
  return <svg className="analog" width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={`Analog clock ${pad(n.getHours())}:${pad(n.getMinutes())}`} data-analog>
    <circle cx="100" cy="100" r="96" className="face" />
    {Array.from({ length: 60 }, (_, i) => <line key={i} x1="100" y1={i % 5 ? 9 : 8} x2="100" y2={i % 5 ? 14 : 22} className={i % 5 ? 'tk' : 'tk h'} transform={`rotate(${i * 6} 100 100)`} />)}
    <line x1="100" y1="112" x2="100" y2="54" className="hand hh" style={{ transform: `rotate(${h}deg)` }} />
    <line x1="100" y1="116" x2="100" y2="30" className="hand mh" style={{ transform: `rotate(${mi / 10}deg)` }} />
    <g className="hand sh" style={{ transform: `rotate(${s}deg)` }} data-sec={n.getSeconds()}><line x1="100" y1="124" x2="100" y2="22" /><circle cx="100" cy="100" r="3.2" /></g>
    <circle cx="100" cy="100" r="1.4" className="pin" />
  </svg>;
}
function greeting(n: Date) { const h = n.getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

export function Clock({ compact, name }: { compact?: boolean; name?: string }) {
  const n = useNow(); const [mode, setMode] = useClockMode();
  const toggle = <div className="seg clockseg" role="group" aria-label="Clock style">
    {(['digital', 'analog'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'digital' ? 'Digital' : 'Analog'}</button>)}</div>;
  return (
    <div className={`ovclock ${compact ? 'compact' : ''} m-${mode}`} data-clock={mode}>
      <div className="ovclockh">{name ? <span className="greet">{greeting(n)}, <b>{name}</b></span> : <span className="cap">Local time</span>}<span className="ml" /><span className="tzwrap" title="Clock timezone (this app only)"><TzSelect compact /></span>{toggle}</div>
      <div className="ovclockb">
        {mode === 'digital'
          ? <div className="ovtime mono" aria-label="Current time">{pad(n.getHours())}<i>:</i>{pad(n.getMinutes())}<em key={n.getSeconds()} className="secs" data-secs>{pad(n.getSeconds())}</em></div>
          : <Analog n={n} size={compact ? 128 : 168} />}
        <div className="ovwhen">
          <div className="ovwd1">{n.toLocaleDateString('en-GB', { weekday: 'long' })}</div>
          <div className="ovdate">{n.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <div className="ovtz mono" data-tzlabel>{tz()} · {offs()}</div>
        </div>
      </div>
    </div>
  );
}

const Ring = ({ v, cls = '', size = 46 }: { v: number; cls?: string; size?: number }) => { const r = 18, c = 2 * Math.PI * r; const p = Math.max(0, Math.min(1, v));
  return <svg className={`ring ${cls}`} width={size} height={size} viewBox="0 0 44 44" aria-hidden><circle cx="22" cy="22" r={r} className="rt" /><circle cx="22" cy="22" r={r} className="rv" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 22 22)" /></svg>; };

function bicsOf(s: Snapshot, p: Project) {
  const ids = [...new Set(s.tasks.filter((t) => t.projectId === p.id && t.bicMemberId).map((t) => t.bicMemberId!))];
  const out = ids.map((id) => s.members.find((m) => m.id === id)).filter(Boolean).map((m) => ({ ini: m!.initials, name: m!.name }));
  const pic = picOf(s, p); if (!out.length && pic) out.push({ ini: initialsOf(pic), name: pic });
  return out;
}

function ProjLine({ s, p, onOpen, rel }: { s: Snapshot; p: Project; onOpen: (id: string) => void; rel?: boolean }) {
  const t = tasksOf(s, p.id); const pic = picOf(s, p);
  return <button className="ovp" data-ovproject={p.name} onClick={() => onOpen(p.id)}>
    <span className="dot" style={{ background: statusStyle(statusOf(s, p)).color }} /><span className="nm">{p.name}</span>
    <span className="mono pr">{t.done.length}/{t.all.length}</span>
    {pic ? <Avatar initials={initialsOf(pic)} url={avatarByName(s, pic)} size="xs" title={`BIC ${pic}`} /> : null}
    {rel && p.deadline && <span className={`mono rel ${p.deadline < ymd(zonedNow()) ? 'late' : ''}`}>{relDay(p.deadline)}</span>}</button>;
}

export function nearestProjects(s: Snapshot, today = ymd(zonedNow())) {
  void today; return s.projects.filter((p) => !isDoneProject(s, p) && p.deadline).sort((a, b) => a.deadline!.localeCompare(b.deadline!) || a.name.localeCompare(b.name));
}

/** Overview: clock hero, square month calendar with chips, targets, nearest projects. */
export function Overview({ s, onOpen }: { s: Snapshot; onOpen: (id: string) => void }) {
  const [ctz] = useClockTz(); const now = zonedNow(ctz); const today = ymd(now);
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [day, setDay] = useState<string>(today); const [dir, setDir] = useState(0); const [all, setAll] = useState(false);
  const byDay = useMemo(() => { const m = new Map<string, Project[]>(); for (const p of s.projects) if (p.deadline) m.set(p.deadline, [...(m.get(p.deadline) ?? []), p]); return m; }, [s.projects]);
  const ws = weekStart(now); const we = addDays(ws, 6); const wsS = ymd(ws), weS = ymd(we);
  const weekP = s.projects.filter((p) => p.deadline && p.deadline >= wsS && p.deadline <= weS); const weekDone = weekP.filter((p) => isDoneProject(s, p)).length;
  const doneWeek = s.tasks.filter((t) => t.done && t.doneAt && ymd(new Date(t.doneAt)) >= wsS && ymd(new Date(t.doneAt)) <= weS).length;
  const mine = s.tasks.filter((t) => !t.done && t.bicMemberId === s.me.id).length;
  const overdue = s.projects.filter((p) => !isDoneProject(s, p) && p.deadline && p.deadline < today).length;
  const tAll = s.tasks.length, tDone = s.tasks.filter((t) => t.done).length; const rate = tAll ? tDone / tAll : 0;
  const near = nearestProjects(s); const shown = all ? near : near.slice(0, 8);
  const first = (month.getDay() + 6) % 7; const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => { const d = i - first + 1; return d >= 1 && d <= days ? new Date(month.getFullYear(), month.getMonth(), d) : null; });
  const go = (k: number) => { setDir(k); setMonth(new Date(month.getFullYear(), month.getMonth() + k, 1)); };
  const dayList = byDay.get(day) ?? [];
  const first1 = s.me.name.split(/\s+/)[0];
  const target = (k: string, label: string, value: React.ReactNode, hint: string, ring?: { v: number; cls?: string }, cls = '') =>
    <div className={`ovtarget ${cls}`} data-target={k}><div className="tt1"><span className="cap">{label}</span>{ring && <Ring v={ring.v} cls={ring.cls} />}</div><b className="mono">{value}</b><em>{hint}</em><i className="tick tl" /><i className="tick br" /></div>;
  return (
    <>
      <div className="rhead"><div className="row"><h1>Overview</h1><span className="rmeta">{s.team.name} · {s.projects.length} projects</span></div></div>
      <div className="rbody scroll ovpage v611 mswap" data-overview>
        <div className="ovcard ovhero st1"><Clock name={first1} /><i className="plus p1">+</i><i className="plus p2">+</i><i className="plus p3">+</i><i className="plus p4">+</i></div>
        <div className="ovmain st2">
          <div className="ovcard ovcal" data-calendar>
            <div className="ovcalh"><b>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><span className="ml" />
              <button className="btn sec sm" aria-label="Previous month" onClick={() => go(-1)}>‹</button>
              <button className="btn sec sm" onClick={() => { setDir(0); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setDay(today); }}>Today</button>
              <button className="btn sec sm" aria-label="Next month" onClick={() => go(1)}>›</button></div>
            <div className="ovwd">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
            <div className={`ovgrid ${dir < 0 ? 'from-l' : dir > 0 ? 'from-r' : ''}`} key={ymd(month)}>
              {cells.map((d, i) => { if (!d) return <span key={i} className="ovc empty" />; const k = ymd(d); const ps = byDay.get(k) ?? [];
                return <button key={i} className={`ovc ${k === today ? 'today' : ''} ${k === day ? 'sel' : ''} ${ps.length ? 'has' : ''}`} data-day={k} aria-label={`${k}${ps.length ? `, ${ps.length} due` : ''}`} onClick={() => setDay(k)}>
                  <span className="mono dn">{d.getDate()}</span>
                  <span className="ovchips">{ps.slice(0, 2).map((p) => <i key={p.id} className="pchip" title={p.name}><b style={{ background: statusStyle(statusOf(s, p)).color }} />{p.name}</i>)}{ps.length > 2 && <i className="more mono">+{ps.length - 2}</i>}</span>
                  <span className="dots">{ps.slice(0, 4).map((p) => <i key={p.id} style={{ background: statusStyle(statusOf(s, p)).color }} />)}</span></button>; })}
            </div>
          </div>
          <div className="ovcard ovday" data-dayopen={day}>
            <div className="ovh"><span>{new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span><em className="mono">{dayList.length} due</em></div>
            {dayList.length ? dayList.map((p) => <ProjLine key={p.id} s={s} p={p} onOpen={onOpen} />) : <div className="muted small ovempty">No deadlines this day.</div>}
          </div>
        </div>
        <div className="ovtargets st3">
          {target('week', 'This week', <>{weekDone}<small> of {weekP.length}</small></>, 'projects due done', { v: weekP.length ? weekDone / weekP.length : 0 })}
          {target('donewk', 'Tasks done this week', doneWeek, `${shortDate(wsS)} – ${shortDate(weS)}`)}
          {target('mine', 'My open tasks', mine, 'you are BIC')}
          {target('late', 'Overdue', overdue, 'projects past deadline', undefined, overdue ? 'late' : '')}
          {target('rate', 'Completion rate', `${Math.round(rate * 100)}%`, `${tDone} of ${tAll} tasks`, { v: rate, cls: 'sage' })}
        </div>
        <div className="ovcard ovnear st4" data-near>
          <div className="ovh"><span>Nearest projects</span><em className="mono">{near.length} with deadlines</em></div>
          {shown.length ? shown.map((p) => { const t = tasksOf(s, p.id); const late = p.deadline! < today; const pc = t.all.length ? t.done.length / t.all.length : 0;
            return <button key={p.id} className={`nrow ${late ? 'late' : ''}`} data-nproject={p.name} data-deadline={p.deadline} onClick={() => onOpen(p.id)}>
              <span className="nnm">{p.name}{late && <em className="ltag">Overdue</em>}</span>
              <StatusPill status={statusOf(s, p)} theme="dark" />
              <span className="nbar"><i style={{ width: `${pc * 100}%` }} /></span><span className="mono npr">{t.done.length}/{t.all.length}</span>
              <span className="navs">{bicsOf(s, p).slice(0, 3).map((b) => <Avatar key={b.ini + b.name} initials={b.ini} url={avatarByName(s, b.name)} size="xs" title={`BIC ${b.name}`} />)}</span>
              <span className="ndl"><b className="mono">{shortDate(p.deadline!)}</b><em className={late ? 'late' : ''}>{relDay(p.deadline!).replace(/^In /, 'in ')}</em></span></button>; })
            : <div className="muted small ovempty">No project deadlines yet.</div>}
          {near.length > 8 && <button className="linkbtn ovall" onClick={() => setAll(!all)}>{all ? 'Show less' : `View all ${near.length}`}</button>}
        </div>
      </div>
    </>
  );
}

/** Widget compact overview: designed for the widget — clock card, mini month, target tiles, nearest projects. */
export function WidgetOverview({ s, onOpen }: { s: Snapshot; onOpen: (id: string) => void }) {
  const [ctz] = useClockTz(); const now = zonedNow(ctz); const today = ymd(now);
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1)); const [day, setDay] = useState<string | null>(null);
  const byDay = useMemo(() => { const m = new Map<string, Project[]>(); for (const p of s.projects) if (p.deadline) m.set(p.deadline, [...(m.get(p.deadline) ?? []), p]); return m; }, [s.projects]);
  const near = nearestProjects(s).slice(0, 5);
  const ws = weekStart(now); const wsS = ymd(ws), weS = ymd(addDays(ws, 6));
  const weekP = s.projects.filter((p) => p.deadline && p.deadline >= wsS && p.deadline <= weS); const weekDone = weekP.filter((p) => isDoneProject(s, p)).length;
  const mine = s.tasks.filter((t) => !t.done && t.bicMemberId === s.me.id).length;
  const overdue = s.projects.filter((p) => !isDoneProject(s, p) && p.deadline && p.deadline < today).length;
  const tAll = s.tasks.length, tDone = s.tasks.filter((t) => t.done).length; const rate = tAll ? tDone / tAll : 0;
  const first = (month.getDay() + 6) % 7; const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => { const d = i - first + 1; return d >= 1 && d <= days ? new Date(month.getFullYear(), month.getMonth(), d) : null; });
  const dayList = day ? byDay.get(day) ?? [] : [];
  return (
    <div className="wov w611 scroll nodrag" data-woverview>
      <div className="wovcard wclock s1"><Clock compact name={s.me.name.split(/\s+/)[0]} /><i className="plus p1">+</i><i className="plus p2">+</i></div>
      <div className="wovcard wmcal s2" data-wcal>
        <div className="wcalh"><b>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><span className="ml" />
          <button className="wnav" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <button className="wnav" aria-label="This month" onClick={() => { setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setDay(today); }}>Today</button>
          <button className="wnav" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
        <div className="wcwd">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="wcgrid">{cells.map((d, i) => { if (!d) return <span key={i} className="wcl empty" />; const k = ymd(d); const ps = byDay.get(k) ?? [];
          return <button key={i} className={`wcl ${k === today ? 'today' : ''} ${k === day ? 'sel' : ''}`} data-wday={k} aria-label={`${k}${ps.length ? `, ${ps.length} due` : ''}`} onClick={() => setDay(k === day ? null : k)}>
            <span className="mono">{d.getDate()}</span><span className="wdots">{ps.slice(0, 3).map((p) => <i key={p.id} style={{ background: statusStyle(statusOf(s, p)).color }} />)}</span></button>; })}</div>
        {day && <div className="wdaylist" data-wdayopen={day}><div className="wdh">{new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}<em className="mono">{dayList.length} due</em></div>
          {dayList.length ? dayList.map((p) => <ProjLine key={p.id} s={s} p={p} onOpen={onOpen} />) : <div className="muted small ovempty">No deadlines.</div>}</div>}
      </div>
      <div className="wtiles s3">
        <div className="wtile" data-wtile="week"><span>This week</span><div className="wtv"><b className="mono">{weekDone}<small>/{weekP.length}</small></b><Ring v={weekP.length ? weekDone / weekP.length : 0} size={28} /></div></div>
        <div className="wtile" data-wtile="mine"><span>My open tasks</span><div className="wtv"><b className="mono">{mine}</b></div></div>
        <div className={`wtile ${overdue ? 'late' : ''}`} data-wtile="late"><span>Overdue</span><div className="wtv"><b className="mono">{overdue}</b></div></div>
        <div className="wtile" data-wtile="rate"><span>Completion</span><div className="wtv"><b className="mono">{Math.round(rate * 100)}<small>%</small></b><Ring v={rate} cls="sage" size={28} /></div></div>
      </div>
      <div className="wovcard wnear s4" data-wnear>
        <div className="wdh">Nearest projects<em className="mono">{near.length}</em></div>
        {near.length ? near.map((p) => { const t = tasksOf(s, p.id); const late = p.deadline! < today; const pc = t.all.length ? t.done.length / t.all.length : 0;
          return <button key={p.id} className={`wnrow ${late ? 'late' : ''}`} data-wnproject={p.name} title={p.name} onClick={() => onOpen(p.id)}>
            <span className="dot" style={{ background: statusStyle(statusOf(s, p)).color }} /><span className="wnn">{p.name}</span>
            <span className="wnb"><i style={{ width: `${pc * 100}%` }} /></span><span className="mono wnp">{t.done.length}/{t.all.length}</span>
            <span className={`mono wnr ${late ? 'late' : ''}`}>{relDay(p.deadline!).replace(/^In /, 'in ')}</span></button>; })
          : <div className="muted small ovempty">No upcoming deadlines.</div>}
      </div>
    </div>
  );
}
