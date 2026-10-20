import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { SOCIAL_PLATFORMS, type Snapshot, type Task } from '@desklist/shared';
import { createRoot } from 'react-dom/client';
import {
  addTask, allowServer, ApiError, clearSession, connectLive, fetchSnapshot, isSession,
  DEFAULT_SERVER, loadPrefs, loginAccount, normalizeServer, patchItem, patchTask, redeemCode, saveProjectId, saveServerUrl, saveSession,
  signOut, signupAccount, type Session,
} from './api';
import { blockedByItems, dueSoon, initialsOf, isDoneProject, itemsOf, picOf, projectLabel, shortDate, statusOf, statusStyle, tasksOf } from './model';
import './panel.css';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function Panel() {
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [session, setSession] = useState<Session | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [live, setLive] = useState<'online' | 'offline'>('offline');
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    void loadPrefs().then((prefs) => {
      setServerUrl(prefs.serverUrl);
      setSession(prefs.session);
      setProjectId(prefs.projectId);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!session) { setSnapshot(null); return; }
    let stop = false;
    let timer = 0;
    const pull = async () => {
      try {
        const next = await fetchSnapshot(session.serverUrl, session.token);
        if (stop) return;
        setSnapshot(next);
        setError(null);
      } catch (error) {
        if (stop) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await clearSession();
          setSession(null);
          setError('Your session expired. Sign in again.');
          return;
        }
        setError(message(error));
      }
    };
    refreshRef.current = pull;
    void pull();
    const disconnect = connectLive(session.serverUrl, session.token, {
      onStatus: (status) => { if (!stop) setLive(status); },
      onChanged: () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { void pull(); }, 200);
      },
    });
    const onVisible = () => { if (document.visibilityState === 'visible') void pull(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      disconnect();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session]);

  const chooseProject = useCallback((id: string) => {
    setProjectId(id);
    void saveProjectId(id);
  }, []);

  const leave = async () => {
    if (session) await signOut(session.serverUrl, session.token);
    await clearSession();
    setSession(null);
    setSnapshot(null);
    setError(null);
  };

  if (!ready) return <main className="app" />;
  return (
    <main className="app">
      {session
        ? <Board session={session} snapshot={snapshot} projectId={projectId} live={live} onProject={chooseProject} onError={setError} onSignOut={() => void leave()} refresh={() => refreshRef.current()} />
        : <Login serverUrl={serverUrl} setServerUrl={setServerUrl} error={error} setError={setError} onSession={setSession} />}
      {error && session && <p className="err banner">{error}</p>}
    </main>
  );
}

