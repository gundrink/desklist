import '@fontsource-variable/inter';
import './styles/base.css';
import { createRoot } from 'react-dom/client';
import { Widget } from './widget/Widget';
import { Manage } from './manage/Manage';

const view = new URLSearchParams(location.search).get('view') ?? 'widget';
document.documentElement.dataset.view = view;
createRoot(document.getElementById('root')!).render(view === 'manage' ? <Manage /> : <Widget />);
