import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Snapshot, Task } from '@desklist/shared';
import { createRoot } from 'react-dom/client';
import {
  addTask, allowServer, ApiError, clearSession, connectLive, fetchSnapshot, isSession,
  DEFAULT_SERVER, loadPrefs, loginAccount, normalizeServer, patchItem, patchTask, redeemCode, saveProjectId, saveServerUrl, saveSession,
  signInWithCode, signOut, type Session,
} from './api';
import { blockedByItems, dueSoon, initialsOf, itemsOf, picOf, projectLabel, shortDate, tasksOf } from './model';
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
      <header className="top">
        <span className="mark" aria-hidden><Check size={13} /></span>
        <div className="brand">Desklist{snapshot?.team.isDemo ? <span className="sub">DEMO</span> : null}</div>
        <span className="spacer" />
        {session && <span className="live"><span className={`dot ${live === 'online' ? 'on' : ''}`} />{live === 'online' ? 'Live' : 'Reconnecting'}</span>}
        {session && <button className="ghost" onClick={() => void leave()}>Sign out</button>}
      </header>
      {error && session && <p className="err banner">{error}</p>}
      {session
        ? <Board session={session} snapshot={snapshot} projectId={projectId} onProject={chooseProject} onError={setError} refresh={() => refreshRef.current()} />
        : <Login serverUrl={serverUrl} setServerUrl={setServerUrl} error={error} setError={setError} onSession={setSession} />}
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
  const [mode, setMode] = useState<'account' | 'code'>('account');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      if (mode === 'code') {
        await enter(url, await signInWithCode(url, code));
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
    <form className="card" onSubmit={(event) => void submit(event)}>
      <h1>{pending ? 'Join your team' : 'Sign in'}</h1>
      {pending
        ? <p className="lede">Account <b>{pending.username}</b> is not linked yet. Enter the code from your admin.</p>
        : <p className="lede">Same team data as the Desklist desktop app.</p>}
      {!pending && (
        <div className="tabs" role="tablist">
          <button type="button" role="tab" className={mode === 'account' ? 'on' : ''} onClick={() => { setMode('account'); setError(null); }}>Account</button>
          <button type="button" role="tab" className={mode === 'code' ? 'on' : ''} onClick={() => { setMode('code'); setError(null); }}>Team code</button>
        </div>
      )}
      {pending || mode === 'code'
        ? <label><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Team code" aria-label="Team code" autoFocus spellCheck={false} /></label>
        : <>
          <label><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="username" spellCheck={false} /></label>
          <label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" autoComplete="current-password" /></label>
        </>}
      {error && <p className="err">{error}</p>}
      <button className="pri" disabled={busy || (pending || mode === 'code' ? code.trim().length < 4 : !username.trim() || !password)}>
        {busy ? 'Signing in…' : pending ? 'Join' : 'Sign in'}
      </button>
      {pending && <button type="button" className="textbtn" onClick={() => { setPending(null); setError(null); }}>Back</button>}
      <div className="server">
        <button type="button" className="textbtn" onClick={() => setShowServer((v) => !v)}>{showServer ? 'Hide server' : `Server: ${serverUrl}`}</button>
        {showServer && <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} aria-label="Server URL" spellCheck={false} />}
      </div>
    </form>
  );
}

