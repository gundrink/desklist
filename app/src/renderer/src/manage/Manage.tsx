import { Settings } from './Settings';
const Gear = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
import { useEffect, useState } from 'react';
import '../styles/manage.css';
import type { ManageView } from '../../../common/ipc';
import { useAppState, actions } from '../lib/store';
import { ago } from '../lib/model';
import { Avatar, SyncDot, syncLabel } from '../components/Common';
import { ProjectGlassCard } from '../components/ProjectGlassCard';
import { SignIn, LoadingState } from '../components/SignIn';
import { Plus, Sliders, Users, Power } from '../components/Icons';
import { ProjectDetail } from './ProjectDetail';
import { CreateProject } from './CreateProject';
import { MasterFields } from './MasterFields';
import { Team } from './Team';
import { TemplatePicker } from './TemplatePicker';
import { Reports } from './Reports';
import { TaskSetup } from './TaskSetup';
import '../styles/v5.css';
import '../styles/v6.css';
import '../styles/v61.css';
import '../styles/v62.css';
import { ProjTabs, useProjectTabs } from '../components/ProjectList';

export function Manage() {
  const st = useAppState();
  const [nav, setNav] = useState<ManageView>({ view: 'project' });
  const [picker, setPicker] = useState<string | null>(null);
  useEffect(() => window.desklist.onNavigate(setNav), []);
  const plat = st?.platform ?? 'darwin';

  const titlebar = (
    <div className={`titlebar ${plat}`}>
      {plat === 'linux' && (
        <div className="lights nodrag">
          <button className="l-close" onClick={() => actions.windowControl('close')} aria-label="Close" />
          <button className="l-min" onClick={() => actions.windowControl('minimize')} aria-label="Minimize" />
          <button className="l-max" onClick={() => actions.windowControl('maximize')} aria-label="Maximize" />
        </div>
      )}
      <div className="title">Desklist — Manage</div>
    </div>
  );
  if (!st || st.phase !== 'ready' || !st.snapshot) {
    return <div className="win">{titlebar}<div className="center-fill">{st && st.phase === 'signedOut' ? <SignIn st={st} theme="light" /> : st ? <LoadingState st={st} /> : 'Loading…'}</div></div>;
  }
  const s = st.snapshot;
  return <ManageReady st={st} s={s} nav={nav} setNav={setNav} picker={picker} setPicker={setPicker} titlebar={titlebar} />;
}

function ManageReady({ st, s, nav, setNav, picker, setPicker, titlebar }: { st: NonNullable<ReturnType<typeof useAppState>>; s: NonNullable<NonNullable<ReturnType<typeof useAppState>>['snapshot']>; nav: ManageView; setNav: (v: ManageView) => void; picker: string | null; setPicker: (v: string | null) => void; titlebar: React.ReactNode }) {
  const tabs = useProjectTabs(s);
  const selectedId = nav.view === 'project' ? (nav.projectId && s.projects.some((p) => p.id === nav.projectId) ? nav.projectId : st.settings.currentProjectId ?? s.projects[0]?.id) : undefined;
  const select = (id: string) => { setNav({ view: 'project', projectId: id, tab: nav.view === 'project' ? nav.tab : undefined }); void actions.setCurrentProject(id); };
  const isAdmin = s.me.role === 'admin';

  return (
    <div className="win">
      {titlebar}
      <div className="body">
        <div className="pcol dark">
          <div className="pchead"><span>Projects <em>{s.projects.length}</em></span>
            <button className="newbtn" onClick={() => setNav({ view: 'create' })}><Plus />New project</button></div>
          <div className="gscroll scroll">
            {isAdmin && <button className={`adminrow ${nav.view === 'reports' ? 'on' : ''}`} onClick={() => setNav({ view: 'reports' })}>▦ Admin · Reports<span>{s.me.name}</span></button>}
            {isAdmin && <button className={`adminrow ${nav.view === 'tasksetup' ? 'on' : ''}`} onClick={() => setNav({ view: 'tasksetup' })}>▤ Admin · Task setup<span>fields</span></button>}
            <ProjTabs t={tabs} theme="dark" />
            {tabs.list.map((p) => (
              <ProjectGlassCard key={p.id} s={s} p={p} selected={p.id === selectedId} expanded={p.id === selectedId}
                onSelect={() => select(p.id)} onMenu={() => setNav({ view: 'project', projectId: p.id, tab: 'details' })} />
            ))}
            {tabs.list.length === 0 && s.projects.length > 0 && <div className="empty-dark">Nothing here.</div>}
            {s.projects.length === 0 && <div className="empty-dark">No projects yet — create the first one.</div>}
          </div>
          <div className="pcfoot">
            <button className={`navbtn ${nav.view === 'fields' ? 'on' : ''}`} onClick={() => setNav({ view: 'fields' })}><Sliders />Master fields</button>
            <button className={`navbtn ${nav.view === 'team' ? 'on' : ''}`} onClick={() => setNav({ view: 'team' })}><Users />Team & codes</button>
            <button className={`navbtn ${nav.view === 'settings' ? 'on' : ''}`} onClick={() => setNav({ view: 'settings' })} title="Settings" aria-label="Settings"><Gear />Settings</button>
            <span className="me" title={`${s.me.name} (${s.me.role}) · ${s.team.name}`}><Avatar initials={s.me.initials} size="xs" />
              <button className="iconbtn" title="Sign out" onClick={() => actions.signOut()}><Power size={13} /></button></span>
          </div>
        </div>
        <div className="rp">
          {nav.view === 'project' && selectedId && s.projects.some((x) => x.id === selectedId) && <ProjectDetail key={selectedId} s={s} projectId={selectedId} tab={nav.tab ?? 'checklist'}
            setTab={(tab) => setNav({ view: 'project', projectId: selectedId, tab })} onDeleted={() => setNav({ view: 'project' })} />}
          {nav.view === 'project' && !selectedId && <div className="center-fill muted">Create a project to get started.</div>}
          {nav.view === 'create' && <CreateProject s={s} onCreated={(id) => { select(id); setPicker(id); }} onCancel={() => setNav({ view: 'project' })} />}
          {nav.view === 'reports' && <Reports s={s} />}
          {nav.view === 'tasksetup' && isAdmin && <TaskSetup s={s} />}
          {nav.view === 'fields' && <MasterFields s={s} isAdmin={isAdmin} />}
          {nav.view === 'team' && <Team s={s} isAdmin={isAdmin} />}
          {nav.view === 'settings' && st && <Settings s={s} st={st} />}
          {picker && <TemplatePicker s={s} projectId={picker} onClose={() => setPicker(null)} />}
          <div className="footer"><span className="note" title={st.lastError ?? undefined}>
            <SyncDot connection={st.connection} />Changes sync to the desktop widget · {syncLabel(st.connection, st.pending, ago(st.lastSyncedAt))}
            {st.lastError && <span className="errtxt"> · {st.lastError}</span>}</span>
            <span className="note right">{s.team.name} · signed in as {s.me.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
