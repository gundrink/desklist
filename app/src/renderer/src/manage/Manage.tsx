import { useEffect, useState } from 'react';
import '../styles/manage.css';
import type { ManageView } from '../../../common/ipc';
import { useAppState, actions } from '../lib/store';
import { ago } from '../lib/model';
import { Avatar, SyncDot, syncLabel } from '../components/Common';
import { ProjectGlassCard } from '../components/ProjectGlassCard';
import { SignIn } from '../components/SignIn';
import { Plus, Sliders, Users, Power } from '../components/Icons';
import { ProjectDetail } from './ProjectDetail';
import { CreateProject } from './CreateProject';
import { MasterFields } from './MasterFields';
import { Team } from './Team';

export function Manage() {
  const st = useAppState();
  const [nav, setNav] = useState<ManageView>({ view: 'project' });
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
    return <div className="win">{titlebar}<div className="center-fill">{st && st.phase === 'signedOut' ? <SignIn st={st} theme="light" /> : 'Loading…'}</div></div>;
  }
  const s = st.snapshot;
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
            {s.projects.map((p) => (
              <ProjectGlassCard key={p.id} s={s} p={p} selected={p.id === selectedId} expanded={p.id === selectedId}
                onSelect={() => select(p.id)} onMenu={() => setNav({ view: 'project', projectId: p.id, tab: 'details' })} />
            ))}
            {s.projects.length === 0 && <div className="empty-dark">No projects yet — create the first one.</div>}
          </div>
          <div className="pcfoot">
            <button className={`navbtn ${nav.view === 'fields' ? 'on' : ''}`} onClick={() => setNav({ view: 'fields' })}><Sliders />Master fields</button>
            <button className={`navbtn ${nav.view === 'team' ? 'on' : ''}`} onClick={() => setNav({ view: 'team' })}><Users />Team & codes</button>
            <span className="me" title={`${s.me.name} (${s.me.role}) · ${s.team.name}`}><Avatar initials={s.me.initials} size="xs" />
              <button className="iconbtn" title="Sign out" onClick={() => actions.signOut()}><Power size={13} /></button></span>
          </div>
        </div>
        <div className="rp">
          {nav.view === 'project' && selectedId && <ProjectDetail key={selectedId} s={s} projectId={selectedId} tab={nav.tab ?? 'checklist'}
            setTab={(tab) => setNav({ view: 'project', projectId: selectedId, tab })} onDeleted={() => setNav({ view: 'project' })} />}
          {nav.view === 'project' && !selectedId && <div className="center-fill muted">Create a project to get started.</div>}
          {nav.view === 'create' && <CreateProject s={s} onCreated={(id) => select(id)} onCancel={() => setNav({ view: 'project' })} />}
          {nav.view === 'fields' && <MasterFields s={s} isAdmin={isAdmin} />}
          {nav.view === 'team' && <Team s={s} isAdmin={isAdmin} />}
          <div className="footer"><span className="note" title={st.lastError ?? undefined}>
            <SyncDot connection={st.connection} />Changes sync to the desktop widget · {syncLabel(st.connection, st.pending, ago(st.lastSyncedAt))}
            {st.lastError && <span className="errtxt"> · {st.lastError}</span>}</span>
            <span className="note right">{s.team.isDemo ? 'DEMO DATA · ' : ''}{s.team.name} · signed in as {s.me.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