function Board({ session, snapshot, projectId, onProject, onError, refresh }: {
  session: Session;
  snapshot: Snapshot | null;
  projectId: string | null;
  onProject: (id: string) => void;
  onError: (error: string | null) => void;
  refresh: () => Promise<void>;
}) {
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [adding, setAdding] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const projects = snapshot ? [...snapshot.projects].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) : [];
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  useEffect(() => {
    if (project && project.id !== projectId) onProject(project.id);
  }, [project, projectId, onProject]);

  if (!snapshot) return <p className="hint">Loading your projects…</p>;
  if (!project) return <p className="empty">No projects yet. Create one in the Desklist desktop app.</p>;
  const tasks = tasksOf(snapshot, project.id);
  const pic = picOf(snapshot, project);

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
      await addTask(session.serverUrl, session.token, project.id, title, due || null);
      setTitle('');
      setDue('');
      await refresh();
    } catch (error) {
      onError(message(error));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div className="chips" role="tablist" aria-label="Projects">
        {projects.map((p) => {
          const count = tasksOf(snapshot, p.id);
          return (
            <button key={p.id} role="tab" className={`chip ${p.id === project.id ? 'on' : ''}`} aria-selected={p.id === project.id} onClick={() => onProject(p.id)}>
              <b>{projectLabel(snapshot, p)}</b>
              <span>{count.done.length}/{count.all.length}</span>
            </button>
          );
        })}
      </div>
      <section className="card">
        <div className="head">
          <h2>{projectLabel(snapshot, project)}</h2>
          <span className="pct">{tasks.pct}%</span>
        </div>
        <p className="meta">{session.teamName}{pic ? ` · ${pic}` : ''} · {session.memberName}</p>
        <div className="bar" aria-hidden><i style={{ width: `${tasks.pct}%` }} /></div>
      </section>
      <section className="sect"><h3>Pending {tasks.open.length}</h3></section>
      <div className="list">
        {tasks.open.map((task) => (
          <TaskRow key={task.id} snapshot={snapshot} task={task} busy={busyId === task.id} noteId={noteId} draft={draft}
            onToggle={() => toggle(task)} onItem={(id, done) => void run(id, async () => { await patchItem(session.serverUrl, session.token, id, done); await refresh(); })}
            onNote={() => { setNoteId(task.id); setDraft(task.notes); }} onDraft={setDraft} onSave={() => void saveNote(task)} />
        ))}
        {tasks.open.length === 0 && <p className="empty">Nothing pending.</p>}
      </div>
      <section className="sect">
        <h3>Done {tasks.done.length}</h3>
        {tasks.done.length > 0 && <button className="textbtn" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide' : 'Show'}</button>}
      </section>
      {showDone && (
        <div className="list">
          {tasks.done.map((task) => (
            <TaskRow key={task.id} snapshot={snapshot} task={task} busy={busyId === task.id} noteId={noteId} draft={draft}
              onToggle={() => toggle(task)} onItem={(id, done) => void run(id, async () => { await patchItem(session.serverUrl, session.token, id, done); await refresh(); })}
              onNote={() => { setNoteId(task.id); setDraft(task.notes); }} onDraft={setDraft} onSave={() => void saveNote(task)} />
          ))}
        </div>
      )}
      <form className="card addrow" onSubmit={(event) => void create(event)}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" aria-label="Task title" />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <button className="add" disabled={adding || !title.trim()}>{adding ? 'Adding…' : 'Add task'}</button>
      </form>
    </>
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
  const items = itemsOf(snapshot, task.id);
  const blocked = blockedByItems(snapshot, task);
  const who = initialsOf(snapshot, task.approvedByMemberId);
  return (
    <article className={`task ${task.done ? 'done' : ''}`}>
      <div className="row">
        <button className={`check ${task.done ? 'on' : ''}`} aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`} aria-pressed={task.done}
          disabled={busy || blocked} title={blocked ? 'Finish the checklist items first' : undefined} onClick={onToggle}>
          {task.done ? <Check size={12} /> : null}
        </button>
        <div className="title">{task.title}</div>
        {task.dueDate && <span className={`due ${dueSoon(task.dueDate) && !task.done ? 'soon' : ''}`}>{shortDate(task.dueDate)}</span>}
        {who && <span className="who">{who}</span>}
      </div>
      {items.length > 0 && (
        <div className="items">
          {items.map((item) => (
            <button type="button" key={item.id} className={`item ${item.done ? 'done' : ''}`} disabled={busy}
              aria-pressed={item.done} onClick={() => onItem(item.id, !item.done)}>
              <span className={`check ${item.done ? 'on' : ''}`}>{item.done ? <Check size={12} /> : null}</span>
              <span>{item.title}</span>
            </button>
          ))}
        </div>
      )}
      {noteId === task.id
        ? <div className="noteform">
          <textarea value={draft} onChange={(e) => onDraft(e.target.value)} aria-label={`Notes for ${task.title}`} autoFocus onBlur={onSave} />
        </div>
        : <>
          {task.notes && <p className="note">{task.notes}</p>}
          <button className="textbtn" onClick={onNote}>{task.notes ? 'Edit note' : 'Add note'}</button>
        </>}
    </article>
  );
}

function Check({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);