function Login({ serverUrl, setServerUrl, error, setError, onSession }: {
  serverUrl: string;
  setServerUrl: (url: string) => void;
  error: string | null;
  setError: (error: string | null) => void;
  onSession: (session: Session) => void;
}) {
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<{ token: string; username: string } | null>(null);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);

  const enter = async (url: string, signed: { token: string; member: { name: string }; team: { name: string } }) => {
    const session: Session = { serverUrl: url, token: signed.token, memberName: signed.member.name, teamName: signed.team.name };
    await saveSession(session);
    onSession(session);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = normalizeServer(serverUrl);
      await allowServer(url);
      await saveServerUrl(url);
      setServerUrl(url);
      if (pending) {
        await enter(url, await redeemCode(url, pending.token, code));
        return;
      }
      if (mode === 'create') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters');
        if (password !== confirm) throw new Error("Passwords don't match");
        const created = await signupAccount(url, username, password);
        setPending({ token: created.accountToken, username: created.username });
        setCode('');
        return;
      }
      const result = await loginAccount(url, username, password);
      if (isSession(result)) await enter(url, result);
      else { setPending({ token: result.accountToken, username: result.username }); setCode(''); }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="signin dark" onSubmit={(event) => void submit(event)}>
      <div className="brand"><LogoMark size={36} /><h2>{pending ? 'Enter the code from your admin' : mode === 'create' ? 'Create your account' : 'Welcome back'}</h2></div>
      {pending
        ? <p>Account <b>{pending.username}</b> is created. Enter the code your admin gave you to join your team.</p>
        : null}
      {!pending && (
        <div className={`ptabs authtabs idx-${mode === 'create' ? 1 : 0}`} role="tablist">
          <button type="button" role="tab" className={mode === 'signin' ? 'on' : ''} onClick={() => { setMode('signin'); setError(null); }}>Sign in</button>
          <button type="button" role="tab" className={mode === 'create' ? 'on' : ''} onClick={() => { setMode('create'); setError(null); }}>Create account</button>
        </div>
      )}
      {pending
        ? <input className="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" aria-label="Admin code" autoFocus spellCheck={false} />
        : <>
          <label className="ifield"><UserIcon /><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="username" autoFocus spellCheck={false} /></label>
          <label className="ifield"><LockIcon />
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} />
            <button type="button" className="eyebtn" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
          </label>
          {mode === 'create' && <label className="ifield"><LockIcon /><input type={showPassword ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" aria-label="Confirm password" autoComplete="new-password" /></label>}
        </>}
      {error && <div className="err">{error}</div>}
      <button className="btn pri" disabled={busy || (pending ? code.trim().length < 4 : !username.trim() || !password)}>
        {busy ? (mode === 'create' && !pending ? 'Creating…' : pending ? 'Joining…' : 'Signing in…') : pending ? 'Join' : mode === 'create' ? 'Create account' : 'Sign in'}
      </button>
      {mode === 'create' && !pending && <p>Next you'll enter the code from your admin.</p>}
      {pending && <button type="button" className="linkbtn" onClick={() => { setPending(null); setError(null); setMode('signin'); setPassword(''); setConfirm(''); }}>Back to sign in</button>}
      <button type="button" className="linkbtn" onClick={() => setShowServer((v) => !v)}>{showServer ? 'Hide server' : `Server: ${serverUrl}`}</button>
      {showServer && <input className="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} aria-label="Server URL" spellCheck={false} />}
    </form>
  );
}

function Board({ session, snapshot, projectId, live, onProject, onError, onSignOut, refresh }: {
  session: Session;
  snapshot: Snapshot | null;
  projectId: string | null;
  live: 'online' | 'offline';
  onProject: (id: string) => void;
  onError: (error: string | null) => void;
  onSignOut: () => void;
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'progress' | 'done'>('progress');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [kind, setKind] = useState<'standard' | 'social'>('standard');
  const [platform, setPlatform] = useState<string>(SOCIAL_PLATFORMS[0]);
  const [adding, setAdding] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const projects = snapshot ? [...snapshot.projects].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) : [];
  const progress = projects.filter((p) => snapshot && !isDoneProject(snapshot, p));
  const finished = projects.filter((p) => snapshot && isDoneProject(snapshot, p));
  const listed = tab === 'done' ? finished : progress;
  const project = projects.find((p) => p.id === projectId) ?? listed[0] ?? projects[0];
  useEffect(() => {
    if (project && project.id !== projectId) onProject(project.id);
  }, [project, projectId, onProject]);

  if (!snapshot) return <div className="shell"><p className="w-hint">Loading…</p></div>;
  if (!project) return <div className="shell"><p className="w-hint">No projects yet. Create one in the Desklist desktop app.</p><div className="foot"><button className="linkbtn" onClick={onSignOut}>Sign out</button></div></div>;
  const tasks = tasksOf(snapshot, project.id);
  const pic = picOf(snapshot, project);
  const status = statusOf(snapshot, project);
  const label = projectLabel(snapshot, project);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    onError(null);
    try { await fn(); }
    catch (error) { onError(message(error)); }
    finally { setBusyId(null); }
  };

  const toggle = (task: Task) => {
    if (blockedByItems(snapshot, task)) return;
    void run(task.id, async () => {
      await patchTask(session.serverUrl, session.token, task.id, { done: !task.done });
      await refresh();
    });
  };

  const saveNote = async (task: Task) => {
    setNoteId(null);
    if (draft === task.notes) return;
    await run(task.id, async () => {
      await patchTask(session.serverUrl, session.token, task.id, { notes: draft });
      await refresh();
    });
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    onError(null);
    try {
      await addTask(session.serverUrl, session.token, project.id, title, due || null, kind, kind === 'social' ? platform : undefined);
      setTitle('');
      setDue('');
      await refresh();
    } catch (error) {
      onError(message(error));
    } finally {
      setAdding(false);
    }
  };

  const row = (task: Task) => (
    <TaskRow key={task.id} snapshot={snapshot} task={task} busy={busyId === task.id} noteId={noteId} draft={draft}
      onToggle={() => toggle(task)} onItem={(id, done) => void run(id, async () => { await patchItem(session.serverUrl, session.token, id, done); await refresh(); })}
      onNote={() => { setNoteId(task.id); setDraft(task.notes); }} onDraft={setDraft} onSave={() => void saveNote(task)} />
  );

  return (
    <div className="shell">
      <div className="topbar">
        <span className="dl-brand"><LogoMark size={22} /><span className="dl-word">Desklist</span></span>
        <span className="sync"><span className={`syncdot ${live === 'online' ? 'on' : ''}`} />{live === 'online' ? 'Live' : 'Reconnecting'}</span>
      </div>
      <div className={`ptabs idx-${tab === 'done' ? 1 : 0}`} role="tablist">
        <button type="button" role="tab" className={tab === 'progress' ? 'on' : ''} onClick={() => setTab('progress')}>In progress <em>{progress.length}</em></button>
        <button type="button" role="tab" className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Done <em>{finished.length}</em></button>
      </div>
      <div className="rail-list">
        {listed.map((p) => {
          const count = tasksOf(snapshot, p.id);
          const st = statusStyle(statusOf(snapshot, p));
          return (
            <button key={p.id} className={`ri ${p.id === project.id ? 'sel' : ''}`} onClick={() => onProject(p.id)}>
              <span className="ri1"><span className={`smark ${st.cls}`} /><span className="rn ell">{p.name}</span><span className="rc">{count.done.length}/{count.all.length}</span></span>
            </button>
          );
        })}
        {listed.length === 0 && <p className="w-hint">{tab === 'done' ? 'No finished projects.' : 'No projects in progress.'}</p>}
      </div>
      <div className="wdet">
        <div className="w-top">
          <div className="switch" title={project.name}><span className="dotp" style={{ background: statusStyle(status).color }} /><span className="ell">{project.name}</span></div>
          <span className={`gp ${statusStyle(status).cls}`}>{status}</span>
        </div>
        {label !== project.name && <div className="wdesc">{label}</div>}
        {project.notes && <div className="wdesc">{project.notes}</div>}
        <div className="meta">{pic && <span className="ell">PIC: <b>{pic}</b></span>}{session.teamName && <span>{session.teamName}</span>}</div>
        <div className="prog"><div className="lbl"><span><b>{tasks.done.length} of {tasks.all.length}</b> done</span><span>{tasks.pct}%</span></div><div className="bar"><i style={{ width: `${tasks.pct}%` }} /></div></div>
        <div className="wtool"><span className="sect">Pending · {tasks.open.length}</span></div>
        <div className="wl">
          {tasks.open.map(row)}
          {tasks.open.length === 0 && <div className="w-hint">Nothing pending</div>}
          {tasks.done.length > 0 && <div className="divider">Done · {tasks.done.length}</div>}
          {tasks.done.map(row)}
        </div>
        <form className={`wadd ${title ? 'active' : ''}`} onSubmit={(event) => void create(event)}>
          <span className="plus">+</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" aria-label="New task title" />
          <select value={kind} onChange={(e) => setKind(e.target.value as 'standard' | 'social')} aria-label="Task type">
            <option value="standard">Standard</option>
            <option value="social">Social account</option>
          </select>
          {kind === 'social' && <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">{SOCIAL_PLATFORMS.map((name) => <option key={name}>{name}</option>)}</select>}
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          <button className="wbtn" disabled={adding || !title.trim()}>{adding ? '…' : 'Add'}</button>
        </form>
      </div>
      <div className="foot"><span className="sync">{session.memberName}</span><button className="linkbtn" onClick={onSignOut}>Sign out</button></div>
    </div>
  );
}

function TaskRow({ snapshot, task, busy, noteId, draft, onToggle, onItem, onNote, onDraft, onSave }: {
  snapshot: Snapshot;
  task: Task;
  busy: boolean;
  noteId: string | null;
  draft: string;
  onToggle: () => void;
  onItem: (id: string, done: boolean) => void;
  onNote: () => void;
  onDraft: (value: string) => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const items = itemsOf(snapshot, task.id);
  const blocked = blockedByItems(snapshot, task);
  const who = initialsOf(snapshot, task.approvedByMemberId);
  return (
    <div>
      <div className={`wt ${task.done ? 'done' : ''}`} onClick={() => setOpen((v) => !v)}>
        <button type="button" className={`cbx dark ${task.done ? 'd' : ''}`} aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`} aria-checked={task.done}
          disabled={busy} title={blocked ? 'Finish the checklist items first' : undefined}
          onClick={(event) => { event.stopPropagation(); if (blocked) setOpen(true); else onToggle(); }}>
          {task.done ? <Check size={11} /> : null}
        </button>
        <span className="t ell">{task.title}</span>
        {task.dueDate && !task.done && <span className={`wd ${dueSoon(task.dueDate) ? 'soon' : ''}`}>{shortDate(task.dueDate)}</span>}
        {who && <span className="who">{who}</span>}
      </div>
      {(open || noteId === task.id) && items.length > 0 && (
        <div className="sub">
          {items.map((item) => (
            <button type="button" key={item.id} className={`wt ${item.done ? 'done' : ''}`} disabled={busy} onClick={() => onItem(item.id, !item.done)}>
              <span className={`cbx dark ${item.done ? 'd' : ''}`}>{item.done ? <Check size={11} /> : null}</span>
              <span className="t ell">{item.title}</span>
            </button>
          ))}
        </div>
      )}
      {noteId === task.id
        ? <div className="noteform"><textarea value={draft} onChange={(e) => onDraft(e.target.value)} aria-label={`Notes for ${task.title}`} autoFocus onBlur={onSave} /></div>
        : open && <button type="button" className="linkbtn" style={{ margin: '0 0 6px 30px' }} onClick={onNote}>{task.notes ? 'Edit note' : 'Add note'}</button>}
      {open && noteId !== task.id && task.notes && <p className="note">{task.notes}</p>}
    </div>
  );
}

function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs><linearGradient id="dlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e1d5c0" /><stop offset="1" stopColor="#ccbca3" /></linearGradient></defs>
      <rect x="2.5" y="2.5" width="59" height="59" rx="15" fill="#1c1d1c" stroke="#30302e" />
      <path d="M14 23l5 5 9-10" fill="none" stroke="url(#dlg)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="33" y="19" width="18" height="5" rx="2.5" fill="url(#dlg)" opacity=".95" />
      <rect x="14" y="34" width="37" height="5" rx="2.5" fill="url(#dlg)" opacity=".75" />
      <rect x="14" y="44" width="28" height="5" rx="2.5" fill="url(#dlg)" opacity=".55" />
    </svg>
  );
}
function UserIcon() {
  return <svg className="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>;
}
function LockIcon() {
  return <svg className="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
}
function Check({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);
